// ============================================================================
// interactions.mjs — coverage primitives: element lookup, modal/dialog/cookie-
// consent handling, and general form-fill. Web sibling of v2-mobile-tester's
// version: no scroll-to-find loop (Playwright's accessibility snapshot reflects
// the full DOM regardless of scroll position, and ref-based click auto-scrolls
// the target into view), and detection is role-based instead of coordinate/type
// heuristics tuned for a mobile a11y tree.
// ============================================================================
import { sleep } from './mcp.mjs';

// Find an element by label via a fresh snapshot — refs go stale across steps, so
// always resolve just-in-time rather than caching one from an earlier snapshot.
export async function findByLabel(mcpc, label) {
  const els = await mcpc.listElements();
  const L = label.toLowerCase();
  return els.find((e) => e.label.toLowerCase() === L) || null;
}

// ---- modals / dialogs / cookie-consent banners -----------------------------
const ALERT_BTN = /^(allow|ok|continue|got it|done|dismiss|not now|cancel|close|no thanks|maybe later|accept|accept all|reject all|manage preferences|i agree)$/i;
const DESTRUCTIVE = /delete|remove|erase|don.?t allow|sign out|log out/i;
const DIALOG_ROLE = /^(dialog|alertdialog)$/;

export function isModal(els) {
  // an explicit ARIA dialog/alertdialog role is the strongest signal.
  if (els.some((e) => DIALOG_ROLE.test(e.role))) return true;
  // fallback for cookie-consent banners that are just styled <div>s with no ARIA role.
  const btns = els.filter((e) => ALERT_BTN.test(e.label));
  return btns.length >= 1 && btns.length <= 4 && els.length <= 20;
}

// dismiss a blocking modal via a SAFE, progressing button (avoid destructive choices).
export async function handleModal(mcpc, els) {
  const btns = els.filter((e) => ALERT_BTN.test(e.label) && !DESTRUCTIVE.test(e.label));
  const pick = btns.find((b) => /^(allow|ok|continue|got it|done|accept|accept all|i agree)$/i.test(b.label))
    || btns.find((b) => /^(not now|cancel|close|dismiss|reject all|manage preferences)$/i.test(b.label))
    || btns[0];
  if (!pick) return null;
  await mcpc.click(pick.ref, pick.label); await sleep(500);
  return pick.label;
}

// ---- general form-fill -------------------------------------------------------
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

const FIELD_ROLE = /^(textbox|searchbox|combobox)$/;

// fill every text field visible on the current screen with sensible test data.
export async function fillForms(mcpc, testData = {}) {
  const els = await mcpc.listElements();
  const fields = els.filter((e) => FIELD_ROLE.test(e.role));
  if (!fields.length) return 0;
  for (const f of fields) { await mcpc.typeText(f.ref, f.label, testValue(f.label, testData)); await sleep(250); }
  return fields.length;
}
