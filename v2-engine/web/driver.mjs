// ============================================================================
// web/driver.mjs — the web "hands" for core/explore.mjs: Playwright MCP
// connection, ref-based clicks with fresh label fallback, navigate(url) as
// first-class backtracking, per-step console/network error signals, and crash
// recovery by returning to the start URL. All behavior (timings, signal
// wording, screenshot naming) is carried unchanged from the old engine's
// explore.mjs. No top-level side effects — the entrypoint constructs the driver.
// ============================================================================
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { connectPlaywrightMcp, sleep } from './mcp.mjs';
import { isModal, handleModal, findByLabel } from './interactions.mjs';
import { screenSignature, controlsOf, detectNav, upsertNode } from './stategraph.mjs';

export function createWebDriver({ TARGET, START_URL, NAV_WAIT, VIEWPORT, RUN }) {
  const pathnameOf = (url) => { try { const u = new URL(url); return u.pathname + (u.search || ''); } catch { return url || '/'; } };
  const elemText = (els) => els.length ? els.map((e, i) => `[${i}] "${e.label}" (${e.role})`).join('\n') : '(no elements found)';

  let mcpc;
  async function execute(a, els) {
    if (a.kind === 'stop') return;
    if (a.kind === 'back') { await mcpc.call(mcpc.T.navigateBack, {}).catch(() => null); await sleep(700); return; }
    if (a.kind === 'navigate') { await mcpc.navigateAndWait(a.url || START_URL, NAV_WAIT); return; }
    // click / type — refs from THIS turn's snapshot are current; resolve by index first,
    // falling back to a fresh label lookup (refs go stale across snapshots, labels don't).
    let el = (a.elementIndex != null) ? els[a.elementIndex] : null;
    if (!el && a.label) el = await findByLabel(mcpc, a.label);
    if (!el) { await sleep(700); return; }
    if (a.kind === 'type') await mcpc.typeText(el.ref, el.label, a.text || '');
    else await mcpc.click(el.ref, el.label);
    await sleep(700);
  }

  return {
    async start() {
      mcpc = await connectPlaywrightMcp(join(RUN, 'screenshots'));
      mkdirSync(join(RUN, 'styles'), { recursive: true });
      await mcpc.navigateAndWait(START_URL, NAV_WAIT);
    },
    headerDesc: () => `${TARGET} (${START_URL})`,
    promptSize: () => VIEWPORT,

    async observe(step) {
      let els = await mcpc.listElements();
      if (isModal(els)) { const p = await handleModal(mcpc, els); console.log(`   • modal dismissed via '${p}'`); els = await mcpc.listElements(); }
      const url = mcpc.currentUrl();
      const sig = screenSignature(pathnameOf(url), els);
      const img = await mcpc.screenshotImage(`step-${step}`);
      // computed-style snapshot paired 1:1 with the screenshot — the design
      // pass's "rendered truth" (styles/<shot>.json). Best-effort: a failed
      // sweep costs the design pass its measured evidence, nothing else.
      try {
        const rows = await mcpc.styleSweep();
        if (rows) writeFileSync(join(RUN, 'styles', img.file.replace('screenshots/', '').replace(/\.png$/, '.json')), JSON.stringify(rows));
      } catch { /* evidence-only artifact */ }
      const cErr = await mcpc.consoleErrors();
      const cFail = await mcpc.failedRequests();

      const signalLines = [
        `CURRENT PAGE — URL: ${url}`,
        cErr ? `NEW console errors since last action: ${cErr}` : null,
        cFail.length ? `NEW failed network requests: ${cFail.join(' | ')}` : null,
        `ELEMENTS (index in brackets, with ARIA role):\n${elemText(els)}`,
      ].filter(Boolean).join('\n');

      return {
        img,
        els,
        sig,
        chromeLabels: detectNav(els),
        userText: signalLines,
        journalHead: { url_after: url },
        journalSignals: { console_errors: cErr, failed_requests: cFail },
        recExtras: { url },
        upsertExtra: url,
      };
    },

    persistShot: (obs) => obs.img.file, // already saved at snapshot time, step-numbered
    execute,
    recover: () => mcpc.navigateAndWait(START_URL, NAV_WAIT),
    crashMessage: '   ⚠ crash/off-site detected — returning to start URL',
    actionStr: (a) => `${a.kind}${a.label ? ` '${a.label}'` : ''}${a.text ? ` "${a.text}"` : ''}${a.url ? ` ${a.url}` : ''}`,
    markableKinds: ['click', 'type'],
    graph: { upsertNode, controlsOf },
    voc: {
      memHeader: (t) => `--- step: ${t.step}  |  time: ${t.time}  |  page: ${t.screen}  |  url: ${t.url}`,
      mapped: 'Pages',
      noun: 'page',
      chromeNever: 'Nav links never opened:',
      elsewhereHeader: `Untried controls on OTHER pages (paths you didn't trace — you can navigate straight to their URLs):`,
      noElsewhere: 'No other pages with untried controls.',
      nodeLine: (n, u) => `• ${n.name}${n.url ? ` (${n.url})` : ''}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? ` (+${u.length - 8} more)` : ''}`,
      lastLabel: 'page (last)',
      plural: 'pages',
    },
    close: () => mcpc.close(),
  };
}
