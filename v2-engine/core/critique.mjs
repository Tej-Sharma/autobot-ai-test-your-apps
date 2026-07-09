// ============================================================================
// core/critique.mjs — the CRITIQUE pass. Re-examines every saved screenshot with
// a strong vision model (Claude) through the editable rubric. The two old
// engines' copies were identical apart from the prompt wording (screen vs page)
// and the .env hint — both injected by the platform entry (mobile/critique.mjs,
// web/critique.mjs), which also owns the runs-dir default and CLI main.
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizedElBoxes, normalizedStyleBoxes, sanitizeBbox, pngSize } from './bbox.mjs';

const FLAW = z.object({
  type: z.enum(['visual', 'content', 'copy', 'layout', 'functional', 'a11y', 'performance']),
  severity: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  detail: z.string(),
  elementIndex: z.number().int().nullable()
    .describe('index into the ELEMENTS list (if provided) of the element this flaw is about; null when no listed element matches'),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-screen issues'),
});
const CRITIQUE = z.object({ verdict: z.string(), flaws: z.array(FLAW) });

// VLMs are unreliable at estimating pixel coordinates from an image alone, so we ground the
// critique: the prompt lists every element with its TRUE normalized box, the model just names
// the element it means (elementIndex), and we snap the flaw's bbox to that element's real
// rect. Grounding source per platform (helpers in core/bbox.mjs):
//   mobile — a11y elements saved per screenshot (elements.jsonl, with coordinate space)
//   web    — the style sweep saved per screenshot (styles/<shot>.json, page px = image px);
//            web a11y elements carry NO coordinates, so without this every web bbox was a
//            freehand guess, and freehand guesses routinely come back in pixels — drawn
//            off-canvas by annotate. Model-drawn bboxes are only a sanitized fallback.
const fmt = (v) => v.toFixed(3);
const elementsBlock = (boxes) => `ELEMENTS on this screen (from the accessibility tree), with their true normalized boxes (x0,y0,x1,y1):
${boxes.map((b, i) => b ? `[${i}] "${b.label}"${b.type ? ` (${b.type})` : ''} box=(${fmt(b.x0)},${fmt(b.y0)},${fmt(b.x1)},${fmt(b.y1)})` : null).filter(Boolean).join('\n')}

When a flaw is about one of these elements, set elementIndex to its index — its true box will be
used for the annotation. Only draw your own bbox when no listed element matches the flaw.`;

export async function critiqueRun(runDir, { rubricPath, envHint, critiqueSystem, critiqueUser }) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error(`Need OPENROUTER_API_KEY (${envHint})`);
  const CRITIQUE_MODEL = process.env.CRITIQUE_MODEL || 'anthropic/claude-sonnet-4.5';
  const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(CRITIQUE_MODEL);
  const rubric = readFileSync(rubricPath, 'utf8');
  const journal = readFileSync(join(runDir, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  // per-screenshot accessibility elements, when the explore pass recorded them.
  const elementsPath = join(runDir, 'elements.jsonl');
  const elsByShot = new Map();
  if (existsSync(elementsPath)) {
    for (const e of readFileSync(elementsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) {
      if (e.screenshot && !elsByShot.has(e.screenshot)) elsByShot.set(e.screenshot, e);
    }
  }

  // unique screenshots in capture order, with the screen name from the journal line.
  const shots = []; const seen = new Set();
  for (const e of journal) if (e.screenshot && !seen.has(e.screenshot)) { seen.add(e.screenshot); shots.push({ file: e.screenshot, screen: e.screen }); }

  const out = join(runDir, 'critique.jsonl');
  writeFileSync(out, '');
  console.log(`critique: ${CRITIQUE_MODEL} reviewing ${shots.length} screenshots in ${runDir}\n`);
  let n = 0, flawN = 0;
  for (const s of shots) {
    const path = join(runDir, s.file);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    const b64 = buf.toString('base64');
    const dims = pngSize(buf);
    const elEntry = elsByShot.get(s.file);
    let boxes = normalizedElBoxes(elEntry?.space, elEntry?.els);
    if (!boxes) {
      const stylesPath = join(runDir, 'styles', s.file.replace(/^screenshots\//, '').replace(/\.png$/, '.json'));
      if (existsSync(stylesPath)) {
        try { boxes = normalizedStyleBoxes(JSON.parse(readFileSync(stylesPath, 'utf8')), dims); } catch { /* grounding is best-effort */ }
      }
    }
    if (!boxes) console.log(`   ⚠ no grounding source for ${s.file} — flaw boxes will be freehand (annotation accuracy degraded)`);
    const { object } = await generateObject({
      model, schema: CRITIQUE,
      messages: [
        { role: 'system', content: critiqueSystem(rubric) },
        { role: 'user', content: [
          { type: 'text', text: critiqueUser({ screen: s.screen }) },
          ...(boxes ? [{ type: 'text', text: elementsBlock(boxes) }] : []),
          { type: 'image', image: `data:image/png;base64,${b64}` },
        ]},
      ],
    });
    const flaws = object.flaws.map((f) => {
      const el = (boxes && f.elementIndex != null) ? boxes[f.elementIndex] : null;
      const bbox = el ? { x0: el.x0, y0: el.y0, x1: el.x1, y1: el.y1 } : sanitizeBbox(f.bbox, dims);
      return { id: `C-${String(++flawN).padStart(3, '0')}`, ...f, bbox };
    });
    appendFileSync(out, JSON.stringify({ screenshot: s.file, screen: s.screen, verdict: object.verdict, flaws }) + '\n');
    n += flaws.length;
    console.log(`  ${s.file}  [${s.screen}]  ${flaws.length} flaws — ${object.verdict}`);
    console.log('@@PROGRESS ' + JSON.stringify({ screenshot: s.file, screen: s.screen, flaws: flaws.length, verdict: object.verdict }));
  }
  console.log(`\ncritique done: ${n} flaws across ${shots.length} screens → ${out}`);
  return out;
}
