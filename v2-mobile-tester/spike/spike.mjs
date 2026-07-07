// v2 drive-engine spike — Vercel AI SDK loop with framework detection + a11y-tree tapping.
//
// Detects native vs Flutter from the .app bundle, switches the MODEL accordingly:
//   native / react-native -> Gemini 3.5 Flash (fast)        + tap-by-a11y-element (exact coords)
//   flutter                -> Claude (strong grounding)      + vision-estimated coords fallback
// Tapping is adaptive PER SCREEN: tap by a11y element when the tree is rich, fall back to
// vision-estimated x,y when it's thin (Flutter / canvas screens).
//
// Run: `npm run spike -- <bundleId>`  (defaults to FitTrack). One OPENROUTER_API_KEY reaches both models.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generateObject } from 'ai';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUNDLE = process.argv[2] || 'ai.beemo.fittrack';
const DEVICE = process.env.DEVICE || 'A5C6484B-5346-4BEC-8F4C-FFDDA286D71C';
const MAX_STEPS = Number(process.env.MAX_STEPS || 12);
const GOAL = process.env.GOAL ||
  'Log in with username "demo" and password "demo", then explore the dashboard and note anything broken.';
const VISION_ONLY = !!process.env.VISION_ONLY; // force vision-coordinate grounding (ignore a11y tree) — for the grounding A/B
const LAUNCH_WAIT = Number(process.env.LAUNCH_WAIT || 10000); // poll up to this long for first app content after launch (heavy Flutter cold-starts)

// ---- detect framework from the installed bundle (deterministic, no LLM) ----
function detectFramework(device, bundle) {
  try {
    const app = execSync(`xcrun simctl get_app_container ${device} ${bundle} app`, { encoding: 'utf8' }).trim();
    if (existsSync(`${app}/Frameworks/Flutter.framework`)) return 'flutter';
    if (existsSync(`${app}/Frameworks/hermes.framework`) || existsSync(`${app}/main.jsbundle`)) return 'react-native';
    return 'native';
  } catch { return 'native'; }
}
const FRAMEWORK = process.env.FRAMEWORK || detectFramework(DEVICE, BUNDLE);
const ENGINE = process.env.ENGINE || (FRAMEWORK === 'flutter' ? 'claude' : 'gemini');

// ---- one OpenRouter key reaches both models ----
if (!process.env.OPENROUTER_API_KEY) { console.error('Need OPENROUTER_API_KEY in spike/.env'); process.exit(1); }
const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const MODEL = process.env.MODEL || (ENGINE === 'claude' ? 'anthropic/claude-sonnet-4.5' : 'google/gemini-3.5-flash');
const model = or(MODEL);
const reasoningOpts = ENGINE === 'gemini' ? { openrouter: { reasoning: { effort: 'minimal' } } } : {};
console.log(`framework: ${FRAMEWORK}  ->  engine: ${ENGINE}  ->  model: ${MODEL}\n`);

// ---- connect mobile-mcp ----
const mcp = new Client({ name: 'v2-spike', version: '0.0.0' });
await mcp.connect(new StdioClientTransport({ command: 'npx', args: ['-y', '@mobilenext/mobile-mcp@latest'] }));
const { tools } = await mcp.listTools();
const nameOf = (...kw) => tools.find((t) => kw.every((k) => t.name.toLowerCase().includes(k)))?.name;
const T = {
  screenshot: nameOf('take', 'screenshot') ?? nameOf('screenshot'),
  launch: nameOf('launch'),
  tap: nameOf('click', 'coordinates') ?? nameOf('tap'),
  type: nameOf('type'),
  list: nameOf('list', 'elements'),
  size: nameOf('screen', 'size'),
};
const raw = (name, args = {}) => mcp.callTool({ name, arguments: args });
const call = (name, args = {}) => raw(name, { device: DEVICE, ...args });

