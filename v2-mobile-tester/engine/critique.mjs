// ============================================================================
// critique.mjs — the CRITIQUE pass. Re-examines every saved screenshot with a
// strong vision model (Claude) through the editable rubric (rubric.md).
// Run: npm run critique [-- <runDir>]   (defaults to the latest run)
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { critiqueSystem, critiqueUser } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRITIQUE_MODEL = process.env.CRITIQUE_MODEL || 'anthropic/claude-sonnet-4.5';

export function latestRun(bundle) {
  const runs = join(HERE, 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs).filter((d) => !bundle || d.startsWith(bundle)).sort();
  return dirs.length ? join(runs, dirs[dirs.length - 1]) : null;
}

const FLAW = z.object({
  type: z.enum(['visual', 'content', 'copy', 'layout', 'functional', 'a11y', 'performance']),
  severity: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  detail: z.string(),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 image-fraction box around the exact element this flaw is about; null for whole-screen issues'),
});
const CRITIQUE = z.object({ verdict: z.string(), flaws: z.array(FLAW) });

export async function critiqueRun(runDir) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Need OPENROUTER_API_KEY (../spike/.env)');
  const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(CRITIQUE_MODEL);
  const rubric = readFileSync(join(HERE, 'rubric.md'), 'utf8');
  const journal = readFileSync(join(runDir, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

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
    const { object } = await generateObject({
      model, schema: CRITIQUE,
      messages: [
        { role: 'system', content: critiqueSystem(rubric) },
        { role: 'user', content: [
          { type: 'text', text: critiqueUser({ screen: s.screen }) },
          { type: 'image', image: `data:image/png;base64,${b64}` },
        ]},
      ],
    });
    const flaws = object.flaws.map((f) => ({ id: `C-${String(++flawN).padStart(3, '0')}`, ...f }));
    appendFileSync(out, JSON.stringify({ screenshot: s.file, screen: s.screen, verdict: object.verdict, flaws }) + '\n');
    n += flaws.length;
    console.log(`  ${s.file}  [${s.screen}]  ${flaws.length} flaws — ${object.verdict}`);
    console.log('@@PROGRESS ' + JSON.stringify({ screenshot: s.file, screen: s.screen, flaws: flaws.length, verdict: object.verdict }));
  }
  console.log(`\ncritique done: ${n} flaws across ${shots.length} screens → ${out}`);
  return out;
}

// CLI entry
let runDir = process.argv[2];
if (!runDir || !existsSync(join(runDir, 'journal.jsonl'))) runDir = latestRun(process.env.BUNDLE); // arg may be a bundle
if (!runDir) { console.error('no run dir found; pass one as an argument'); process.exit(1); }
await critiqueRun(runDir);
process.exit(0);
