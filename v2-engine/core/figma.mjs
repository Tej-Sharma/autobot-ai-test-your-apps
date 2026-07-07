// ============================================================================
// core/figma.mjs — Figma REST client + design-manifest builder for the design
// pass (core/design.mjs). Turns a Figma file URL into a cached, normalized
// manifest: one entry per top-level frame ("screen" in the design) with a
// rendered PNG, a flattened element list (box + style props), and the frame's
// visible text — everything the mapping and judge stages need, with zero
// further API calls on a cache hit.
//
// Cache is keyed on (fileKey, file version): re-runs against an unchanged file
// cost exactly ONE Tier-1 call (the version probe). That matters because Figma
// rate limits are keyed to the plan of the FILE being accessed — files on
// Starter-plan teams get almost no API budget, so we never refetch what we
// already have. Rendered-image URLs expire (~30 days), so PNGs are downloaded
// into the cache immediately, never stored as URLs.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.figma.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const san = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '-');

// figma.com/design/<key>/<name>?node-id=12-345 (also /file/, /proto/, /board/).
// The optional node-id scopes the manifest to that page/section/frame subtree.
export function parseFigmaUrl(url) {
  const m = String(url).match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error(`not a Figma file link: ${url}`);
  const nid = (String(url).match(/[?&]node-id=([0-9A-Za-z%:-]+)/) || [])[1];
  return { fileKey: m[1], nodeId: nid ? decodeURIComponent(nid).replace(/-/g, ':') : null };
}

async function api(path, token) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
    if (res.ok) return res.json();
    if (res.status === 429) {
      // Plan-of-file limiting: a "low" bucket means a free/Starter-plan file — its
      // monthly automation budget is ~6 calls; waiting won't help within this run.
      if (res.headers.get('x-figma-rate-limit-type') === 'low' && attempt >= 1) {
        throw new Error('Figma rate limit on a free-plan file — files on Starter-plan teams allow almost no API access. Move the file to a paid-plan team, or retry much later.');
      }
      const wait = Math.min(Number(res.headers.get('retry-after') || 15), 60) * 1000;
      console.log(`   figma: 429 rate-limited — waiting ${wait / 1000}s`);
      await sleep(wait); continue;
    }
    if (res.status === 403) throw new Error('Figma rejected the token (403) — check the personal access token in Settings has file-content read access');
    if (res.status === 404) throw new Error('Figma file not found (404) — check the link, and that the token owner can open the file');
    if (res.status >= 500 && attempt < 4) { await sleep(2000 * (attempt + 1)); continue; }
    throw new Error(`Figma API ${res.status} on ${path}`);
  }
  throw new Error(`Figma API kept rate-limiting on ${path}`);
}

// ---- node-tree helpers -----------------------------------------------------

const hex = (c, opacity = 1) => {
  const b = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  const base = `#${b(c.r)}${b(c.g)}${b(c.b)}`;
  const a = (c.a ?? 1) * opacity;
  return a < 0.995 ? `${base}${b(a)}` : base;
};
const r1 = (n) => Math.round(n * 10) / 10;

// Flatten one frame's subtree into { els, texts }: els carry frame-relative
// boxes + the style props Figma exposes (the runtime side never has these);
// texts feed the text-overlap mapping score. Invisible subtrees are dropped.
function normalizeFrame(doc, maxEls = 400) {
  const origin = doc.absoluteBoundingBox || { x: 0, y: 0 };
  const els = []; const texts = [];
  const walk = (n, depth) => {
    if (!n || n.visible === false) return;
    const bb = n.absoluteBoundingBox;
    if (bb && n.id !== doc.id && els.length < maxEls) {
      const el = { id: n.id, name: String(n.name || '').slice(0, 60), type: n.type,
        box: { x: r1(bb.x - origin.x), y: r1(bb.y - origin.y), w: r1(bb.width), h: r1(bb.height) } };
      const fill = (n.fills || []).find((f) => f.type === 'SOLID' && f.visible !== false);
      if (fill?.color) el.fill = hex(fill.color, fill.opacity ?? 1);
      const rad = n.cornerRadius ?? (Array.isArray(n.rectangleCornerRadii) ? n.rectangleCornerRadii[0] : null);
      if (rad) el.radius = rad;
      if (n.type === 'TEXT') {
        el.text = String(n.characters || '').slice(0, 200);
        const s = n.style || {};
        el.font = { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight,
          ...(s.lineHeightPx ? { lineHeight: r1(s.lineHeightPx) } : {}) };
        if (n.characters) texts.push({ str: n.characters, size: s.fontSize || 14 });
      }
      if (n.layoutMode && n.layoutMode !== 'NONE') {
        el.autoLayout = { mode: n.layoutMode, gap: n.itemSpacing ?? 0,
          pad: [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0] };
      }
      if (n.componentId) el.componentId = n.componentId;
      els.push(el);
    }
    for (const c of n.children || []) walk(c, depth + 1);
  };
  walk(doc, 0);
  return { els, texts };
}

