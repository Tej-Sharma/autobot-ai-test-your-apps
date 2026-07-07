// mobile-mcp client + tool wrappers (carried from the validated spike).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// mobile-mcp is a real dependency spawned with the node that runs this engine
// (Electron's bundled node in the packaged app) — NOT via npx: a Dock-launched
// app has a bare PATH and end users may not have node/npx at all.
const MOBILE_MCP_BIN = fileURLToPath(new URL('../node_modules/@mobilenext/mobile-mcp/lib/index.js', import.meta.url));

export async function connectMobileMcp(device) {
  const mcp = new Client({ name: 'v2-engine', version: '0.0.0' });
  // env passed explicitly: the SDK strips the child env to a default allowlist,
  // which would drop ELECTRON_RUN_AS_NODE — and process.execPath would boot a
  // second Electron app instead of node.
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [MOBILE_MCP_BIN], env: { ...process.env } }));
  const { tools } = await mcp.listTools();
  const nameOf = (...kw) => tools.find((t) => kw.every((k) => t.name.toLowerCase().includes(k)))?.name;
  const T = {
    screenshot: nameOf('take', 'screenshot') ?? nameOf('screenshot'),
    saveShot: nameOf('save', 'screenshot'),
    launch: nameOf('launch'),
    tap: nameOf('click', 'coordinates') ?? nameOf('tap'),
    type: nameOf('type'),
    list: nameOf('list', 'elements'),
    size: nameOf('screen', 'size'),
    openUrl: nameOf('open', 'url'),
    swipe: nameOf('swipe'),
    terminate: nameOf('terminate'),
  };
  const raw = (name, args = {}) => mcp.callTool({ name, arguments: args });
  const call = (name, args = {}) => raw(name, { device, ...args });

  const screenshotImage = async () => {
    const res = await call(T.screenshot);
    const img = (res?.content || []).find((c) => c.type === 'image');
    if (!img) throw new Error('screenshot returned no image: ' + JSON.stringify(res?.content)?.slice(0, 200));
    return img; // { type:'image', data, mimeType }
  };

  // a11y tree -> [{label, x, y}] (center points). mobile-mcp prefixes JSON with text.
  const listElements = async () => {
    const res = await call(T.list).catch(() => null);
    const txt = (res?.content || []).find((c) => c.type === 'text')?.text;
    if (!txt) return [];
    const s = txt.indexOf('['), e = txt.lastIndexOf(']');
    if (s === -1 || e === -1) return [];
    let data; try { data = JSON.parse(txt.slice(s, e + 1)); } catch { return []; }
    const roots = Array.isArray(data) ? data : (data.elements || data.children || []);
    const out = [];
    const walk = (el) => {
      if (!el || typeof el !== 'object') return;
      const label = el.label ?? el.name ?? el.text ?? el.value ?? el.identifier ?? el.type;
      const r = el.rect ?? el.frame ?? el.coordinates ?? el;
      let x = null, y = null, w = 0, h = 0;
      if (r && r.width != null) { x = Math.round(r.x + r.width / 2); y = Math.round(r.y + r.height / 2); w = Math.round(r.width); h = Math.round(r.height); }
      else if (r && r.x1 != null) { x = Math.round((r.x1 + r.x2) / 2); y = Math.round((r.y1 + r.y2) / 2); w = Math.round(r.x2 - r.x1); h = Math.round(r.y2 - r.y1); }
      else if (el.x != null && el.y != null) { x = Math.round(el.x); y = Math.round(el.y); }
      if (label && x != null) out.push({ label: String(label).replace(/\s+/g, ' ').slice(0, 60), x, y, w, h, type: String(el.type ?? '') });
      (el.children || []).forEach(walk);
    };
    roots.forEach(walk);
    return out;
  };

  const screenSize = async () => JSON.stringify((await call(T.size).catch(() => null))?.content ?? 'unknown');

  // launch + poll up to launchWaitMs for first content (>=3 a11y elements), proceed early.
  const launchAndWait = async (bundle, launchWaitMs = 10000) => {
    const r = await call(T.launch, { packageName: bundle }).catch((e) => ({ error: e.message }));
    const start = Date.now();
    let ready = 0;
    while (Date.now() - start < launchWaitMs) {
      ready = (await listElements()).length;
      if (ready >= 3) break;
      await sleep(700);
    }
    return { launchResult: r?.content ?? r, ready, waited: Date.now() - start };
  };

  const tap = (x, y) => call(T.tap, { x, y });
  const typeText = (text) => call(T.type, { text });
  const swipe = (direction) => T.swipe ? call(T.swipe, { direction }).catch(() => null) : null;
  const terminate = (bundle) => T.terminate ? call(T.terminate, { packageName: bundle }).catch(() => null) : null;
  const saveScreenshot = (path) => T.saveShot ? call(T.saveShot, { saveTo: path, path, filePath: path }).catch(() => null) : null;

  return { mcp, tools, T, raw, call, screenshotImage, listElements, screenSize, launchAndWait, tap, typeText, swipe, terminate, saveScreenshot,
    close: () => mcp.close() };
}
