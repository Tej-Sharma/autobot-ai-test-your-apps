// ============================================================================
// mobile/annotate.mjs — iOS entrypoint for the shared annotate pass
// (core/annotate.mjs). Owns only the runs-dir default and CLI main.
// Run: npm run annotate:mobile [-- <runDir>]   (defaults to the latest run)
// ============================================================================
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateRun } from '../core/annotate.mjs';

export { annotateRun };

const HERE = dirname(fileURLToPath(import.meta.url));

export function latestRun(bundle) {
  const runs = join(HERE, 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs).filter((d) => !bundle || d.startsWith(bundle)).sort();
  return dirs.length ? join(runs, dirs[dirs.length - 1]) : null;
}

// CLI entry
let runDir = process.argv[2];
if (!runDir || !existsSync(join(runDir, 'journal.jsonl'))) runDir = latestRun(process.env.BUNDLE);
if (!runDir) { console.error('no run dir found; pass one as an argument'); process.exit(1); }
await annotateRun(runDir);
process.exit(0);
