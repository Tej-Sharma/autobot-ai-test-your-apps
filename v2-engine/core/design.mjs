// ============================================================================
// core/design.mjs — the DESIGN pass: compares each captured screen against the
// app's Figma design. Runs after critique, before annotate. Gated: exits as a
// no-op unless FIGMA_URL is configured (the desktop app only spawns it when a
// Figma link + token exist, but the self-gate keeps `npm run test-app:*` CLI
// behavior identical without them).
//
// Three stages (spec: docs/figma-design-qa.md in the parent repo):
//   A. MAP    — deterministic screen↔frame matching: TF-IDF-weighted asymmetric
//               text containment (the frame's static text found on the screen)
//               + a box-alignment layout score when both sides have geometry.
//               No model calls; a vision tie-break only for ambiguous screens,
//               and "no design counterpart" is a valid answer (keyboards,
//               permission sheets, runtime-only states).
//   C. JUDGE  — one vision call per matched pair: implementation screenshot +
//               design PNG + the frame's element JSON as ground-truth numbers.
//               Never pixel-diffs: pixels are evidence for the judge, the node
//               data is the spec. (Stage B, the structured element diff, lands
//               in a later phase and will feed extra evidence into this call.)
//
// Artifacts: design-map.json (pairings + coverage gaps in both directions),
// design-diffs.jsonl (one line per deviation, same bbox convention as critique
// flaws so annotate/report machinery applies unchanged), design/<frame>.png
// (matched frames copied into the run dir for the report).
// ============================================================================
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getManifest } from './figma.mjs';
import { webEvidence, mobileEvidence } from './evidence.mjs';

const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const now = () => new Date().toISOString();
const b64 = (p) => readFileSync(p).toString('base64');

// ---- schemas ---------------------------------------------------------------

const TIEBREAK = z.object({
  choice: z.number().nullable().describe('index of the candidate design that this screen implements, or null if none of them do'),
  reasoning: z.string(),
});

const DIFF = z.object({
  category: z.enum(['color', 'spacing', 'typography', 'copy', 'layout', 'missing', 'extra', 'radius', 'icon', 'size']),
  severity: z.enum(['high', 'medium', 'low']),
  summary: z.string().describe('one line: what deviates'),
  detail: z.string().describe('the full finding, citing exact expected-vs-actual values from the design spec where possible'),
  expected: z.string().describe('what the design specifies, e.g. "#2563EB fill" or "16px gap"'),
  actual: z.string().describe('what the implementation shows'),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).nullable()
    .describe('normalized 0-1 box on the IMPLEMENTATION screenshot around the deviating element; null for whole-screen issues'),
});
const JUDGE = z.object({ verdict: z.string().describe('one sentence: overall fidelity of this screen to its design'), diffs: z.array(DIFF) });

// ---- stage A: deterministic mapping ----------------------------------------

