// ============================================================================
// interactions.mjs — coverage primitives: scrolling (#5), modal/alert/permission
// handling (#6), and general form-fill (#7). All take the mcp client.
// ============================================================================
import { sleep } from './mcp.mjs';

// ---- #5 scrolling ----------------------------------------------------------
export const scrollDown = async (mcpc) => { await mcpc.swipe('up'); await sleep(700); };   // content up
export const scrollUp = async (mcpc) => { await mcpc.swipe('down'); await sleep(700); };

// find an element by label on the current screen; if absent, scroll down up to `max` times.
export async function findOrScroll(mcpc, label, max = 4) {
  const L = label.toLowerCase();
  for (let i = 0; i <= max; i++) {
    const els = await mcpc.listElements();
    const hit = els.find((e) => e.label.toLowerCase() === L);
    if (hit) return hit;
    if (i < max) await scrollDown(mcpc);
  }
  return null;
}

// scroll a screen top→bottom collecting every unique control (below-the-fold discovery).
export async function collectScrollable(mcpc, controlsOf, tabLabels, max = 4) {
  const byLabel = new Map();
  let prev = '';
  for (let i = 0; i <= max; i++) {
    const els = await mcpc.listElements();
    for (const c of controlsOf(els, tabLabels)) if (!byLabel.has(c.label)) byLabel.set(c.label, c);
    const sig = els.map((e) => e.label).join('|');
    if (sig === prev) break;            // nothing new scrolled into view
    prev = sig;
    if (i < max) await scrollDown(mcpc);
  }
  for (let i = 0; i < max; i++) await scrollUp(mcpc); // return to top
  return [...byLabel.values()];
}

// ---- #6 modals / alerts / permission dialogs -------------------------------
const ALERT_BTN = /^(allow|ok|continue|got it|done|dismiss|not now|cancel|close|no thanks|maybe later)$/i;
const DESTRUCTIVE = /delete|remove|erase|don.?t allow|sign out|log out/i;
const modalButtons = (els) => els.filter((e) => ALERT_BTN.test(e.label) || /allow|deny|don.?t allow/i.test(e.label));

export function isModal(els) {
  const btns = modalButtons(els);
  // small overlay dominated by alert-style buttons (permission prompt / confirm sheet)
  return btns.length >= 1 && els.length <= 14 && els.some((e) => /allow|deny|don.?t allow/i.test(e.label) || ALERT_BTN.test(e.label));
}

// dismiss a blocking modal via a SAFE, progressing button (avoid destructive choices).
export async function handleModal(mcpc, els) {
  const btns = modalButtons(els).filter((b) => !DESTRUCTIVE.test(b.label));
  const pick = btns.find((b) => /allow|ok|continue|got it|done/i.test(b.label)) || btns.find((b) => /not now|cancel|close|dismiss/i.test(b.label)) || btns[0];
  if (!pick) return null;
  await mcpc.tap(pick.x, pick.y); await sleep(800);
  return pick.label;
}

// ---- #7 general form-fill --------------------------------------------------
function testValue(label, testData = {}) {
  const l = (label || '').toLowerCase();
  if (/email/.test(l)) return testData.email || 'test@example.com';
  if (/phone|mobile|tel/.test(l)) return testData.phone || '5551234567';
  if (/name/.test(l)) return testData.name || 'Test User';
  if (/search/.test(l)) return testData.search || 'test';
  if (/age|number|count|qty/.test(l)) return testData.number || '5';
  if (/password|pass/.test(l)) return testData.password || 'Test1234!';
  return testData.default || 'test';
}

// fill every unfilled text field on the current screen with sensible test data.
export async function fillForms(mcpc, testData = {}) {
  const els = await mcpc.listElements();
  const fields = els.filter((e) => /field/i.test(e.type || '') || /field/i.test(e.label)).sort((p, q) => p.y - q.y);
  if (!fields.length) return 0;
  for (const f of fields) { await mcpc.tap(f.x, f.y); await sleep(400); await mcpc.typeText(testValue(f.label, testData)); await sleep(300); }
  await mcpc.tap(fields[0].x, Math.max(60, fields[0].y - 140)); await sleep(400); // dismiss keyboard
  return fields.length;
}
