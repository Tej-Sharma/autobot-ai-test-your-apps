// ============================================================================
// parity/check.mjs — proves the unified engine produces EXACTLY what the two
// old engines produced, for everything that shapes model behavior and run
// artifacts:
//   1. PROMPTS   — every export of the old prompts.mjs files (imported live
//                  from the old engine dirs) vs the new platform prompt
//                  modules, byte-for-byte, across a grid of fixture inputs.
//   2. SCHEMAS   — the old FLAW/TURN zod schemas (verbatim transcriptions in
//                  old-schemas.mjs) vs the new composed schemas, compared as
//                  full structural serializations (types, enums, nullability,
//                  int checks, describe() strings).
//   3. RENDERERS — the old memory/coverage/actionStr renderers (verbatim
//                  transcriptions) vs core/explore.mjs's shared renderers with
//                  each platform's voc, byte-for-byte on fixture state.
//   4. STATEGRAPH — old stategraph.mjs (imported live) vs new platform
//                  stategraph modules on fixture element trees.
// Run: npm run parity   (exits non-zero on any mismatch, printing a diff)
// ============================================================================
import * as oldMobileP from '../../v2-mobile-tester/engine/prompts.mjs';
import * as oldWebP from '../../v2-web-tester/engine/prompts.mjs';
import * as oldMobileSG from '../../v2-mobile-tester/engine/stategraph.mjs';
import * as oldWebSG from '../../v2-web-tester/engine/stategraph.mjs';
import * as newMobileP from '../mobile/prompts.mjs';
import * as newWebP from '../web/prompts.mjs';
import * as newMobileSG from '../mobile/stategraph.mjs';
import * as newWebSG from '../web/stategraph.mjs';
import { MOBILE_TURN, WEB_TURN } from './old-schemas.mjs';
import { TURN as NEW_MOBILE_TURN } from '../mobile/schema.mjs';
import { TURN as NEW_WEB_TURN } from '../web/schema.mjs';
import { oldMobileRenderMemory, oldMobileRenderCoverage, oldMobileActionStr,
  oldWebRenderMemory, oldWebRenderCoverage, oldWebActionStr } from './old-renderers.mjs';
import { renderMemory, renderCoverage } from '../core/explore.mjs';
import { createMobileDriver } from '../mobile/driver.mjs';
import { createWebDriver } from '../web/driver.mjs';

let pass = 0, fail = 0;
function eq(name, a, b) {
  if (a === b) { pass++; return; }
  fail++;
  console.error(`\n✗ MISMATCH: ${name}`);
  const A = String(a).split('\n'), B = String(b).split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) {
      console.error(`  first diff at line ${i + 1}:`);
      console.error(`    old: ${JSON.stringify(A[i])}`);
      console.error(`    new: ${JSON.stringify(B[i])}`);
      break;
    }
  }
}
const eqJson = (name, a, b) => eq(name, JSON.stringify(a, null, 1), JSON.stringify(b, null, 1));

// ---------------------------------------------------------------------------
// 1. PROMPTS — byte-for-byte over a fixture grid
// ---------------------------------------------------------------------------
const MEMORY_SAMPLE = `--- step: 0  |  time: 2026-07-03T00:00:00.000Z  |  screen: Home
  action: tap 'Start'
  expectation: workout starts
  result: it started
  reasoning: core flow first
  uiDone: Home screen with Start button
  goalsSoFar: test workouts
  goalsCompleted: —
  areasRemaining: settings
  flaws: —
  crashed: false`;
const COVERAGE_SAMPLE = `Screens mapped: 3 · controls exercised: 4/9\nUntried on THIS screen: Profile, History`;

const grid = [];
for (const goal of ['', 'Focus on onboarding'])
  for (const focus of ['', 'Try the checkout edge cases'])
    for (const appInstructions of ['', 'Log in with the test account first.'])
      for (const coverage of ['', COVERAGE_SAMPLE])
        for (const memory of ['(empty — this is your first turn)', MEMORY_SAMPLE])
          grid.push({
            about: 'FitTrack v2.1 · ai.beemo.fittrack', size: '{"width":390,"height":844}',
            goal, focus, appInstructions, coverage, memory,
            credLine: 'Test credentials you may use to sign in — username: "u@x.com", password: "pw".',
          });
grid.push({ about: 'X', size: '1280x800', goal: '', focus: '', appInstructions: '', coverage: '', memory: '(empty — this is your first turn)', credLine: 'No credentials provided.' });

