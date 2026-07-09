// ============================================================================
// mobile/driver.mjs — the iOS "hands" for core/explore.mjs: mobile-mcp
// connection, screenshot+a11y observation, coordinate taps with retry
// hardening, simulator keystrokes, voice input via the v1 CLI, and crash
// recovery by relaunch. All behavior (timings, retry sweep, console lines,
// screenshot naming) is carried unchanged from the old engine's explore.mjs.
// No top-level side effects — the entrypoint constructs the driver.
// ============================================================================
import { writeFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { connectMobileMcp, sleep } from './mcp.mjs';
import { isModal, handleModal } from './interactions.mjs';
import { screenSignature, controlsOf, detectTabs, upsertNode } from './stategraph.mjs';

export function createMobileDriver({ BUNDLE, DEVICE, LAUNCH_WAIT, RUN, RESET = false }) {
  // mobile-mcp's text injection (`mobilecli io text`) is a silent no-op on the iOS Simulator —
  // it reports success but nothing lands. Real keystrokes via osascript DO work. So on a
  // simulator we type by focusing the field then sending keystrokes to the Simulator window.
  // execFileSync with an args array — NEVER a shell string: model-authored text routinely
  // contains apostrophes ("next week's launch"), which terminate shell single-quoting and
  // killed whole runs. Only AppleScript's own string escapes are needed (\\ and \"), plus
  // real newlines → the \n escape AppleScript understands.
  const IS_SIM = (() => { try { return execSync('xcrun simctl list devices', { encoding: 'utf8' }).includes(DEVICE); } catch { return false; } })();
  function keystroke(text) {
    const esc = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n?/g, '\n').replace(/\n/g, '\\n');
    try {
      execFileSync('osascript',
        ['-e', 'tell application "Simulator" to activate', '-e', 'delay 0.25', '-e', `tell application "System Events" to keystroke "${esc}"`],
        { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      // Typing failure must not kill the run — the model sees the field stayed empty and
      // adapts. The usual cause is missing macOS Accessibility permission for the app.
      const msg = (e.stderr?.toString() || e.message || '').trim().slice(0, 200);
      console.log(`   ⚠ keystroke failed — ${msg} (grant Accessibility permission to the app in System Settings → Privacy & Security if this persists)`);
    }
  }

  // Voice input: shells out to the v1 CLI's `autobot speak` (TTS + play) rather than
  // reimplementing it — that's where the SIGABRT-safe Multi-Output routing and the
  // meeting-safe device save/restore already live (see AUDIO.md). runner.js resolves
  // AUTOBOT_BIN and flips input->BlackHole for the whole run BEFORE this ever fires; this
  // call only does the TTS+playback, assuming that routing is already in place.
  const AUTOBOT_BIN = process.env.AUTOBOT_BIN || '';
  function speak(text) {
    if (!AUTOBOT_BIN) { console.log('audio: AUTOBOT_BIN not configured — skipping speak (no loopback set up; run autobot setup-audio).'); return; }
    try { execFileSync(AUTOBOT_BIN, ['speak', text], { stdio: 'inherit' }); }
    catch (e) { console.log(`audio: speak failed — ${e.message}`); }
  }

  let mcpc, size, SW = 9999, SH = 9999;
  const clamp = (x, y) => [Math.max(1, Math.min(SW - 1, x)), Math.max(1, Math.min(SH - 1, y))];
  const elemText = (els) => els.length ? els.map((e, i) => `[${i}] "${e.label}"${e.type ? ` (${e.type})` : ''} @${e.x},${e.y}`).join('\n') : '(a11y tree empty)';
  async function snapshot() { const img = await mcpc.screenshotImage(); const els = await mcpc.listElements(); return { img, els }; }

  async function tapBack() {
    const els = await mcpc.listElements();
    const back = els.find((e) => e.y < 110 && e.x < 140 && e.label && e.label.length > 1);
    if (back) { await mcpc.tap(back.x, back.y); return true; }
    await mcpc.swipe('right'); return false; // edge-swipe back as a fallback
  }
  // Terminate via simctl directly, not mobile-mcp: when the app isn't running (fresh run,
  // or right after a crash — exactly when relaunch fires) `simctl terminate` exits 3 and
  // mobile-mcp throws a scary stack trace into the log. Here it's just the expected no-op.
  function terminateQuiet() {
    try { execFileSync('xcrun', ['simctl', 'terminate', DEVICE, BUNDLE], { stdio: 'ignore' }); }
    catch { /* app wasn't running — nothing to terminate */ }
  }
  async function relaunch() {
    if (IS_SIM) {
      // One simctl call terminates any running copy, launches, and FOREGROUNDS the target
      // regardless of what app was open — and fails loudly when the bundle isn't installed,
      // instead of leaving the explorer testing whatever app happened to be foreground.
      const before = await mcpc.snapshotTree();
      try { execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', DEVICE, BUNDLE], { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch (e) {
        const msg = (e.stderr?.toString() || e.message || '').trim().slice(0, 200);
        throw new Error(`could not launch ${BUNDLE} on simulator ${DEVICE} — is the app installed there? (${msg})`);
      }
      await mcpc.waitForContent(LAUNCH_WAIT, before);
    } else { terminateQuiet(); await mcpc.launchAndWait(BUNDLE, LAUNCH_WAIT); }
  }

  // Locate the installed .app bundle by scanning the sim's on-disk app containers —
  // works even when `simctl get_app_container` won't answer (same approach as the
  // desktop app's install detection in src/main/simctl.js).
  function findInstalledApp() {
    const appsDir = join(homedir(), 'Library/Developer/CoreSimulator/Devices', DEVICE, 'data/Containers/Bundle/Application');
    try {
      for (const container of readdirSync(appsDir)) {
        const cdir = join(appsDir, container);
        let entries = []; try { entries = readdirSync(cdir); } catch { continue; }
        for (const entry of entries) {
          if (!entry.endsWith('.app')) continue;
          try {
            const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(cdir, entry, 'Info.plist')], { encoding: 'utf8' }).trim();
            if (id === BUNDLE) return join(cdir, entry);
          } catch { /* unreadable plist — skip */ }
        }
      }
    } catch { /* device dir missing — fall through */ }
    return '';
  }

  // Fresh-install reset (RESET runs): uninstall + reinstall from a temp copy of the
  // installed bundle — the only reset that also clears keychain-persisted auth, so
  // login/signup flows truly start from scratch. The bundle is copied out FIRST because
  // uninstall deletes it; on a failed reinstall the copy is kept and its path reported.
  function resetApp() {
    let appPath = '';
    try { appPath = execFileSync('xcrun', ['simctl', 'get_app_container', DEVICE, BUNDLE, 'app'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* shutdown sim / older Xcode — use the disk scan */ }
    if (!appPath) appPath = findInstalledApp();
    if (!appPath) throw new Error(`cannot reset ${BUNDLE}: app not found on simulator ${DEVICE}`);
    const tmp = mkdtempSync(join(tmpdir(), 'selfloop-reset-'));
    const copy = join(tmp, basename(appPath));
    cpSync(appPath, copy, { recursive: true });
    execFileSync('xcrun', ['simctl', 'uninstall', DEVICE, BUNDLE], { stdio: 'ignore' });
    try { execFileSync('xcrun', ['simctl', 'install', DEVICE, copy], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) {
      const msg = (e.stderr?.toString() || e.message || '').trim().slice(0, 200);
      throw new Error(`app reset failed: reinstall of ${BUNDLE} errored after uninstall — bundle copy preserved at ${copy} (${msg})`);
    }
    rmSync(tmp, { recursive: true, force: true });
    console.log(`   ↺ app reset: ${BUNDLE} uninstalled + reinstalled — fresh state`);
  }

  let _lastTapKey = null, _tapRetries = 0;
  async function execute(a, els) {
    if (a.kind === 'stop') return;
    if (a.kind === 'back') { await tapBack(); await sleep(900); return; }
    if (a.kind === 'relaunch') { await relaunch(); await sleep(900); return; }
    if (a.kind === 'swipe') { await mcpc.swipe(a.direction || 'up'); await sleep(900); return; }
    if (a.kind === 'speak') { if (a.text) speak(a.text); await sleep(1500); return; } // let the app react before the next screenshot
    // tap / type
    const el = (a.elementIndex != null) ? els[a.elementIndex] : null;
    let x = el ? el.x : a.x, y = el ? el.y : a.y;
    if (x == null) { await sleep(900); return; }
    // RETRY HARDENING: if we're tapping the same target again (the model thinks the last tap did
    // nothing — often a near-miss on a small control), wait a touch longer and nudge the point to
    // a DIFFERENT spot inside the element. Offset scales with the element's size and grows with
    // each consecutive retry, sweeping the area so a missed hit-target eventually lands.
    const key = el ? `${el.label}@${el.x},${el.y}` : `${x},${y}`;
    if (key === _lastTapKey) _tapRetries++; else { _lastTapKey = key; _tapRetries = 0; }
    if (_tapRetries > 0) {
      await sleep(450 * _tapRetries);                                   // progressive settle delay
      const w = el?.w || 40, h = el?.h || 40, ang = _tapRetries * 2.0;  // rotate the offset direction
      const frac = Math.min(0.4, 0.18 * _tapRetries);                  // step further out each retry
      x = Math.round(x + Math.cos(ang) * (w / 2) * frac);
      y = Math.round(y + Math.sin(ang) * (h / 2) * frac);
    }
    [x, y] = clamp(x, y);
    if (a.kind === 'type') { await mcpc.tap(x, y); await sleep(500); if (a.text) { if (IS_SIM) keystroke(a.text); else await mcpc.typeText(a.text); } }
    else await mcpc.tap(x, y);
    await sleep(900);
  }

  let shotN = 0;
  const checkpoint = (img, name) => {
    const file = `screenshots/${String(++shotN).padStart(2, '0')}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}.png`;
    writeFileSync(join(RUN, file), Buffer.from(img.data, 'base64')); return file;
  };

  return {
    async start() {
      mcpc = await connectMobileMcp(DEVICE);
      if (RESET) {
        if (IS_SIM) resetApp();
        else console.log('   ⚠ RESET requested but device is not a simulator — starting without reset');
      }
      await relaunch();
      size = await mcpc.screenSize();
      const sm = size.match(/(\d{2,4})\D{1,4}(\d{2,4})/); if (sm) { SW = +sm[1]; SH = +sm[2]; }
    },
    headerDesc: () => `${BUNDLE} (${SW}x${SH})`,
    promptSize: () => size,

    async observe(step) {
      let snap = await snapshot();
      if (isModal(snap.els)) { const p = await handleModal(mcpc, snap.els); console.log(`   • modal dismissed via '${p}'`); snap = await snapshot(); }
      const els = snap.els;
      return {
        img: snap.img,
        els,
        sig: screenSignature(els),
        elSpace: { w: SW, h: SH },
        chromeLabels: detectTabs(els, SW, SH),
        userText: `CURRENT SCREEN — ELEMENTS (index in brackets):\n${elemText(els)}`,
        journalHead: {},
        journalSignals: {},
        recExtras: {},
        upsertExtra: els,
      };
    },

    persistShot: (obs, screenName) => checkpoint(obs.img, screenName),
    execute,
    recover: relaunch,
    crashMessage: '   ⚠ crash detected — relaunching',
    actionStr: (a) => `${a.kind}${a.label ? ` '${a.label}'` : ''}${a.text ? ` "${a.text}"` : ''}${a.direction ? ` ${a.direction}` : ''}`,
    markableKinds: ['tap', 'type'],
    graph: { upsertNode, controlsOf },
    voc: {
      memHeader: (t) => `--- step: ${t.step}  |  time: ${t.time}  |  screen: ${t.screen}`,
      mapped: 'Screens',
      noun: 'screen',
      chromeNever: 'Tabs never opened:',
      elsewhereHeader: `Untried controls on OTHER screens (paths you didn't trace):`,
      noElsewhere: 'No other screens with untried controls.',
      nodeLine: (n, u) => `• ${n.name}: ${u.slice(0, 8).join(', ')}${u.length > 8 ? ` (+${u.length - 8} more)` : ''}`,
      lastLabel: 'screens (last)',
      plural: 'screens',
    },
    close: () => mcpc.close(),
  };
}