// Same normalization family as the state-graph signature: lowercase, digit runs
// → '#' (live data vs designer placeholder must still match), split to words.
const tokenize = (s) => String(s ?? '').toLowerCase().replace(/\d+/g, '#')
  .split(/[^a-z#']+/).filter((w) => w.length > 1 || w === '#');

// Frame side: tokens weighted by font size (a screen title outweighs body copy).
function frameTokens(frame) {
  const w = new Map();
  for (const t of frame.texts || []) {
    const weight = Math.sqrt((t.size || 14) / 14);
    for (const tok of tokenize(t.str)) w.set(tok, Math.max(w.get(tok) || 0, weight));
  }
  return w;
}

const screenTokens = (els) => new Set((els || []).flatMap((e) => tokenize(e.label ?? e.text)));

// Asymmetric containment: how much of the FRAME's text appears on the screen.
// IDF over the frame corpus downweights chrome shared by every design frame
// ("Continue", the app name, tab labels) so screen-unique text dominates.
function textScore(screenSet, fTokens, idf) {
  let hit = 0, total = 0;
  for (const [tok, w] of fTokens) {
    const v = w * (idf.get(tok) || 1);
    total += v;
    if (screenSet.has(tok)) hit += v;
  }
  return total > 0 ? hit / total : 0;
}

// Layout score: both sides reduced to normalized center/size boxes, sorted by
// reading order, aligned with LCS; each match scores by position + size
// agreement (GUIPilot's shape, minus the detector we don't need — we have
// boxes for free on both sides). Skipped when either side lacks geometry
// (web els carry no boxes until the Phase-2 style sweep).
function normBoxes(items) {
  const boxes = items.filter((b) => b && b.w > 2 && b.h > 2);
  if (boxes.length < 3) return null;
  const xs = boxes.flatMap((b) => [b.cx - b.w / 2, b.cx + b.w / 2]);
  const ys = boxes.flatMap((b) => [b.cy - b.h / 2, b.cy + b.h / 2]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
  return boxes.map((b) => ({ cx: (b.cx - x0) / W, cy: (b.cy - y0) / H, w: b.w / W, h: b.h / H }))
    .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx)).slice(0, 60);
}
const screenBoxes = (els) => normBoxes((els || []).map((e) => (e.x != null && e.w) ? { cx: e.x, cy: e.y, w: e.w, h: e.h } : null));
const frameBoxes = (frame) => normBoxes((frame.els || []).map((e) => e.box ? { cx: e.box.x + e.box.w / 2, cy: e.box.y + e.box.h / 2, w: e.box.w, h: e.box.h } : null));

function layoutScore(a, b) {
  if (!a || !b) return null;
  const sim = (p, q) => {
    const pos = Math.exp(-6 * (Math.abs(p.cx - q.cx) + Math.abs(p.cy - q.cy)));
    const ap = p.w * p.h, aq = q.w * q.h;
    const size = Math.min(ap, aq) / Math.max(ap, aq, 1e-6);
    return pos * (0.4 + 0.6 * size);
  };
  // LCS over reading-ordered boxes, keeping only decent matches.
  const dp = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const s = sim(a[i - 1], b[j - 1]);
    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + (s > 0.3 ? s : 0));
  }
  return dp[a.length][b.length] / Math.max(a.length, b.length);
}

// ---- the pass ----------------------------------------------------------------