grid.forEach((f, i) => {
  eq(`mobile exploreSystem [${i}]`, oldMobileP.exploreSystem(f), newMobileP.exploreSystem(f));
  eq(`web exploreSystem [${i}]`, oldWebP.exploreSystem(f), newWebP.exploreSystem(f));
});

for (const [i, f] of [
  { about: 'App A', size: '390x844', goal: '' },
  { about: 'App B', size: '1280x800', goal: 'Push the checkout flow' },
].entries()) {
  eq(`mobile reviewSystem [${i}]`, oldMobileP.reviewSystem(f), newMobileP.reviewSystem(f));
  eq(`web reviewSystem [${i}]`, oldWebP.reviewSystem(f), newWebP.reviewSystem(f));
}

const memFixtures = [
  { lastAction: null, diff: null, recent: [], trail: [], untried: [], knownFlaws: [], seen: [] },
  { lastAction: "tap 'Start'", diff: { changed: true, appeared: ['timer'], disappeared: [] },
    recent: ["tap 'Start'", "tap 'Pause'"], trail: [{ name: 'Home', desc: 'the home screen' }],
    untried: ['Profile'], knownFlaws: ['F-001 dead button'], seen: ['Home', 'Workout'] },
  { lastAction: "click 'Submit'", diff: { changed: false, appeared: [], disappeared: [] },
    recent: ["click 'Submit'"], trail: [{ name: 'Form', desc: 'signup form' }],
    untried: [], knownFlaws: [], seen: ['Form'], consoleErrors: 2, failedRequests: ['1. [POST] /api => [500]'] },
];
memFixtures.forEach((f, i) => {
  eq(`mobile reviewMemory [${i}]`, oldMobileP.reviewMemory(f), newMobileP.reviewMemory(f));
  eq(`web reviewMemory [${i}]`, oldWebP.reviewMemory(f), newWebP.reviewMemory(f));
});

const ru = { mem: 'MEM BLOCK', elemText: '[0] "Start" (button)' };
eq('mobile reviewUser', oldMobileP.reviewUser(ru), newMobileP.reviewUser(ru));
eq('web reviewUser', oldWebP.reviewUser(ru), newWebP.reviewUser(ru));

const bs = { about: 'An app', credLine: 'No credentials provided.', size: '390x844' };
eq('mobile bootstrapSystem', oldMobileP.bootstrapSystem(bs), newMobileP.bootstrapSystem(bs));
eq('web bootstrapSystem', oldWebP.bootstrapSystem(bs), newWebP.bootstrapSystem(bs));
eq('mobile bootstrapUser (no memory)', oldMobileP.bootstrapUser({ elemText: '[0] "Go"' }), newMobileP.bootstrapUser({ elemText: '[0] "Go"' }));
eq('mobile bootstrapUser (memory)', oldMobileP.bootstrapUser({ elemText: '[0] "Go"', memory: 'RECENT: tapped Go' }), newMobileP.bootstrapUser({ elemText: '[0] "Go"', memory: 'RECENT: tapped Go' }));
eq('web bootstrapUser', oldWebP.bootstrapUser({ elemText: '[0] "Go"' }), newWebP.bootstrapUser({ elemText: '[0] "Go"' }));

eq('mobile critiqueSystem', oldMobileP.critiqueSystem('RUBRIC L1\nRUBRIC L2'), newMobileP.critiqueSystem('RUBRIC L1\nRUBRIC L2'));
eq('web critiqueSystem', oldWebP.critiqueSystem('RUBRIC L1\nRUBRIC L2'), newWebP.critiqueSystem('RUBRIC L1\nRUBRIC L2'));
eq('mobile critiqueUser', oldMobileP.critiqueUser({ screen: 'Workout summary' }), newMobileP.critiqueUser({ screen: 'Workout summary' }));
eq('web critiqueUser', oldWebP.critiqueUser({ screen: 'Checkout' }), newWebP.critiqueUser({ screen: 'Checkout' }));

// ---------------------------------------------------------------------------
// 2. SCHEMAS — full structural serialization
// ---------------------------------------------------------------------------
function serialize(s) {
  const d = s._def; const t = d.typeName;
  const base = { t, ...(d.description !== undefined ? { desc: d.description } : {}) };
  switch (t) {
    case 'ZodObject': return { ...base, shape: Object.fromEntries(Object.entries(d.shape()).map(([k, v]) => [k, serialize(v)])) };
    case 'ZodArray': return { ...base, el: serialize(d.type) };
    case 'ZodEnum': return { ...base, values: d.values };
    case 'ZodNullable': case 'ZodOptional': return { ...base, inner: serialize(d.innerType) };
    case 'ZodNumber': return { ...base, checks: d.checks || [] };
    case 'ZodString': return { ...base, checks: d.checks || [] };
    case 'ZodBoolean': return base;
    case 'ZodEffects': return { ...base, inner: serialize(d.schema) };
    default: return { ...base, UNHANDLED: t };
  }
}
eqJson('mobile TURN schema', serialize(MOBILE_TURN), serialize(NEW_MOBILE_TURN));
eqJson('web TURN schema', serialize(WEB_TURN), serialize(NEW_WEB_TURN));

