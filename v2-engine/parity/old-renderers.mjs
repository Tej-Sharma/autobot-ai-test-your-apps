// ============================================================================
// parity/old-renderers.mjs — VERBATIM transcriptions of the memory-trace and
// coverage renderers (and actionStr) from the OLD engines' explore.mjs files,
// wrapped to take their closed-over state as explicit parameters (the bodies
// are unchanged). They exist only so parity/check.mjs can prove the new
// core renderers produce byte-identical output.
// ============================================================================

const orDash = (a) => (a && a.length ? a.join('; ') : '—');
const untriedOf = (n) => (n.controls || []).filter((c) => !n.tried.includes(c));

// ---- OLD MOBILE (v2-mobile-tester/engine/explore.mjs) ----
export function oldMobileRenderMemory(trace) {
  if (!trace.length) return '(empty — this is your first turn)';
  return trace.map((t) => [
    `--- step: ${t.step}  |  time: ${t.time}  |  screen: ${t.screen}`,
    `  action: ${t.action}`,
    `  expectation: ${t.expectation}`,
    `  result: ${t.expectationCheck}`,
    `  reasoning: ${t.reasoning}`,
    `  uiDone: ${t.uiDone}`,
    `  goalsSoFar: ${orDash(t.goalsSoFar)}`,
    `  goalsCompleted: ${orDash(t.goalsCompleted)}`,
    `  areasRemaining: ${orDash(t.areasRemaining)}`,
    `  flaws: ${orDash(t.flaws)}`,
    `  crashed: ${t.crashed}`,
  ].join('\n')).join('\n\n');
}

export function oldMobileRenderCoverage({ g, sig, els, tabsSeen, tabsTried, flowsDone, controlsOf }) {
  const hereTried = g.nodes[sig]?.tried || [];
  const hereUntried = controlsOf(els, [...tabsSeen]).map((c) => c.label).filter((l) => !hereTried.includes(l));
  const elsewhere = Object.values(g.nodes)
    .filter((n) => n.signature !== sig && untriedOf(n).length)
    .slice(0, 12)
    .map((n) => {
      const u = untriedOf(n);
      return `• ${n.name}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? ` (+${u.length - 8} more)` : ''}`;
    });
  const tabsLeft = [...tabsSeen].filter((t) => !tabsTried.has(t));
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  return [
    `Screens mapped: ${nodes.length} · controls exercised: ${tried}/${total || '?'}`,
    `Untried on THIS screen: ${hereUntried.join(', ') || 'none — everything here was exercised'}`,
    tabsLeft.length ? `Tabs never opened: ${tabsLeft.join(', ')}` : null,
    elsewhere.length ? `Untried controls on OTHER screens (paths you didn't trace):\n${elsewhere.join('\n')}` : 'No other screens with untried controls.',
    flowsDone.length ? `Flows already completed this run (do NOT re-declare these): ${flowsDone.map((f) => `"${f.name}" (steps ${f.startStep}–${f.endStep})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

export const oldMobileActionStr = (a) => `${a.kind}${a.label ? ` '${a.label}'` : ''}${a.text ? ` "${a.text}"` : ''}${a.direction ? ` ${a.direction}` : ''}`;

// ---- OLD WEB (v2-web-tester/engine/explore.mjs) ----
export function oldWebRenderMemory(trace) {
  if (!trace.length) return '(empty — this is your first turn)';
  return trace.map((t) => [
    `--- step: ${t.step}  |  time: ${t.time}  |  page: ${t.screen}  |  url: ${t.url}`,
    `  action: ${t.action}`,
    `  expectation: ${t.expectation}`,
    `  result: ${t.expectationCheck}`,
    `  reasoning: ${t.reasoning}`,
    `  uiDone: ${t.uiDone}`,
    `  goalsSoFar: ${orDash(t.goalsSoFar)}`,
    `  goalsCompleted: ${orDash(t.goalsCompleted)}`,
    `  areasRemaining: ${orDash(t.areasRemaining)}`,
    `  flaws: ${orDash(t.flaws)}`,
    `  crashed: ${t.crashed}`,
  ].join('\n')).join('\n\n');
}

export function oldWebRenderCoverage({ g, sig, els, navSeen, navTried, flowsDone, controlsOf }) {
  const hereTried = g.nodes[sig]?.tried || [];
  const hereUntried = controlsOf(els, [...navSeen]).map((c) => c.label).filter((l) => !hereTried.includes(l));
  const elsewhere = Object.values(g.nodes)
    .filter((n) => n.signature !== sig && untriedOf(n).length)
    .slice(0, 12)
    .map((n) => {
      const u = untriedOf(n);
      return `• ${n.name}${n.url ? ` (${n.url})` : ''}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? ` (+${u.length - 8} more)` : ''}`;
    });
  const navLeft = [...navSeen].filter((t) => !navTried.has(t));
  const nodes = Object.values(g.nodes);
  const total = nodes.reduce((s, n) => s + (n.controls || []).length, 0);
  const tried = nodes.reduce((s, n) => s + n.tried.length, 0);
  return [
    `Pages mapped: ${nodes.length} · controls exercised: ${tried}/${total || '?'}`,
    `Untried on THIS page: ${hereUntried.join(', ') || 'none — everything here was exercised'}`,
    navLeft.length ? `Nav links never opened: ${navLeft.join(', ')}` : null,
    elsewhere.length ? `Untried controls on OTHER pages (paths you didn't trace — you can navigate straight to their URLs):\n${elsewhere.join('\n')}` : 'No other pages with untried controls.',
    flowsDone.length ? `Flows already completed this run (do NOT re-declare these): ${flowsDone.map((f) => `"${f.name}" (steps ${f.startStep}–${f.endStep})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

export const oldWebActionStr = (a) => `${a.kind}${a.label ? ` '${a.label}'` : ''}${a.text ? ` "${a.text}"` : ''}${a.url ? ` ${a.url}` : ''}`;