export async function designRun(runDir, { noun = 'screen', envHint = 'the run environment' } = {}) {
  const FIGMA_URL = (process.env.FIGMA_URL || '').trim();
  if (!FIGMA_URL) { console.log('design: no FIGMA_URL configured — skipping design comparison'); return null; }
  const token = (process.env.FIGMA_TOKEN || '').trim();
  if (!token) throw new Error('FIGMA_URL is set but FIGMA_TOKEN is missing — add a Figma personal access token');
  if (!process.env.OPENROUTER_API_KEY) throw new Error(`Need OPENROUTER_API_KEY (${envHint})`);

  const MODEL_ID = process.env.DESIGN_MODEL || process.env.CRITIQUE_MODEL || 'anthropic/claude-sonnet-4.5';
  const model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined })(MODEL_ID);
  const cacheDir = process.env.FIGMA_CACHE_DIR || join(runDir, '..', '..', 'figma-cache');

  const manifest = await getManifest({ url: FIGMA_URL, token, cacheDir });
  const frames = manifest.frames.filter((f) => f.image && existsSync(join(manifest.dir, f.image)));
  if (!frames.length) throw new Error('the Figma manifest has no renderable frames — nothing to compare against');

  // ---- unique captured screens: one representative screenshot per signature.
  // elements.jsonl carries {screenshot, screen, sig, els} per step; runs from
  // before it existed fall back to deduping by screen name (no layout score).
  const journal = readJsonl(join(runDir, 'journal.jsonl'));
  const elements = readJsonl(join(runDir, 'elements.jsonl'));
  const elsByShot = new Map(elements.map((e) => [e.screenshot, e]));
  const screens = []; const seen = new Set();
  for (const e of journal) {
    if (!e.screenshot || !existsSync(join(runDir, e.screenshot))) continue;
    const key = elsByShot.get(e.screenshot)?.sig || e.screen;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    screens.push({ screenshot: e.screenshot, screen: e.screen, sig: key, els: elsByShot.get(e.screenshot)?.els || [] });
  }
  if (!screens.length) { console.log('design: no screenshots in this run — nothing to compare'); return null; }

  console.log(`design: ${MODEL_ID} · ${screens.length} ${noun}s vs ${frames.length} design frames ("${manifest.name}")\n`);

  // ---- stage A scores
  const df = new Map();
  const fTok = frames.map((f) => frameTokens(f));
  for (const w of fTok) for (const tok of w.keys()) df.set(tok, (df.get(tok) || 0) + 1);
  const idf = new Map([...df.entries()].map(([tok, n]) => [tok, 1 + Math.log(frames.length / n)]));
  const fBox = frames.map((f) => frameBoxes(f));

  const TAU_HI = 0.6, TAU_MARGIN = 0.15, TAU_LO = 0.3;
  const pairs = []; const unmatchedScreens = [];

  for (const s of screens) {
    const sSet = screenTokens(s.els);
    const sBox = screenBoxes(s.els);
    const ranked = frames.map((f, i) => {
      const t = textScore(sSet, fTok[i], idf);
      const l = layoutScore(sBox, fBox[i]);
      return { i, score: l == null ? t : 0.65 * t + 0.35 * l };
    }).sort((a, b) => b.score - a.score);

    const [top1, top2] = ranked;
    const textSparse = sSet.size < 4;
    let decision = null;

    if (!textSparse && top1.score > TAU_HI && (top1.score - (top2?.score ?? 0)) > TAU_MARGIN) {
      decision = { frame: frames[top1.i], confidence: Math.round(top1.score * 100) / 100, method: 'text+layout' };
    } else if (top1.score >= TAU_LO || textSparse) {
      // Ambiguous (variants, sparse text) → one vision call over the top-3.
      const cands = ranked.slice(0, 3).map((r) => frames[r.i]);
      const { object: tb } = await generateObject({
        model, schema: TIEBREAK,
        messages: [
          { role: 'system', content: `You match an implemented app ${noun} to the Figma design frame it implements. Judge by structure and static labels (titles, buttons, nav). IGNORE differences between real runtime data and designer placeholder content, and ignore status bars, clocks, and keyboards. If none of the candidates is the design for this ${noun}, answer null.` },
          { role: 'user', content: [
            { type: 'text', text: `The first image is the implemented ${noun} ("${s.screen}"). The following ${cands.length} images are candidate design frames, in order: ${cands.map((c, k) => `[${k}] "${c.name}"`).join(', ')}. Which candidate (0-based index) is this ${noun} implementing — or null?` },
            { type: 'image', image: `data:image/png;base64,${b64(join(runDir, s.screenshot))}` },
            ...cands.map((c) => ({ type: 'image', image: `data:image/png;base64,${b64(join(manifest.dir, c.image))}` })),
          ] },
        ],
      });
      if (tb.choice != null && cands[tb.choice]) decision = { frame: cands[tb.choice], confidence: 0.75, method: 'vision' };
    }

    if (decision) {
      pairs.push({ ...s, ...decision });
      console.log(`  map: ${s.screenshot}  [${s.screen}]  →  "${decision.frame.name}"  (${decision.method}, ${decision.confidence})`);
    } else {
      unmatchedScreens.push({ screenshot: s.screenshot, screen: s.screen });
      console.log(`  map: ${s.screenshot}  [${s.screen}]  →  no design counterpart`);
    }
    console.log('@@PROGRESS ' + JSON.stringify({ stage: 'map', screenshot: s.screenshot, screen: s.screen,
      matched: !!decision, frame: decision?.frame.name || null }));
  }

  // ---- stage C: judge each pair with the node JSON as ground truth
  const DIFFS = join(runDir, 'design-diffs.jsonl');
  writeFileSync(DIFFS, '');
  mkdirSync(join(runDir, 'design'), { recursive: true });

  const system = `You are a design-fidelity reviewer. You compare an implemented app ${noun} against its Figma design frame and report REAL deviations a designer would log in review.

You receive: (1) the implementation screenshot, (2) the design frame rendered as an image, and (3) the design's element spec — exact boxes (in the frame's px), fills, corner radii, typography, and auto-layout gaps/padding straight from the Figma file. The spec is the ground truth for expected values: cite its numbers in "expected", never estimate design values off the rendered image.

Report deviations in: color, spacing, typography, copy, layout, missing elements, extra elements, corner radius, icons/assets, sizing. Severity: high = obvious to any viewer (wrong color/layout, missing element); medium = a designer notices (spacing/type drift); low = nitpick.

ACCEPTABLE differences — never report these: real runtime data vs designer placeholder content (names, numbers, dates, list items, photos — if the only difference in a text is its numeric or data value, it is runtime data, not a copy deviation); status bar, clock, battery, keyboard; scroll position or content that simply extends past the frame; empty-vs-populated states of the same layout; platform font rasterization. A faithful ${noun} should yield few or zero diffs — do not manufacture findings.

You may also receive MEASURED EVIDENCE — deterministic comparisons computed from the implementation's actual rendered values (computed CSS on web; accessibility geometry and pixel sampling on iOS) against the design spec. Treat these numbers as reliable measurements: report each item as a diff carrying those exact expected/actual values, unless it falls under the acceptable list above — an evidence line about runtime data (a list row, a changing value, placeholder-vs-real content) is acceptable-by-definition: drop it entirely, do not report it even as low severity. Items marked [pixel-sampled] are heuristic — verify them against the two images before reporting, and prefer medium severity for them. Evidence is a floor, not a ceiling: still report deviations you can see that the evidence missed.`;

  let diffN = 0, judged = 0;
  for (const p of pairs) {
    const framePng = join(manifest.dir, p.frame.image);
    const localFrame = join('design', p.frame.image.replace('frames/', ''));
    try { copyFileSync(framePng, join(runDir, localFrame)); } catch { /* report just falls back to no image */ }

    // Stage B: measured evidence — computed-CSS rows when the web driver swept
    // this screen (styles/<shot>.json), else a11y geometry + pixel sampling when
    // the elements carry boxes (iOS). Best-effort: evidence failures never block
    // the judge, they just leave it with images + spec only.
    let evidence = [];
    try {
      const stylesPath = join(runDir, 'styles', basename(p.screenshot).replace(/\.png$/, '.json'));
      if (existsSync(stylesPath)) evidence = webEvidence(JSON.parse(readFileSync(stylesPath, 'utf8')), p.frame, manifest.palette);
      else if ((p.els || []).some((e) => e.x != null && e.w > 0)) evidence = await mobileEvidence(p.els, p.frame, join(runDir, p.screenshot));
    } catch (e) { console.log(`   evidence skipped for ${p.screenshot}: ${e.message}`); }
    p.evidence = evidence;

    const spec = { frame: p.frame.name, width: p.frame.width, height: p.frame.height,
      elements: p.frame.els.slice(0, 120).map(({ id, ...e }) => e) };
    const { object } = await generateObject({
      model, schema: JUDGE,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: `Implemented ${noun}: "${p.screen}". Design frame: "${p.frame.name}". The first image is the IMPLEMENTATION, the second is the DESIGN. Design element spec:\n${JSON.stringify(spec)}${evidence.length ? `\n\nMEASURED EVIDENCE:\n${evidence.map((l) => `- ${l}`).join('\n')}` : ''}` },
          { type: 'image', image: `data:image/png;base64,${b64(join(runDir, p.screenshot))}` },
          { type: 'image', image: `data:image/png;base64,${b64(framePng)}` },
        ] },
      ],
    });

    for (const d of object.diffs) {
      const id = `D-${String(++diffN).padStart(3, '0')}`;
      appendFileSync(DIFFS, JSON.stringify({ id, ts: now(), screenshot: p.screenshot, screen: p.screen,
        figma_node: p.frame.id, figma_frame: p.frame.name, figma_image: localFrame, ...d }) + '\n');
    }
    judged++;
    console.log(`  ${p.screenshot}  [${p.screen}] vs "${p.frame.name}"  ${object.diffs.length} diff(s) — ${object.verdict}`);
    console.log('@@PROGRESS ' + JSON.stringify({ stage: 'judge', screenshot: p.screenshot, screen: p.screen,
      frame: p.frame.name, diffs: object.diffs.length, verdict: object.verdict }));
  }

  // ---- coverage both directions + the map artifact
  const matchedFrameIds = new Set(pairs.map((p) => p.frame.id));
  const unmatchedFrames = frames.filter((f) => !matchedFrameIds.has(f.id)).map((f) => ({ id: f.id, name: f.name }));
  const map = {
    figma: { fileKey: manifest.fileKey, version: manifest.version, name: manifest.name, url: FIGMA_URL },
    model: MODEL_ID,
    screens: pairs.map((p) => ({ screenshot: p.screenshot, screen: p.screen, sig: p.sig,
      figma_node: p.frame.id, figma_frame: p.frame.name, figma_image: join('design', p.frame.image.replace('frames/', '')), confidence: p.confidence, method: p.method,
      evidence: p.evidence || [] })),
    unmatchedScreens, unmatchedFrames,
  };
  writeFileSync(join(runDir, 'design-map.json'), JSON.stringify(map, null, 2));

  console.log(`\ndesign done: ${judged}/${screens.length} ${noun}s matched · ${diffN} diff(s) → ${DIFFS}`);
  if (unmatchedFrames.length) console.log(`designed but never reached: ${unmatchedFrames.map((f) => `"${f.name}"`).join(', ')}`);
  return DIFFS;
}
