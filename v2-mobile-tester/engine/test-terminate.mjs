import { connectMobileMcp, sleep } from './mcp.mjs';
const DEVICE = '00008140-000979662E10801C', BUNDLE = 'cloud.coefont.cir-ios';
const mcpc = await connectMobileMcp(DEVICE);
const health = async (tag) => {
  try { const im = await mcpc.screenshotImage(); console.log(`  ${tag}: WDA OK (${im.data.length} b)`); return true; }
  catch (e) { console.log(`  ${tag}: WDA *** FAIL *** ${String(e.message).slice(0, 90)}`); return false; }
};
await health('init');
for (let i = 1; i <= 3; i++) {
  console.log(`cycle ${i}: terminate`); await mcpc.terminate(BUNDLE); await sleep(1500);
  if (!await health(`after terminate ${i}`)) break;
  console.log(`cycle ${i}: launch`); await mcpc.launchAndWait(BUNDLE, 8000);
  if (!await health(`after launch ${i}`)) break;
}
process.exit(0);
