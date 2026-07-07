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

// VLMs are unreliable at estimating pixel coordinates from an image alone, so when the
// explore pass saved the screen's accessibility elements (elements.jsonl, with their
// coordinate space), we ground the critique: the prompt lists every element with its TRUE
// normalized box, the model just names the element it means (elementIndex), and we snap
// the flaw's bbox to that element's real rect. Model-drawn bboxes are only a fallback.
const MIN_EL_PT = 20; // coord-space units; some a11y els report a bare center point (w/h 0)
function normalizedElBoxes(entry) {
  if (!entry?.space?.w || !entry?.space?.h) return null;
  const { w: SW, h: SH } = entry.space;
  const boxes = (entry.els || []).map((e) => {
    if (e.x == null || e.y == null) return null;
    const w = Math.max(e.w || 0, MIN_EL_PT), h = Math.max(e.h || 0, MIN_EL_PT);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return {
      label: e.label, type: e.type,
      x0: clamp((e.x - w / 2) / SW), y0: clamp((e.y - h / 2) / SH),
      x1: clamp((e.x + w / 2) / SW), y1: clamp((e.y + h / 2) / SH),
    };
  });
  return boxes.some(Boolean) ? boxes : null;
}
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
    const b64 = readFileSync(path).toString('base64');
    const boxes = normalizedElBoxes(elsByShot.get(s.file));
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
      const bbox = el ? { x0: el.x0, y0: el.y0, x1: el.x1, y1: el.y1 } : f.bbox;
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
