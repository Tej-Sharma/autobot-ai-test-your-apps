// ============================================================================
// report.mjs — builds report.html from journal.jsonl + flaws.jsonl +
// critique.jsonl + screenshots. Web sibling of v2-mobile-tester's report.mjs:
// renders the url trail + console/network signal per screen (dropped silently
// by the mobile version, since it doesn't know those fields), and the title is
// parametrized instead of hardcoded.
// Run: npm run report [-- <runDir>]   (defaults to the latest run)
// ============================================================================
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const SEV = { high: '#d33', medium: '#e6a000', low: '#888' };

function latestRun(target) {
  const runs = join(HERE, 'runs');
  if (!existsSync(runs)) return null;
  const dirs = readdirSync(runs).filter((d) => !target || d.startsWith(target)).sort();
  return dirs.length ? join(runs, dirs[dirs.length - 1]) : null;
}

function siteTitle(runDir) {
  const target = basename(runDir).split('__')[0];
  const inputsPath = join(HERE, 'inputs', `${target}.json`);
  if (existsSync(inputsPath)) {
    try {
      const inputs = JSON.parse(readFileSync(inputsPath, 'utf8'));
      const about = String(inputs.about || '').split(/[—-]/)[0].trim();
      if (about) return about;
    } catch {}
  }
  return target;
}

