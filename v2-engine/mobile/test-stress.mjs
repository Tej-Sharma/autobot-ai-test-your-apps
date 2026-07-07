import { connectMobileMcp, sleep } from './mcp.mjs';
const DEVICE = '00008140-000979662E10801C', BUNDLE = 'cloud.coefont.cir-ios';
const mcpc = await connectMobileMcp(DEVICE);
await mcpc.launchAndWait(BUNDLE, 6000);
const N = Number(process.env.N || 30);
for (let i = 1; i <= N; i++) {
  try {
    await mcpc.screenSize();
    const els = await mcpc.listElements();
    const im = await mcpc.screenshotImage();
    // alternate: tap a benign spot, and swipe (scroll) — the engine's heavy ops
    if (i % 3 === 0) { await mcpc.swipe('up'); }
    else { await mcpc.tap(200, 430); }
    await sleep(700);
    process.stdout.write(`  op ${i}: OK (els=${els.length}, img=${im.data.length})\n`);
  } catch (e) {
    process.stdout.write(`  op ${i}: *** WDA FAIL *** ${String(e.message).slice(0, 100)}\n`);
    break;
  }
}
process.exit(0);
