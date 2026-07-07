// ============================================================================
// core/evidence.mjs — Stage B of the design pass: deterministic, code-computed
// comparisons between the implementation's rendered values and the Figma spec.
// The output is EVIDENCE LINES fed into the judge call (core/design.mjs), not
// direct diffs: exact numbers make the judge precise, while the judge filters
// what deterministic code can't (intentional deviations, runtime data).
//
//   webEvidence(rows, frame, palette)      — rows from the driver's per-screen
//     computed-style sweep (styles/<shot>.json): match design text nodes to DOM
//     rows by unique text, then compare color/typography per pair, resolve each
//     text's button/container pair for fill+radius, and sweep every rendered
//     color against the design palette ("off-palette").
//   mobileEvidence(els, frame, shotPath)   — iOS a11y geometry (points ≡ Figma
//     1x px) + pixel sampling: missing design text, position drift on matched
//     text, sub-44pt touch targets, and sharp-sampled control colors vs design
//     fills (the a11y tree exposes no styling — pixels are the only source).
// ============================================================================
import sharp from 'sharp';

const CAP = { missing: 6, pairs: 20, palette: 5, samples: 4, position: 6 };

// ---- color math: CSS/hex → Lab, ΔE76 (adequate for flag-vs-ignore at our thresholds)
export function parseColor(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
    if (a < 0.5) return null; // mostly-transparent fills aren't a visible color
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    if (m[4] != null) { const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); if (a < 0.5) return null; }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}
const hexOf = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function rgbToLab([r, g, b]) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const [x, y, z] = [
    (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047,
    R * 0.2126 + G * 0.7152 + B * 0.0722,
    (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883,
  ];
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export function deltaE(c1, c2) {
  if (!c1 || !c2) return null;
  const [a, b] = [rgbToLab(c1), rgbToLab(c2)];
  return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
}

// ---- text matching: same normalization family as the mapping stage
const normText = (s) => String(s ?? '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const isStatic = (t) => t.length > 2 && !/^[#\s.,:/·-]+$/.test(t); // pure-numeric/punct text is runtime data

// Unique-text pairs: a design TEXT node and an implementation element whose
// normalized text matches, where that text occurs exactly once on each side —
// the near-perfect anchors everything else hangs off.
function uniqueTextPairs(frameTextEls, implItems, textOfImpl) {
  const count = (list, get) => {
    const m = new Map();
    for (const it of list) { const t = normText(get(it)); if (isStatic(t)) m.set(t, (m.get(t) || []).concat([it])); }
    return m;
  };
  const fm = count(frameTextEls, (e) => e.text);
  const im = count(implItems, textOfImpl);
  const pairs = [];
  for (const [t, fes] of fm) {
    const rows = im.get(t);
    if (fes.length === 1 && rows?.length === 1) pairs.push({ text: t, fe: fes[0], impl: rows[0] });
  }
  return { pairs, frameTexts: fm, implTexts: im };
}

const missingLines = (frameTexts, implTexts) => {
  const out = [];
  for (const [t, fes] of frameTexts) {
    if (!implTexts.has(t)) out.push(`design text ${JSON.stringify(fes[0].text)} not found in the implementation (missing element, or renamed copy)`);
    if (out.length >= CAP.missing) break;
  }
  return out;
};

// Smallest container: the tightest non-TEXT design element with a visible fill
// that encloses a point — the "button behind this label" resolver.
function containerOf(frameEls, cx, cy, maxArea) {
  let best = null;
  for (const e of frameEls) {
    if (e.type === 'TEXT' || !e.fill || !e.box) continue;
    const { x, y, w, h } = e.box;
    if (cx < x || cx > x + w || cy < y || cy > y + h) continue;
    const area = w * h;
    if (area > maxArea) continue;
    if (!best || area < best.box.w * best.box.h) best = e;
  }
  return best;
}

// ---- WEB: computed-CSS rows vs the design spec --------------------------------

export function webEvidence(rows, frame, palette = {}) {
  const lines = [];
  const frameTextEls = (frame.els || []).filter((e) => e.type === 'TEXT' && e.text);
  const textRows = rows.filter((r) => r.text);
  const { pairs, frameTexts, implTexts } = uniqueTextPairs(frameTextEls, textRows, (r) => r.text);

  lines.push(...missingLines(frameTexts, implTexts));

  const frameArea = (frame.width || 1) * (frame.height || 1);
  const seenContainers = new Set();
  for (const { fe, impl } of pairs.slice(0, CAP.pairs)) {
    const cs = impl.styles || {};
    const q = JSON.stringify(fe.text);
    // typography — both sides are exact values
    if (fe.fill && cs.color) {
      const dE = deltaE(parseColor(cs.color), parseColor(fe.fill));
      if (dE != null && dE > 8) lines.push(`text ${q}: color ${hexOf(parseColor(cs.color))} but design says ${fe.fill} (ΔE ${dE})`);
    }
    if (fe.font?.size && cs['font-size']) {
      const actual = parseFloat(cs['font-size']);
      if (Math.abs(actual - fe.font.size) > 1.5) lines.push(`text ${q}: font-size ${actual}px but design says ${fe.font.size}px`);
    }
    if (fe.font?.weight && cs['font-weight']) {
      const actual = parseInt(cs['font-weight'], 10);
      if (actual && Math.abs(actual - fe.font.weight) >= 100) lines.push(`text ${q}: font-weight ${actual} but design says ${fe.font.weight}`);
    }
    if (fe.font?.family && cs['font-family']) {
      const actual = cs['font-family'].split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      const want = fe.font.family.toLowerCase();
      if (actual && !actual.includes(want) && !want.includes(actual)) lines.push(`text ${q}: font-family "${actual}" but design says "${fe.font.family}"`);
    }
    if (fe.font?.lineHeight && cs['line-height'] && cs['line-height'] !== 'normal') {
      const actual = parseFloat(cs['line-height']);
      if (Math.abs(actual - fe.font.lineHeight) > 2) lines.push(`text ${q}: line-height ${actual}px but design says ${fe.font.lineHeight}px`);
    }
    // the button/container behind this text: design fill+radius vs rendered background+radius
    const fb = fe.box;
    const designBtn = fb && containerOf(frame.els, fb.x + fb.w / 2, fb.y + fb.h / 2, frameArea * 0.4);
    if (designBtn && !seenContainers.has(designBtn.id ?? designBtn.name)) {
      seenContainers.add(designBtn.id ?? designBtn.name);
      const ib = impl.bbox;
      let renderedBtn = null;
      for (const r of rows) {
        const bg = parseColor(r.styles?.['background-color']);
        if (!bg || !r.bbox) continue;
        const { x, y, w, h } = r.bbox;
        const cx = ib.x + ib.w / 2, cy = ib.y + ib.h / 2;
        if (cx < x || cx > x + w || cy < y || cy > y + h) continue;
        if (!renderedBtn || w * h < renderedBtn.bbox.w * renderedBtn.bbox.h) renderedBtn = r;
      }
      if (renderedBtn) {
        const dE = deltaE(parseColor(renderedBtn.styles['background-color']), parseColor(designBtn.fill));
        if (dE != null && dE > 8) lines.push(`container behind ${q}: background ${hexOf(parseColor(renderedBtn.styles['background-color']))} but design "${designBtn.name}" is ${designBtn.fill} (ΔE ${dE})`);
        if (designBtn.radius != null && renderedBtn.styles['border-radius']) {
          const actual = parseFloat(renderedBtn.styles['border-radius']) || 0;
          if (Math.abs(actual - designBtn.radius) > 1.5) lines.push(`container behind ${q}: border-radius ${actual}px but design says ${designBtn.radius}px`);
        }
      }
    }
  }

  // off-palette sweep — needs no element matching at all, so it works even when
  // texts diverge; only colors used repeatedly count (one-offs are usually images).
  const paletteRgb = (palette.colors || []).map(parseColor).filter(Boolean);
  if (paletteRgb.length >= 3) {
    const used = new Map();
    for (const r of rows) {
      for (const c of [r.text && r.styles?.color, r.styles?.['background-color']]) {
        const rgb = parseColor(c);
        if (rgb) { const k = hexOf(rgb); used.set(k, (used.get(k) || 0) + 1); }
      }
    }
    let n = 0;
    for (const [hx, cnt] of [...used.entries()].sort((a, b) => b[1] - a[1])) {
      if (cnt < 3 || n >= CAP.palette) break;
      const rgb = parseColor(hx);
      const nearest = paletteRgb.reduce((b, p) => { const d = deltaE(rgb, p); return d < b.d ? { d, p } : b; }, { d: Infinity });
      if (nearest.d > 10 && nearest.d < 60) { lines.push(`color ${hx} (used by ${cnt} elements) is not in the design palette — nearest design color ${hexOf(nearest.p)} (ΔE ${nearest.d})`); n++; }
    }
  }
  return lines;
}

// ---- iOS: a11y geometry + pixel sampling --------------------------------------

// a11y frames are in points; the screenshot is device pixels. The scale factor
// is recovered from the element envelope (mobile screens virtually always have
// a full-width element — tab bar, nav bar, background).
const envelope = (els) => ({
  w: Math.max(...els.map((e) => e.x + (e.w || 0) / 2), 1),
  h: Math.max(...els.map((e) => e.y + (e.h || 0) / 2), 1),
});

async function sampleColor(shotPath, rectPx) {
  const img = sharp(shotPath);
  const { width, height } = await img.metadata();
  const left = Math.max(0, Math.round(rectPx.x)), top = Math.max(0, Math.round(rectPx.y));
  const w = Math.min(width - left, Math.round(rectPx.w)), h = Math.min(height - top, Math.round(rectPx.h));
  if (w < 4 || h < 4) return null;
  const buf = await img.extract({ left, top, width: w, height: h }).resize(12, 12, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  // modal quantized color — robust to text glyphs on top of a solid control
  const buckets = new Map();
  for (let i = 0; i < buf.length; i += 3) {
    const k = `${buf[i] >> 5}.${buf[i + 1] >> 5}.${buf[i + 2] >> 5}`;
    const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += buf[i]; b.g += buf[i + 1]; b.b += buf[i + 2];
    buckets.set(k, b);
  }
  const top1 = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  return [top1.r / top1.n, top1.g / top1.n, top1.b / top1.n];
}

export async function mobileEvidence(els, frame, shotPath) {
  const lines = [];
  const boxed = (els || []).filter((e) => e.x != null && e.w > 0 && e.h > 0);
  if (!boxed.length || !frame.width) return lines;
  const frameTextEls = (frame.els || []).filter((e) => e.type === 'TEXT' && e.text);
  const { pairs, frameTexts, implTexts } = uniqueTextPairs(frameTextEls, boxed, (e) => e.label);

  lines.push(...missingLines(frameTexts, implTexts));

  // position drift on anchored text (relative coords absorb device-size mismatch)
  const env = envelope(boxed);
  let posN = 0;
  for (const { fe, impl } of pairs) {
    if (!fe.box || posN >= CAP.position) break;
    const dx = impl.x / env.w - (fe.box.x + fe.box.w / 2) / frame.width;
    const dy = impl.y / env.h - (fe.box.y + fe.box.h / 2) / frame.height;
    if (Math.abs(dx) > 0.045 || Math.abs(dy) > 0.045) {
      lines.push(`text ${JSON.stringify(fe.text)} sits ~${Math.round(Math.abs(dx) * frame.width)}pt horizontally / ~${Math.round(Math.abs(dy) * frame.height)}pt vertically away from its design position`);
      posN++;
    }
  }

  // touch targets — Apple HIG floor, needs no design data (a11y points are real points)
  for (const e of boxed.filter((e) => /button/i.test(e.type)).slice(0, 30)) {
    if (e.w < 44 || e.h < 44) { lines.push(`touch target "${e.label}" is ${Math.round(e.w)}×${Math.round(e.h)}pt — below the 44pt minimum`); }
  }

  // pixel-sampled control colors: the a11y tree has no styling, so crops are the
  // only runtime color source. Only solid design containers (buttons) qualify.
  let scale = Math.round((await sharp(shotPath).metadata()).width / env.w);
  scale = Math.min(4, Math.max(1, scale || 1));
  const frameArea = frame.width * frame.height;
  const sampled = new Set();
  let sN = 0;
  for (const { fe, impl } of pairs) {
    if (sN >= CAP.samples || !fe.box) break;
    const btn = containerOf(frame.els, fe.box.x + fe.box.w / 2, fe.box.y + fe.box.h / 2, frameArea * 0.3);
    if (!btn || sampled.has(btn.id ?? btn.name)) continue;
    sampled.add(btn.id ?? btn.name);
    const want = parseColor(btn.fill);
    if (!want) continue;
    const rect = { x: (impl.x - impl.w / 2) * scale, y: (impl.y - impl.h / 2) * scale, w: impl.w * scale, h: impl.h * scale };
    const got = await sampleColor(shotPath, rect).catch(() => null);
    if (!got) continue;
    sN++;
    const dE = deltaE(got, want);
    if (dE > 18) lines.push(`control behind ${JSON.stringify(fe.text)}: sampled color ~${hexOf(got)} but design "${btn.name}" is ${btn.fill} (ΔE ${dE}) [pixel-sampled — verify against the images]`);
  }
  return lines;
}
