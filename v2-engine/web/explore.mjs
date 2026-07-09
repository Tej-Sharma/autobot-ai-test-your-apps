// ============================================================================
// web/explore.mjs — web entrypoint for the shared explore loop. Owns config
// (env/argv, exactly as the old engine read them) and wires the web driver +
// prompts + schema into core/explore.mjs.
//   node web/explore.mjs [<target>]   MODEL, GLOBAL_STEPS, GOAL, NAV_WAIT, FLOW_MIN_STEPS
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExplore, credLineOf, signupCreds, entryLineOf } from '../core/explore.mjs';
import { exploreSystem } from './prompts.mjs';
import { TURN } from './schema.mjs';
import { createWebDriver } from './driver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2] || 'the-constella-app';
const MODEL = process.env.MODEL || 'google/gemini-3.5-flash';
const GLOBAL_STEPS = Number(process.env.GLOBAL_STEPS || 40);
const NAV_WAIT = Number(process.env.NAV_WAIT || 10000);
const VIEWPORT = process.env.VIEWPORT || '1280x800';
const GOAL = process.env.GOAL || '';
const FOCUS = process.env.FOCUS || '';
const FLOW_MIN_STEPS = Number(process.env.FLOW_MIN_STEPS || 5);

if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY (../v2-mobile-tester/spike/.env, loaded by the npm scripts)'); process.exit(1); }

// INPUTS_DIR lets the desktop app point config at a writable location (userData) —
// packaged, HERE is inside the read-only .app bundle. Falls back to HERE for the CLI.
const inputsPath = join(process.env.INPUTS_DIR || join(HERE, 'inputs'), `${TARGET}.json`);
const INPUTS = existsSync(inputsPath) ? JSON.parse(readFileSync(inputsPath, 'utf8')) : {};
if (!INPUTS.url) { console.error(`Need inputs/${TARGET}.json with a "url" field.`); process.exit(1); }
const START_URL = INPUTS.url;

// Entry mode (MODE=login|signup, unset = test from the site's current state). No app-reset
// step on web — the driver already starts a fresh browser context, so "fresh state" holds.
const MODE = (process.env.MODE || '').toLowerCase();
let credLine = credLineOf(INPUTS), ENTRY = '';
if (MODE === 'signup') {
  const creds = signupCreds();
  ENTRY = entryLineOf('signup', creds);
  credLine = credLineOf({ credentials: creds });
  console.log(`entry mode: signup — generated test credentials: ${creds.username} / ${creds.password} (log-only, not saved)`);
} else if (MODE === 'login' && INPUTS.credentials) {
  ENTRY = entryLineOf('login');
  console.log('entry mode: login — signing in with saved credentials first');
}
const ABOUT = INPUTS.about ? String(INPUTS.about).trim() : `No description provided for ${START_URL} — explore the UI to learn what it does and offers.`;
// app-specific test instructions, auto-loaded by target id: instructions/<target>.md
const instrPath = join(HERE, 'instructions', `${TARGET}.md`);
const APP_INSTRUCTIONS = existsSync(instrPath) ? readFileSync(instrPath, 'utf8').trim() : '';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN = process.env.RUN_DIR || join(HERE, 'runs', `${TARGET}__explore__${stamp}`);
const STATE = process.env.STATE_GRAPH || join(RUN, 'state-graph.json');

const driver = createWebDriver({ TARGET, START_URL, NAV_WAIT, VIEWPORT, RUN });
await runExplore({ driver, cfg: {
  MODEL, GLOBAL_STEPS, GOAL, FOCUS, FLOW_MIN_STEPS, RUN, STATE,
  ABOUT, credLine, APP_INSTRUCTIONS, instrPath, exploreSystem, TURN, ENTRY,
} });
process.exit(0);