// ---------------------------------------------------------------------------
// 3. RENDERERS — memory / coverage / actionStr on fixture state
// ---------------------------------------------------------------------------
// Drivers are constructed only for their pure voc/actionStr — start() is never called.
const mDriver = createMobileDriver({ BUNDLE: 'x', DEVICE: 'no-such-device', LAUNCH_WAIT: 0, RUN: '/tmp' });
const wDriver = createWebDriver({ TARGET: 'x', START_URL: 'https://x.dev', NAV_WAIT: 0, VIEWPORT: '1280x800', RUN: '/tmp' });

const mTrace = [
  { step: 0, time: 'T0', screen: 'Home', action: "tap 'Start'", expectation: 'starts', expectationCheck: 'n/a',
    reasoning: 'core first', uiDone: 'home', goalsSoFar: ['workouts'], goalsCompleted: [], areasRemaining: ['settings'], flaws: [], crashed: false },
  { step: 1, time: 'T1', screen: 'Workout', action: 'swipe up', expectation: 'scrolls', expectationCheck: 'it scrolled',
    reasoning: 'see more', uiDone: 'workout list', goalsSoFar: ['workouts'], goalsCompleted: ['open workout'], areasRemaining: [], flaws: ['typo in title'], crashed: false },
];
const wTrace = mTrace.map((t) => ({ ...t, url: 'https://x.dev/w' }));
eq('mobile renderMemory (empty)', oldMobileRenderMemory([]), renderMemory([], mDriver.voc));
eq('mobile renderMemory', oldMobileRenderMemory(mTrace), renderMemory(mTrace, mDriver.voc));
eq('web renderMemory (empty)', oldWebRenderMemory([]), renderMemory([], wDriver.voc));
eq('web renderMemory', oldWebRenderMemory(wTrace), renderMemory(wTrace, wDriver.voc));