// Frames directly under a node (page/section/frame), descending one SECTION level.
const frameChildren = (node) => {
  const out = [];
  for (const c of node.children || []) {
    if (c.visible === false) continue;
    if (c.type === 'FRAME' || c.type === 'COMPONENT') out.push(c);
    else if (c.type === 'SECTION') for (const g of c.children || []) if ((g.type === 'FRAME' || g.type === 'COMPONENT') && g.visible !== false) out.push(g);
  }
  return out;
};

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---- the manifest ----------------------------------------------------------
// { fileKey, version, name, url, frames: [{ id, name, width, height,
//   image: 'frames/<san>.png' (cache-relative), els, texts }], palette }

export async function getManifest({ url, token, cacheDir }) {
  const { fileKey, nodeId } = parseFigmaUrl(url);

  // 1 cheap call for the version; everything else is skipped on a cache hit.
  const meta = await api(`/v1/files/${fileKey}?depth=1`, token);
  const dir = join(cacheDir, fileKey, san(String(meta.version)));
  const manifestPath = join(dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const cached = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`figma: manifest cache hit — "${cached.name}" v${cached.version}, ${cached.frames.length} frames (no API calls)`);
    return { ...cached, dir };
  }
  mkdirSync(join(dir, 'frames'), { recursive: true });

  // Enumerate the design's screens: top-level frames of every page (or of the
  // linked node when the URL carries a node-id scope).
  let shells = [];
  if (nodeId) {
    const res = await api(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=2`, token);
    const doc = Object.values(res.nodes || {})[0]?.document;
    if (!doc) throw new Error(`Figma node ${nodeId} not found in file`);
    shells = (doc.type === 'FRAME' || doc.type === 'COMPONENT') ? [doc] : frameChildren(doc);
  } else {
    const res = await api(`/v1/files/${fileKey}?depth=3`, token);
    for (const page of res.document?.children || []) shells.push(...frameChildren(page));
  }
  if (!shells.length) throw new Error('no frames found in the Figma file/selection — is the design drawn in top-level frames?');
  shells = shells.slice(0, 60); // sanity cap: nobody's app has more screens than this
  console.log(`figma: "${meta.name}" v${meta.version} — ${shells.length} frames to fetch`);

  // Full subtrees, in small batches (big batches hit "Request too large").
  const frames = [];
  for (const batch of chunk(shells.map((s) => s.id), 5)) {
    const res = await api(`/v1/files/${fileKey}/nodes?ids=${batch.map(encodeURIComponent).join(',')}`, token);
    for (const id of batch) {
      const doc = res.nodes?.[id]?.document;
      if (!doc) continue;
      const bb = doc.absoluteBoundingBox || {};
      const { els, texts } = normalizeFrame(doc);
      frames.push({ id, name: doc.name, width: r1(bb.width || 0), height: r1(bb.height || 0),
        image: `frames/${san(id)}.png`, els, texts });
    }
  }

  // Render + download every frame PNG now (URLs expire; cache must be self-contained).
  for (const batch of chunk(frames, 10)) {
    const ids = batch.map((f) => f.id);
    const res = await api(`/v1/images/${fileKey}?ids=${ids.map(encodeURIComponent).join(',')}&format=png&scale=2`, token);
    for (const f of batch) {
      const imgUrl = res.images?.[f.id];
      if (!imgUrl) { console.log(`   figma: render failed for frame "${f.name}" — skipping its image`); f.image = null; continue; }
      const img = await fetch(imgUrl);
      if (!img.ok) { f.image = null; continue; }
      writeFileSync(join(dir, f.image), Buffer.from(await img.arrayBuffer()));
    }
  }

  // Pseudo-palette (the design system as actually used) — the Phase-2 token
  // sweep's ruleset; cheap to derive now, stored so it never needs recomputing.
  const count = (map, k) => k != null && map.set(k, (map.get(k) || 0) + 1);
  const colors = new Map(), fontSizes = new Map(), radii = new Map();
  for (const f of frames) for (const e of f.els) { count(colors, e.fill); count(fontSizes, e.font?.size); count(radii, e.radius); }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const palette = { colors: top(colors, 24), fontSizes: top(fontSizes, 12), radii: top(radii, 8) };

  const manifest = { fileKey, version: String(meta.version), name: meta.name, url, fetchedAt: new Date().toISOString(), frames, palette };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`figma: manifest built — ${frames.length} frames, ${frames.filter((f) => f.image).length} images → ${dir}`);
  return { ...manifest, dir };
}
