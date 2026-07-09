// ============================================================================
// core/bbox.mjs — grounds an LLM-reported bbox to a real UI element's true
// position, normalized to 0-1 image fractions. VLMs are unreliable at
// estimating pixel coordinates freehand (they'll report device points, page
// pixels, or fractions, inconsistently) — but they're reliable at picking an
// index out of a list they were just shown (nextAction's elementIndex already
// works this way for tap targeting). Two grounding sources:
//   - mobile: the a11y elements saved per screenshot (elements.jsonl, with
//     their coordinate space) — normalizedElBoxes
//   - web: the per-screenshot computed-style sweep (styles/<shot>.json, page
//     pixels aligned 1:1 with the screenshot) — normalizedStyleBoxes
// Shared by explore.mjs (drive-time flaws), critique.mjs, and annotate.mjs.
// ============================================================================
const MIN_EL_PT = 20; // coord-space units; some a11y els report a bare center point (w/h 0)

export function normalizedElBoxes(space, els) {
  if (!space?.w || !space?.h) return null;
  const { w: SW, h: SH } = space;
  const boxes = (els || []).map((e) => {
    if (e.x == null || e.y == null) return null;
    const w = Math.max(e.w || 0, MIN_EL_PT), h = Math.max(e.h || 0, MIN_EL_PT);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return {
      label: e.label, type: e.type,
      x0: clamp((e.x - w / 2) / SW), y0: clamp((e.y - h / 2) / SH),
      x1: clamp((e.x + w / 2) / SW), y1: clamp((e.y + h / 2) / SH),
    };
  });
  return boxes.some(Boolean) ? boxes : null;
}

// Web grounding: style-sweep rows (tag/text/bbox in page px). Keep only rows a
// flaw could plausibly be "about" — anything with visible text, plus textless
// interactive/visual elements — and normalize by the screenshot's own pixel
// size (the sweep's document coords line up 1:1 with the saved screenshot).
const VISUAL_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'img', 'svg', 'video']);
export function normalizedStyleBoxes(rows, dims) {
  if (!dims?.w || !dims?.h || !Array.isArray(rows)) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const out = []; const seen = new Set();
  for (const r of rows) {
    const b = r.bbox; if (!b) continue;
    const label = (r.text || '').trim().slice(0, 80) || (VISUAL_TAGS.has(r.tag) ? `<${r.tag}>` : '');
    if (!label) continue;
    const key = `${label}@${b.x},${b.y},${b.w},${b.h}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ label, type: r.tag,
      x0: clamp(b.x / dims.w), y0: clamp(b.y / dims.h),
      x1: clamp((b.x + b.w) / dims.w), y1: clamp((b.y + b.h) / dims.h) });
    if (out.length >= 120) break; // keep the prompt bounded on element-dense pages
  }
  return out.length ? out : null;
}

// A freehand bbox is only trustworthy once it's actually in 0-1 fraction space.
// Models routinely emit pixel/point coordinates instead (e.g. x0:724 on a
// 1200px-wide page) — with the drawing surface's dimensions we can salvage
// those by dividing; without dims they're dropped. Fractions that merely
// overshoot (1.128) are clamped. A box that collapses to ~nothing is dropped —
// a wrong-looking sliver is worse than falling back to the plain screenshot.
export function sanitizeBbox(b, dims) {
  if (!b) return null;
  const nums = [b.x0, b.y0, b.x1, b.y1];
  if (nums.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return null;
  let out = b;
  if (nums.some((v) => v > 3)) { // pixel coordinates, not fractions
    if (!dims?.w || !dims?.h) return null;
    out = { x0: b.x0 / dims.w, y0: b.y0 / dims.h, x1: b.x1 / dims.w, y1: b.y1 / dims.h };
  }
  const clamp = (v) => Math.min(1, Math.max(0, v));
  out = { x0: clamp(out.x0), y0: clamp(out.y0), x1: clamp(out.x1), y1: clamp(out.y1) };
  return (out.x1 - out.x0 > 0.004 && out.y1 - out.y0 > 0.003) ? out : null;
}

// PNG pixel dimensions straight from the IHDR header — critique already holds
// the file buffer, no image library needed.
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