const mkGraph = (withUrl) => ({ nodes: {
  s1: { name: 'Home', signature: 's1', ...(withUrl ? { url: 'https://x.dev/' } : {}), tried: ['Start'], controls: ['Start', 'Profile', 'History'] },
  s2: { name: 'Settings', signature: 's2', ...(withUrl ? { url: 'https://x.dev/settings' } : {}), tried: [], controls: ['Units', 'Theme', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
  s3: { name: 'Done', signature: 's3', tried: ['Ok'], controls: ['Ok'] },
} });
const mEls = [
  { label: 'Start', x: 100, y: 300, type: 'button' }, { label: 'Profile', x: 200, y: 300, type: 'button' },
  { label: 'History', x: 300, y: 300, type: 'button' }, { label: 'Home', x: 50, y: 800, type: 'button' },
];
const wEls = [
  { label: 'Start', ref: 'e1', role: 'button', landmark: null }, { label: 'Profile', ref: 'e2', role: 'link', landmark: null },
  { label: 'History', ref: 'e3', role: 'link', landmark: null }, { label: 'Home', ref: 'e4', role: 'link', landmark: 'navigation' },
];
const flows = [{ name: 'Sign up', startStep: 0, endStep: 6 }];
for (const [label, seen, tried, fl] of [
  ['bare', new Set(), new Set(), []],
  ['chrome+flows', new Set(['home', 'more']), new Set(['home']), flows],
]) {
  eq(`mobile renderCoverage (${label})`,
    oldMobileRenderCoverage({ g: mkGraph(false), sig: 's1', els: mEls, tabsSeen: seen, tabsTried: tried, flowsDone: fl, controlsOf: oldMobileSG.controlsOf }),
    renderCoverage({ g: mkGraph(false), sig: 's1', els: mEls, chromeSeen: seen, chromeTried: tried, flowsDone: fl, controlsOf: newMobileSG.controlsOf, voc: mDriver.voc }));
  eq(`web renderCoverage (${label})`,
    oldWebRenderCoverage({ g: mkGraph(true), sig: 's1', els: wEls, navSeen: seen, navTried: tried, flowsDone: fl, controlsOf: oldWebSG.controlsOf }),
    renderCoverage({ g: mkGraph(true), sig: 's1', els: wEls, chromeSeen: seen, chromeTried: tried, flowsDone: fl, controlsOf: newWebSG.controlsOf, voc: wDriver.voc }));
}

for (const a of [
  { kind: 'tap', label: 'Start' }, { kind: 'type', label: 'Email', text: 'a@b.c' },
  { kind: 'swipe', direction: 'up' }, { kind: 'back' }, { kind: 'stop' },
]) eq(`mobile actionStr ${a.kind}`, oldMobileActionStr(a), mDriver.actionStr(a));
for (const a of [
  { kind: 'click', label: 'Start' }, { kind: 'type', label: 'Email', text: 'a@b.c' },
  { kind: 'navigate', url: 'https://x.dev/settings' }, { kind: 'back' }, { kind: 'stop' },
]) eq(`web actionStr ${a.kind}`, oldWebActionStr(a), wDriver.actionStr(a));

// ---------------------------------------------------------------------------
// 4. STATEGRAPH — old module vs new platform module on fixture trees
// ---------------------------------------------------------------------------
const mElsFull = [...mEls, { label: 'Back', x: 30, y: 50 }, { label: '12:30', x: 200, y: 100 },
  { label: 'Email field', x: 200, y: 200, type: 'textfield' }, { label: 'Workouts', x: 180, y: 800, type: 'button' },
  { label: 'Profile', x: 300, y: 805, type: 'button' }];
eq('mobile screenSignature', oldMobileSG.screenSignature(mElsFull), newMobileSG.screenSignature(mElsFull));
eqJson('mobile detectTabs', oldMobileSG.detectTabs(mElsFull, 390, 844), newMobileSG.detectTabs(mElsFull, 390, 844));
eqJson('mobile controlsOf', oldMobileSG.controlsOf(mElsFull, ['home']), newMobileSG.controlsOf(mElsFull, ['home']));
eqJson('mobile diffTrees', oldMobileSG.diffTrees(mEls, mElsFull), newMobileSG.diffTrees(mEls, mElsFull));

const wElsFull = [...wEls, { label: 'Some long data row, with commas, and a date', ref: 'e9', role: 'listitem', landmark: null },
  { label: 'Sign in', ref: 'e5', role: 'button', landmark: 'banner' }, { label: 'Docs', ref: 'e6', role: 'link', landmark: 'navigation' }];
eq('web screenSignature', oldWebSG.screenSignature('/home', wElsFull), newWebSG.screenSignature('/home', wElsFull));
eqJson('web detectNav', oldWebSG.detectNav(wElsFull), newWebSG.detectNav(wElsFull));
eqJson('web controlsOf', oldWebSG.controlsOf(wElsFull, ['home']), newWebSG.controlsOf(wElsFull, ['home']));
eqJson('web diffTrees', oldWebSG.diffTrees(wEls, wElsFull), newWebSG.diffTrees(wEls, wElsFull));

// graph mutation round-trip (upsert/markTried/pushFrontier/popFrontier)
function graphRoundTrip(SG, upsertExtra, pushArgs) {
  const g = { nodes: {}, frontier: [], visited: new Set(), queued: new Set(), flaws: 0, nextTask: 1 };
  const n = SG.upsertNode(g, 'sigA', 'Home', upsertExtra);
  n.controls = ['Start', 'Profile'];
  SG.markTried(g, 'sigA', 'Start');
  SG.pushFrontier(g, 'sigA', ...pushArgs);
  const popped = SG.popFrontier(g);
  return JSON.stringify({ nodes: g.nodes, frontier: g.frontier, visited: [...g.visited], queued: [...g.queued], popped }, (k, v) => v, 1);
}
eq('mobile graph round-trip',
  graphRoundTrip(oldMobileSG, mEls, [[{ label: 'Home', x: 1, y: 2 }], [{ label: 'Profile', x: 9, y: 9 }]]),
  graphRoundTrip(newMobileSG, mEls, [[{ label: 'Home', x: 1, y: 2 }], [{ label: 'Profile', x: 9, y: 9 }]]));
eq('web graph round-trip',
  graphRoundTrip(oldWebSG, 'https://x.dev/', ['https://x.dev/', [{ url: 'https://x.dev/', label: 'Home' }], [{ label: 'Profile', role: 'link' }]]),
  graphRoundTrip(newWebSG, 'https://x.dev/', ['https://x.dev/', [{ url: 'https://x.dev/', label: 'Home' }], [{ label: 'Profile', role: 'link' }]]));

// ---------------------------------------------------------------------------
console.log(`\nparity: ${pass} checks passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('✓ unified engine is output-identical to the two old engines');