export function buildReport(runDir) {
  const journal = readJsonl(join(runDir, 'journal.jsonl'));
  const driveFlaws = readJsonl(join(runDir, 'flaws.jsonl'));
  const critique = readJsonl(join(runDir, 'critique.jsonl'));

  // group everything by screenshot
  const byShot = {}; const order = [];
  for (const e of journal) if (e.screenshot && !byShot[e.screenshot]) {
    byShot[e.screenshot] = { screen: e.screen, urlBefore: e.url_before, urlAfter: e.url_after,
      consoleErrors: e.console_errors || 0, failedRequests: e.failed_requests || [], drive: [], critique: [], verdict: '' };
    order.push(e.screenshot);
  }
  for (const f of driveFlaws) { const s = f.screenshots?.[0]; if (s && byShot[s]) byShot[s].drive.push(f); }
  for (const c of critique) { if (byShot[c.screenshot]) { byShot[c.screenshot].critique = c.flaws; byShot[c.screenshot].verdict = c.verdict; } }

  const allFlaws = [...driveFlaws.map((f) => ({ ...f, src: 'drive' })), ...critique.flatMap((c) => c.flaws.map((f) => ({ ...f, screen: c.screen, src: 'critique' })))];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of allFlaws) counts[f.severity] = (counts[f.severity] || 0) + 1;

  const title = siteTitle(runDir);

  // ---- template sections (edit below) ----
  const head = `<!doctype html><meta charset=utf8><title>${esc(title)} — web-tester report</title>
<style>
 body{font:15px -apple-system,system-ui,sans-serif;margin:0;background:#fafafa;color:#222}
 header{padding:24px 32px;background:#111;color:#fff}
 h1{margin:0;font-size:20px} .sub{color:#aaa;font-size:13px;margin-top:4px}
 .pills{margin-top:12px} .pill{display:inline-block;padding:3px 10px;border-radius:12px;color:#fff;font-size:12px;margin-right:6px}
 main{padding:24px 32px;max-width:1100px;margin:auto}
 .screen{display:flex;gap:24px;background:#fff;border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:20px}
 .screen img{width:280px;border:1px solid #eee;border-radius:8px}
 .flaw{padding:8px 0;border-bottom:1px solid #f2f2f2} .flaw:last-child{border:0}
 .sev{font-weight:600;font-size:11px;text-transform:uppercase;margin-right:6px}
 .tag{font-size:11px;color:#999} .verdict{font-style:italic;color:#555;margin:6px 0 12px}
 .screen h3{margin:0 0 4px}
 .url{font-family:ui-monospace,monospace;font-size:12px;color:#666;margin-bottom:8px}
 .signal{font-size:12px;margin:4px 0} .signal.warn{color:#c33}
</style>`;

  const header = `<header>
 <h1>${esc(title)} — web-tester visual-QA report</h1>
 <div class=sub>${esc(basename(runDir))} · ${order.length} screens · ${allFlaws.length} flaws</div>
 <div class=pills>
  <span class=pill style="background:${SEV.high}">${counts.high || 0} high</span>
  <span class=pill style="background:${SEV.medium}">${counts.medium || 0} medium</span>
  <span class=pill style="background:${SEV.low}">${counts.low || 0} low</span>
 </div></header>`;

  // Every flaw links its annotated screenshot (bbox drawn) when annotate.mjs produced one.
  const annotatedLink = (id) => (id && existsSync(join(runDir, 'screenshots', 'annotated', `${id}.png`)))
    ? ` <a href="screenshots/annotated/${esc(id)}.png" class=tag>annotated ↗</a>` : '';
  const flawHtml = (f) => `<div class=flaw>
   <span class=sev style="color:${SEV[f.severity]}">${esc(f.severity)}</span>
   <b>${esc(f.summary)}</b> <span class=tag>${esc(f.type)} · ${esc(f.src || '')}</span>${annotatedLink(f.id)}
   <div style="color:#555;font-size:13px">${esc(f.detail)}</div></div>`;

  const screens = order.map((shot) => {
    const s = byShot[shot];
    const flaws = [...s.drive.map((f) => ({ ...f, src: 'drive' })), ...s.critique.map((f) => ({ ...f, src: 'critique' }))]
      .sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity));
    const urlLine = s.urlBefore !== s.urlAfter ? `${esc(s.urlBefore || '(start)')} → ${esc(s.urlAfter)}` : esc(s.urlAfter || '');
    const signals = [
      s.consoleErrors ? `<div class="signal warn">⚠ ${s.consoleErrors} new console error(s)</div>` : '',
      s.failedRequests.length ? `<div class="signal warn">⚠ failed request: ${s.failedRequests.map(esc).join(' | ')}</div>` : '',
    ].join('');
    return `<div class=screen>
     <img src="${esc(shot)}" alt="${esc(s.screen)}">
     <div style="flex:1">
       <h3>${esc(s.screen)}</h3>
       <div class=url>${urlLine}</div>
       ${signals}
       ${s.verdict ? `<div class=verdict>“${esc(s.verdict)}”</div>` : ''}
       ${flaws.map(flawHtml).join('') || '<div class=tag>no flaws flagged</div>'}
     </div></div>`;
  }).join('');

  // ---- design fidelity section (only when the design pass ran: Figma link configured) ----
  const designDiffs = readJsonl(join(runDir, 'design-diffs.jsonl'));
  const designMapPath = join(runDir, 'design-map.json');
  let design = '';
  if (existsSync(designMapPath)) {
    const dmap = JSON.parse(readFileSync(designMapPath, 'utf8'));
    const byShotD = {};
    for (const d of designDiffs) (byShotD[d.screenshot] = byShotD[d.screenshot] || []).push(d);
    const diffHtml = (d) => `<div class=flaw>
     <span class=sev style="color:${SEV[d.severity]}">${esc(d.severity)}</span>
     <b>${esc(d.summary)}</b> <span class=tag>${esc(d.category)} · design</span>${annotatedLink(d.id)}
     <div style="color:#555;font-size:13px">${esc(d.detail)}</div>
     <div style="color:#777;font-size:12.5px">expected: ${esc(d.expected)} → actual: ${esc(d.actual)}</div></div>`;
    const rows = dmap.screens.map((m) => `<div class=screen>
     <img src="${esc(m.figma_image)}" alt="design: ${esc(m.figma_frame)}" title="design: ${esc(m.figma_frame)}">
     <img src="${esc(m.screenshot)}" alt="${esc(m.screen)}" title="implementation">
     <div style="flex:1">
       <h3>${esc(m.screen)} <span class=tag>vs “${esc(m.figma_frame)}” · matched by ${esc(m.method)} (${m.confidence})</span></h3>
       ${(byShotD[m.screenshot] || []).sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity)).map(diffHtml).join('') || '<div class=tag>matches the design</div>'}
     </div></div>`).join('');
    const gaps = [
      dmap.unmatchedFrames?.length ? `<div class=tag style="margin-bottom:6px">designed but never reached this run: ${dmap.unmatchedFrames.map((f) => esc(f.name)).join(' · ')}</div>` : '',
      dmap.unmatchedScreens?.length ? `<div class=tag>no design counterpart (runtime-only): ${dmap.unmatchedScreens.map((s) => esc(s.screen)).join(' · ')}</div>` : '',
    ].join('');
    design = `<h2 style="margin:36px 0 12px;font-size:17px">Design fidelity <span class=tag>vs “${esc(dmap.figma?.name || 'Figma')}” · ${dmap.screens.length} matched · ${designDiffs.length} deviation(s)</span></h2>${rows}${gaps}`;
  }

  const html = head + header + `<main>${screens}${design}</main>`;
  const out = join(runDir, 'report.html');
  writeFileSync(out, html);
  console.log(`report → ${out}  (${order.length} screens, ${allFlaws.length} flaws: ${counts.high || 0}H/${counts.medium || 0}M/${counts.low || 0}L)`);
  return out;
}

let runDir = process.argv[2];
if (!runDir || !existsSync(join(runDir, 'journal.jsonl'))) runDir = latestRun(process.env.TARGET); // arg may be a target, not a dir
if (!runDir) { console.error('no run dir found; pass one as an argument'); process.exit(1); }
buildReport(runDir);
process.exit(0);
