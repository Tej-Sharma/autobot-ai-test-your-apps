// ============================================================================
// web/critique.mjs — web entrypoint for the shared critique pass
// (core/critique.mjs). Owns the runs-dir default and the web rubric/prompts.
// Run: npm run critique:web [-- <runDir>]   (defaults to the latest run)
// ============================================================================
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { critiqueRun as coreCritiqueRun } from '../core/critique.mjs';
import { critiqueSystem, critiqueUser } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function latestRun(target) {
  const runs = join(HERE, 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs).filter((d) => !target || d.startsWith(target)).sort();
  return dirs.length ? join(runs, dirs[dirs.length - 1]) : null;
}

export const critiqueRun = (runDir) => coreCritiqueRun(runDir, {
  rubricPath: join(HERE, 'rubric.md'),
  envHint: '../v2-mobile-tester/spike/.env, loaded by the npm scripts',
  critiqueSystem, critiqueUser,
});

// CLI entry
let runDir = process.argv[2];
if (!runDir || !existsSync(join(runDir, 'journal.jsonl'))) runDir = latestRun(process.env.BUNDLE); // arg may be a target
if (!runDir) { console.error('no run dir found; pass one as an argument'); process.exit(1); }
await critiqueRun(runDir);
process.exit(0);
