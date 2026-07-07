// ============================================================================
// core/annotate.mjs — draws a red bounding box + label on a copy of the
// screenshot for every flaw (from explore's flaws.jsonl or critique.jsonl) that
// carries a bbox. Output: screenshots/annotated/<flawId>.png — one file per
// flaw, so the desktop app's "view bug" link always points at just that issue.
// The two old engines' copies were identical — this is that code, shared. The
// platform entry (mobile/annotate.mjs, web/annotate.mjs) owns the runs-dir
// default and CLI main.
// ============================================================================
import sharp from 'sharp';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const SEV_COLOR = { high: '#e5484d', medium: '#e6a000', low: '#8a8f98' };

// One flaw's box, as an SVG overlay the same size as the source image — composited
// on top via sharp. A label chip sits above the box (or below, if the box is near
// the top edge) so it never gets clipped off-canvas.
function overlaySvg({ width, height, bbox, severity, summary }) {
  const x = bbox.x0 * width, y = bbox.y0 * height;
  const w = Math.max(4, (bbox.x1 - bbox.x0) * width), h = Math.max(4, (bbox.y1 - bbox.y0) * height);
  const color = SEV_COLOR[severity] || SEV_COLOR.low;
  const label = summary.length > 60 ? summary.slice(0, 57) + '…' : summary;
  const chipW = Math.min(width - 8, 14 + label.length * 6.5);
  const chipAbove = y - 22 >= 0;
  const chipY = chipAbove ? y - 22 : y + h + 2;
  const chipX = Math.min(Math.max(0, x), width - chipW);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="4" rx="4"/>
    <rect x="${chipX}" y="${chipY}" width="${chipW}" height="20" rx="4" fill="${color}"/>
    <text x="${chipX + 7}" y="${chipY + 14}" font-size="12" font-family="-apple-system,Helvetica,sans-serif" fill="#111">${label
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>
  </svg>`;
}

export async function annotateRun(runDir) {
  const driveFlaws = readJsonl(join(runDir, 'flaws.jsonl'));
  const critique = readJsonl(join(runDir, 'critique.jsonl'));
  const design = readJsonl(join(runDir, 'design-diffs.jsonl')); // design pass ran only if a Figma link was configured

  // Normalize all sources to one flat shape: {id, screenshot, bbox, severity, summary}.
  const flat = [
    ...driveFlaws.map((f) => ({ id: f.id, screenshot: f.screenshots?.[0], bbox: f.bbox, severity: f.severity, summary: f.summary })),
    ...critique.flatMap((c) => (c.flaws || []).map((f) => ({ id: f.id, screenshot: c.screenshot, bbox: f.bbox, severity: f.severity, summary: f.summary }))),
    ...design.map((d) => ({ id: d.id, screenshot: d.screenshot, bbox: d.bbox, severity: d.severity, summary: d.summary })),
  ].filter((f) => f.id && f.screenshot && f.bbox);

  const outDir = join(runDir, 'screenshots', 'annotated');
  console.log(`annotate: ${flat.length} flaw(s) with a bbox, in ${runDir}\n`);
  if (flat.length) mkdirSync(outDir, { recursive: true });

  let n = 0;
  for (const f of flat) {
    const src = join(runDir, f.screenshot);
    if (!existsSync(src)) continue;
    // Annotation overlays are a nice-to-have on top of an already-complete run —
    // a per-image sharp failure must not fail the whole run (the report still has
    // the raw screenshot + flaw text). Skip the overlay and keep going.
    try {
      const img = sharp(src);
      const { width, height } = await img.metadata();
      const svg = overlaySvg({ width, height, bbox: f.bbox, severity: f.severity, summary: f.summary });
      const outFile = join(outDir, `${f.id}.png`);
      await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(outFile);
      n++;
      console.log(`  ${f.id}  ←  ${f.screenshot}  [${f.severity}] ${f.summary}`);
      console.log('@@PROGRESS ' + JSON.stringify({ flawId: f.id, screenshot: f.screenshot, file: `screenshots/annotated/${f.id}.png` }));
    } catch (e) {
      console.log(`  ${f.id}  ←  annotation skipped (${e.message})`);
    }
  }
  console.log(`\nannotate done: ${n} annotated screenshot(s) → ${outDir}`);
  return outDir;
}
