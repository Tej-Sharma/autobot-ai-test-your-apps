// Playwright MCP client + tool wrappers (web sibling of v2-mobile-tester's mcp.mjs).
// Ref-based interaction (browser_snapshot -> [ref]) instead of coordinate taps —
// browser_click/browser_type act on {element, ref}, not x/y.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// @playwright/mcp is a real dependency spawned with the node that runs this engine
// (Electron's bundled node in the packaged app) — NOT via npx: a Dock-launched app
// has a bare PATH and end users may not have node/npx at all.
const PLAYWRIGHT_MCP_BIN = fileURLToPath(new URL('../node_modules/@playwright/mcp/cli.js', import.meta.url));

export async function connectPlaywrightMcp(screenshotsDir) {
  const mcp = new Client({ name: 'v2-web-engine', version: '0.0.0' });
  await mcp.connect(new StdioClientTransport({
    command: process.execPath,
    args: [PLAYWRIGHT_MCP_BIN, '--isolated', '--output-dir', screenshotsDir],
    // Explicit env: the SDK's default allowlist would drop ELECTRON_RUN_AS_NODE,
    // making process.execPath boot a second Electron app instead of node.
    env: { ...process.env },
  }));
  const { tools } = await mcp.listTools();
  // like mobile mcp.mjs: resolve tool names dynamically so this self-adapts across
  // @playwright/mcp versions. `excl` disambiguates near-duplicate names (navigate vs navigate_back).
  const nameOf = (kw, excl = []) => tools.find((t) => {
    const n = t.name.toLowerCase();
    return kw.every((k) => n.includes(k)) && !excl.some((e) => n.includes(e));
  })?.name;
  const T = {
    snapshot: nameOf(['snapshot']),
    navigate: nameOf(['navigate'], ['back']),
    navigateBack: nameOf(['navigate', 'back']),
    click: nameOf(['click']),
    type: nameOf(['type']),
    pressKey: nameOf(['press']),
    screenshot: nameOf(['screenshot']),
    consoleMessages: nameOf(['console']),
    networkRequests: nameOf(['network', 'requests']), // not 'network_request' singular
    fileUpload: nameOf(['file', 'upload']),
    evaluate: nameOf(['evaluate']),
    close: nameOf(['close']),
  };
  const raw = (name, args = {}) => mcp.callTool({ name, arguments: args });
  const textOf = (res) => (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

  // Any control that triggers a native OS dialog (a file-picker button is the
  // common case) blocks EVERY subsequent tool call with a "does not handle the
  // modal state" error until that dialog is dismissed — verified live: clicking
  // an "Attach file" button during exploration crashed the whole run on the very
  // next tool call. browser_file_upload with no `paths` cancels a file chooser;
  // recover centrally here (every call goes through this) and retry once.
  const call = async (name, args = {}) => {
    let res = await raw(name, args);
    const text = textOf(res);
    if (T.fileUpload && /does not handle the modal state/i.test(text) && /file chooser/i.test(text)) {
      await raw(T.fileUpload, {}).catch(() => null);
      res = await raw(name, args);
    }
    return res;
  };

  let lastUrl = '';
  const rememberUrl = (text) => { const m = text.match(/Page URL:\s*(\S+)/i); if (m) lastUrl = m[1]; };

  // browser_snapshot's aria tree: lines like `- role "name" [level=1] [ref=e7]`,
  // indented per nesting depth. Attributes ([level=1], [cursor=pointer], [checked]…)
  // can appear BEFORE ref, so ref is matched anywhere on the line rather than
  // requiring it to immediately follow the name — an earlier "no non-bracket chars
  // before [ref=" version silently dropped any line with a mid-line attribute.
  // Scanned across the whole text (not just inside a fenced block) so this survives
  // wrapper-format drift. We also track the nearest landmark ancestor
  // (navigation/banner/contentinfo/main) via an indent-based stack, so
  // stategraph.mjs's nav-link detection can be landmark-accurate instead of a guess.
  const LANDMARK = /^(navigation|banner|contentinfo|main|complementary)$/;
  const parseSnapshot = (text) => {
    const out = [];
    const roleRe = /^(\s*)-\s+([a-zA-Z][a-zA-Z0-9]*)\b/;
    const nameRe = /^\s*-\s+[a-zA-Z][a-zA-Z0-9]*\s+"([^"]*)"/;
    const refRe = /\[ref=([a-zA-Z0-9_-]+)\]/;
    const stack = []; // [{indent, role}], nearest landmark ancestor
    for (const line of text.split('\n')) {
      const rm = line.match(roleRe);
      if (!rm) continue;
      const [, indent, role] = rm;
      const depth = indent.length;
      while (stack.length && stack[stack.length - 1].indent >= depth) stack.pop();
      const landmark = [...stack].reverse().find((s) => LANDMARK.test(s.role))?.role || null;
      stack.push({ indent: depth, role: role.toLowerCase() });
      const refM = line.match(refRe);
      if (!refM) continue; // nested detail lines (e.g. `- /url: https://...`) carry no ref
      const nameM = line.match(nameRe);
      if (!nameM) continue; // unlabeled structural nodes aren't actionable
      out.push({ label: String(nameM[1]).replace(/\s+/g, ' ').trim().slice(0, 80), ref: refM[1], role: role.toLowerCase(), landmark });
    }
    return out;
  };

  const listElements = async () => {
    const res = await call(T.snapshot).catch(() => null);
    const text = textOf(res);
    if (!text) return [];
    rememberUrl(text);
    return parseSnapshot(text);
  };

  const currentUrl = () => lastUrl;

  const navigateAndWait = async (url, waitMs = 10000) => {
    lastUrl = url;
    const res = await call(T.navigate, { url }).catch((e) => ({ error: e.message }));
    rememberUrl(textOf(res));
    const start = Date.now();
    let ready = 0;
    while (Date.now() - start < waitMs) {
      ready = (await listElements()).length;
      if (ready >= 3) break;
      await sleep(500);
    }
    return { ready, waited: Date.now() - start };
  };

  // NB: the tool's param is `target` (not `ref`) for the exact element reference —
  // verified against the live inputSchema, don't trust the "ref" name from docs/memory.
  const click = async (ref, label) => {
    const res = await call(T.click, { element: label || ref, target: ref });
    rememberUrl(textOf(res));
    return res;
  };
  const typeText = async (ref, label, text) => {
    const res = await call(T.type, { element: label || ref, target: ref, text });
    rememberUrl(textOf(res));
    return res;
  };

  // Takes the screenshot to disk (--output-dir means browser_take_screenshot saves
  // straight into the run's screenshots/ folder — no manual base64-decode-and-write
  // step needed for the journal/report path) AND reads it back as base64 for the
  // vision-model calls in drive.mjs, which need inline image bytes either way.
  // NOTE: passing `filename` to browser_take_screenshot silently fails to write
  // the file (and drops the inline image data too) on the currently installed
  // @playwright/mcp — verified live. Omitting `filename` reliably returns inline
  // base64 image data, so we decode + write it ourselves under our own
  // deterministic numbered name (same pattern mobile's checkpoint() uses).
  let shotN = 0;
  const screenshotImage = async (name) => {
    const file = `${String(++shotN).padStart(2, '0')}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}.png`;
    const res = await call(T.screenshot, {});
    const img = (res?.content || []).find((c) => c.type === 'image');
    if (!img) throw new Error('screenshot returned no image data: ' + JSON.stringify(res?.content)?.slice(0, 200));
    writeFileSync(join(screenshotsDir, file), Buffer.from(img.data, 'base64'));
    return { file: `screenshots/${file}`, data: img.data, mimeType: img.mimeType || 'image/png' };
  };

  // browser_console_messages (with level:'error') returns a header line
  // "Total messages: N (Errors: X, Warnings: Y)" — X is cumulative since the last
  // navigation, not a delta, so we track the running total ourselves and report
  // the difference (self-correcting if a navigation reset it lower).
  let lastErrorTotal = 0;
  const consoleErrors = async () => {
    if (!T.consoleMessages) return 0;
    const text = textOf(await call(T.consoleMessages, { level: 'error' }).catch(() => null));
    const m = text.match(/Errors:\s*(\d+)/i);
    const total = m ? Number(m[1]) : 0;
    const delta = total >= lastErrorTotal ? total - lastErrorTotal : total;
    lastErrorTotal = total;
    return delta;
  };
  // browser_network_requests has no delta/total-count header — it's a growing,
  // numbered list (`N. [METHOD] url => [STATUS]`). Only count actual numbered
  // request lines (skip the "### Result" header and the trailing "N static
  // requests not shown" note) so those don't get miscounted as new entries.
  let networkSeen = 0;
  const failedRequests = async () => {
    if (!T.networkRequests) return [];
    const text = textOf(await call(T.networkRequests).catch(() => null));
    const lines = text.split('\n').filter((l) => /^\d+\.\s*\[/.test(l));
    const fresh = lines.slice(networkSeen); networkSeen = lines.length;
    return fresh.filter((l) => /=>\s*\[(4\d\d|5\d\d|FAILED)\]/i.test(l)).slice(0, 10).map((l) => l.trim().slice(0, 160));
  };

  const close = async () => { if (T.close) await call(T.close).catch(() => null); await mcp.close(); };

  // One in-page sweep of every visible element's geometry + computed styles —
  // the "rendered truth" the design pass diffs against the Figma spec. Runs via
  // browser_evaluate (absent on very old @playwright/mcp → returns null and the
  // design pass simply works without measured evidence). Document coordinates
  // (rect + scroll) so rows line up with the full-page screenshot space.
  const SWEEP_FN = `() => {
    const want = ['color','background-color','font-family','font-size','font-weight','line-height','letter-spacing','text-transform','border-radius','padding-top','padding-right','padding-bottom','padding-left','gap','display','border-top-width','border-top-color','box-shadow','opacity'];
    const rows = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (rows.length >= 500) return;
        if (/^(script|style|link|meta|noscript)$/i.test(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        let text = '';
        for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
        text = text.replace(/\\s+/g, ' ').trim().slice(0, 120);
        const styles = {};
        for (const p of want) styles[p] = cs.getPropertyValue(p);
        rows.push({ tag: el.tagName.toLowerCase(), text,
          bbox: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
          styles });
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document.body ? document.body : document);
    return rows;
  }`;
  const styleSweep = async () => {
    if (!T.evaluate) return null;
    const res = await call(T.evaluate, { function: SWEEP_FN }).catch(() => null);
    let text = textOf(res);
    if (!text) return null;
    // the JSON lives in the "### Result" section; a page snapshot may follow it
    const at = text.indexOf('### Result');
    if (at !== -1) { text = text.slice(at); const next = text.indexOf('###', 12); if (next !== -1) text = text.slice(0, next); }
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    if (s === -1 || e <= s) return null;
    try { const rows = JSON.parse(text.slice(s, e + 1)); return Array.isArray(rows) && rows.length ? rows : null; } catch { return null; }
  };

  return { mcp, tools, T, raw, call, listElements, currentUrl, navigateAndWait, click, typeText,
    screenshotImage, consoleErrors, failedRequests, styleSweep, close };
}
