// ============================================================================
// mobile/explore.mjs — iOS entrypoint for the shared explore loop. Owns config
// (env/argv, exactly as the old engine read them), app metadata detection, and
// wires the mobile driver + prompts + schema into core/explore.mjs.
//   node mobile/explore.mjs [<bundle>]   DEVICE, MODEL, GLOBAL_STEPS, GOAL, LAUNCH_WAIT
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExplore, credLineOf } from '../core/explore.mjs';
import { exploreSystem } from './prompts.mjs';
import { TURN } from './schema.mjs';
import { createMobileDriver } from './driver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = process.argv[2] || 'ai.beemo.fittrack';
const DEVICE = process.env.DEVICE || 'A5C6484B-5346-4BEC-8F4C-FFDDA286D71C';
const MODEL = process.env.MODEL || 'google/gemini-3.5-flash';
const GLOBAL_STEPS = Number(process.env.GLOBAL_STEPS || 40);
const LAUNCH_WAIT = Number(process.env.LAUNCH_WAIT || 10000);
const GOAL = process.env.GOAL || '';
const FOCUS = process.env.FOCUS || '';
const FLOW_MIN_STEPS = Number(process.env.FLOW_MIN_STEPS || 5);

if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY (../v2-mobile-tester/spike/.env, loaded by the npm scripts)'); process.exit(1); }

// INPUTS_DIR lets the desktop app point config at a writable location (userData) —
// packaged, HERE is inside the read-only .app bundle. Falls back to HERE for the CLI.
const inputsPath = join(process.env.INPUTS_DIR || join(HERE, 'inputs'), `${BUNDLE}.json`);
const INPUTS = existsSync(inputsPath) ? JSON.parse(readFileSync(inputsPath, 'utf8')) : {};
// app-specific test instructions, auto-loaded by app id: instructions/<bundle>.md
const instrPath = join(HERE, 'instructions', `${BUNDLE}.md`);
const APP_INSTRUCTIONS = existsSync(instrPath) ? readFileSync(instrPath, 'utf8').trim() : '';
const credLine = credLineOf(INPUTS);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = process.env.RUN_DIR || join(HERE, 'runs', `${BUNDLE}__explore__${stamp}`);
const STATE = process.env.STATE_GRAPH || join(RUN, 'state-graph.json');

// "About the app" — user-provided `about` in inputs, else auto-detected app metadata.
function appAbout() {
  if (INPUTS.about) return String(INPUTS.about).trim();
  const bits = [];
  try {
    const apps = JSON.parse(execSync(`ios apps --udid=${DEVICE}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
    const a = (Array.isArray(apps) ? apps : []).find((x) => x.CFBundleIdentifier === BUNDLE);
    if (a) { if (a.CFBundleDisplayName || a.CFBundleName) bits.push(a.CFBundleDisplayName || a.CFBundleName); if (a.CFBundleShortVersionString) bits.push(`v${a.CFBundleShortVersionString}`); }
  } catch {}
  if (!bits.length) {
    try {
      const app = execSync(`xcrun simctl get_app_container ${DEVICE} ${BUNDLE} app`, { encoding: 'utf8' }).trim();
      const p = JSON.parse(execSync(`plutil -convert json -o - "${app}/Info.plist"`, { encoding: 'utf8' }));
      if (p.CFBundleDisplayName || p.CFBundleName) bits.push(p.CFBundleDisplayName || p.CFBundleName);
      if (p.CFBundleShortVersionString) bits.push(`v${p.CFBundleShortVersionString}`);
      const schemes = (p.CFBundleURLTypes || []).flatMap((t) => t.CFBundleURLSchemes || []);
      if (schemes.length) bits.push(`deep-link schemes: ${schemes.slice(0, 6).join(', ')}`);
      const perms = Object.keys(p).filter((k) => /UsageDescription$/.test(k)).map((k) => k.replace(/^NS|UsageDescription$/g, ''));
      if (perms.length) bits.push(`uses: ${perms.join(', ')}`);
    } catch {}
  }
  return bits.length
    ? `${bits.join(' · ')} · ${BUNDLE}  (auto-detected metadata — no written description, so explore the UI to learn what it does).`
    : `Bundle id ${BUNDLE}. No description or metadata available — explore the UI to learn what the app does.`;
}
const ABOUT = appAbout();

const driver = createMobileDriver({ BUNDLE, DEVICE, LAUNCH_WAIT, RUN });
await runExplore({ driver, cfg: {
  MODEL, GLOBAL_STEPS, GOAL, FOCUS, FLOW_MIN_STEPS, RUN, STATE,
  ABOUT, credLine, APP_INSTRUCTIONS, instrPath, exploreSystem, TURN,
} });
process.exit(0);