// ---- helpers ----
const grabImage = (res) => {
  const img = (res?.content || []).find((c) => c.type === 'image');
  if (!img) throw new Error('no image content: ' + JSON.stringify(res?.content)?.slice(0, 300));
  return img;
};
// parse the a11y tree -> [{label, x, y}] (center points). Defensive about shape.
function parseElements(res) {
  const txt = (res?.content || []).find((c) => c.type === 'text')?.text;
  if (!txt) return [];
  const s = txt.indexOf('['), e = txt.lastIndexOf(']'); // strip "Found these elements on screen: " prefix
  if (s === -1 || e === -1) return [];
  let data; try { data = JSON.parse(txt.slice(s, e + 1)); } catch { return []; }
  const roots = Array.isArray(data) ? data : (data.elements || data.children || []);
  const out = [];
  const walk = (el) => {
    if (!el || typeof el !== 'object') return;
    const label = el.label ?? el.name ?? el.text ?? el.value ?? el.identifier ?? el.type;
    const r = el.rect ?? el.frame ?? el.coordinates ?? el; // mobile-mcp uses `coordinates:{x,y,width,height}`
    let x = null, y = null;
    if (r && r.width != null) { x = Math.round(r.x + r.width / 2); y = Math.round(r.y + r.height / 2); }
    else if (r && r.x1 != null) { x = Math.round((r.x1 + r.x2) / 2); y = Math.round((r.y1 + r.y2) / 2); }
    else if (el.x != null && el.y != null) { x = Math.round(el.x); y = Math.round(el.y); }
    if (label && x != null) out.push({ label: String(label).slice(0, 40), x, y });
    (el.children || []).forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

const ACTION = z.object({
  visibleText: z.array(z.string()),
  action: z.object({
    kind: z.enum(['tapElement', 'typeInElement', 'tapXY', 'done']),
    elementIndex: z.number().int().nullable().describe('index into the ELEMENTS list, or null'),
    x: z.number().int().nullable().describe('vision-estimated tap x (only if no element), or null'),
    y: z.number().int().nullable(),
    text: z.string().nullable().describe('text to type, or null'),
    reason: z.string(),
  }),
});

// ---- run ----
if (T.launch) {
  const r = await call(T.launch, { packageName: BUNDLE }).catch((e) => ({ error: e.message }));
  console.log('launch:', JSON.stringify(r?.content ?? r));
  // wait up to LAUNCH_WAIT ms for the first screen to actually paint — poll the a11y tree,
  // proceed early once content appears (don't drive a blank cold-start screen).
  const start = Date.now();
  let ready = 0;
  while (Date.now() - start < LAUNCH_WAIT) {
    ready = T.list ? parseElements(await call(T.list).catch(() => null)).length : 0;
    if (ready >= 3) break;
    await sleep(700);
  }
  console.log(`app ready: ${ready} a11y elements after ${Date.now() - start}ms (cap ${LAUNCH_WAIT}ms)`);
}
const size = JSON.stringify((T.size ? await call(T.size).catch(() => null) : null)?.content ?? 'unknown');

const timings = [], history = [];
let surfacedText = [], richestTree = 0;
for (let step = 1; step <= MAX_STEPS; step++) {
  const img = grabImage(await call(T.screenshot));
  const els = (!VISION_ONLY && T.list) ? parseElements(await call(T.list).catch(() => null)) : [];
  richestTree = Math.max(richestTree, els.length);
  if (step === 1) console.log(`a11y elements (${els.length}): ${els.slice(0, 14).map((e, i) => `[${i}]${e.label}`).join(' ')}\n`);
  const elemText = els.length
    ? els.map((e, i) => `[${i}] "${e.label}" @${e.x},${e.y}`).join('\n')
    : '(a11y tree EMPTY — use tapXY estimated from the image)';

  const t0 = performance.now();
  const { object } = await generateObject({
    model, schema: ACTION, providerOptions: reasoningOpts,
    messages: [
      { role: 'system', content:
        `Drive an iOS app. Goal: ${GOAL}\n` +
        `Report visible text EXACTLY (include any misspellings or placeholder text; do NOT correct them).\n` +
        `PREFER tapElement / typeInElement with an ELEMENTS index (exact coords). Use tapXY only if the list is empty or your target isn't in it.\n` +
        `If PRIOR ACTIONS did not change the screen, do NOT repeat — try something else or kind:"done". screen=${size}.` },
      { role: 'user', content: [
        { type: 'text', text:
          `Step ${step}. PRIOR ACTIONS:\n${history.slice(-8).join('\n') || '(none)'}\n\n` +
          `ELEMENTS:\n${elemText}\n\nWhat text is on screen, and what is the next action?` },
        { type: 'image', image: `data:${img.mimeType};base64,${img.data}` },
      ]},
    ],
  });
  const dt = Math.round(performance.now() - t0);
  timings.push(dt);
  if (step === 1) surfacedText = object.visibleText;

  const a = object.action;
  let tx = a.x, ty = a.y, via = 'xy';
  if ((a.kind === 'tapElement' || a.kind === 'typeInElement') && a.elementIndex != null && els[a.elementIndex]) {
    tx = els[a.elementIndex].x; ty = els[a.elementIndex].y; via = `elem[${a.elementIndex}]"${els[a.elementIndex].label}"`;
  }
  console.log(`step ${step} (${dt}ms) ${a.kind} via ${via} ${tx ?? ''}${ty != null ? ',' + ty : ''} ${a.text ?? ''} | ${a.reason}`);
  console.log(`        sees: ${JSON.stringify(object.visibleText)}`);

  if (a.kind === 'done') break;
  if (tx != null && ty != null && T.tap) await call(T.tap, { x: tx, y: ty }).catch((e) => console.log('  tap err:', e.message));
  if (a.kind === 'typeInElement' && a.text && T.type) { await sleep(350); await call(T.type, { text: a.text }).catch((e) => console.log('  type err:', e.message)); }
  history.push(`step ${step}: ${a.kind} ${via}${a.text ? ` "${a.text}"` : ''}`);
  await sleep(900);
}

const avg = Math.round(timings.reduce((s, x) => s + x, 0) / (timings.length || 1));
const expect = ['FitTrack', 'Username', 'Password', 'Log In'];
const saw = expect.filter((e) => surfacedText.join(' | ').toLowerCase().includes(e.toLowerCase()));
console.log('\n================ VERDICT ================');
console.log(`FRAMEWORK -> ENGINE: ${FRAMEWORK} -> ${ENGINE} (${MODEL})`);
console.log(`A11Y TREE: richest screen had ${richestTree} elements  (rich => tap-by-label; ~0 => vision fallback)`);
console.log(`SCREENSHOT SURVIVAL: read ${saw.length}/${expect.length} expected strings (${saw.join(', ') || 'NONE'})`);
console.log(`LATENCY: per-step ${timings.join(', ')} ms  (avg ${avg} ms)  vs Claude baseline ~3500 ms`);
console.log('=========================================');

await mcp.close();
process.exit(0);
