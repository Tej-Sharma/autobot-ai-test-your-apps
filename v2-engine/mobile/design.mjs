// ============================================================================
// mobile/design.mjs — iOS entrypoint for the shared design pass
// (core/design.mjs): Figma design-fidelity comparison. Owns only the runs-dir
// default and CLI main. Self-gating: a no-op unless FIGMA_URL is set.
// Run: npm run design:mobile [-- <runDir>]   (defaults to the latest run)
// ============================================================================
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designRun as coreDesignRun } from '../core/design.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function latestRun(bundle) {
  const runs = join(HERE, 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs).filter((d) => !bundle || d.startsWith(bundle)).sort();
  return dirs.length ? join(runs, dirs[dirs.length - 1]) : null;
}

export const designRun = (runDir) => coreDesignRun(runDir, {
  noun: 'screen',
  envHint: '../v2-mobile-tester/spike/.env, loaded by the npm scripts',
});

// CLI entry
let runDir = process.argv[2];
if (!runDir || !existsSync(join(runDir, 'journal.jsonl'))) runDir = latestRun(process.env.BUNDLE); // arg may be a bundle
if (!runDir) { console.error('no run dir found; pass one as an argument'); process.exit(1); }
await designRun(runDir);
process.exit(0);
