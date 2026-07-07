import { connectMobileMcp, sleep } from './mcp.mjs';
import { writeFileSync } from 'node:fs';
const DEVICE = 'A5C6484B-5346-4BEC-8F4C-FFDDA286D71C';
const mcpc = await connectMobileMcp(DEVICE);
await mcpc.terminate('ai.beemo.fittrack'); await mcpc.launchAndWait('ai.beemo.fittrack', 6000);

let els = await mcpc.listElements();
const u = els.find((e) => /username/i.test(e.label));
console.log('USERNAME FIELD:', u ? `@${u.x},${u.y} type=${u.type}` : 'NOT FOUND');
if (!u) process.exit(1);

console.log('tapping field...');
await mcpc.tap(u.x, u.y); await sleep(1000);
els = await mcpc.listElements();
const keys = els.filter((e) => /^[a-z]$/i.test(e.label)).length;
console.log(`keyboard up? single-letter keys visible = ${keys}`);

console.log('typing "demo"...');
await mcpc.typeText('demo'); await sleep(1000);
const img = await mcpc.screenshotImage();
writeFileSync('/private/tmp/claude-502/-Users-tejas1-Documents-Code-side-projects-ios-tester/68b9b7c2-759e-4885-8e2d-8f97334b02b2/scratchpad/type-test.png', Buffer.from(img.data, 'base64'));
els = await mcpc.listElements();
const after = els.find((e) => /username|demo/i.test(e.label));
console.log('USERNAME ELEMENT AFTER TYPE:', JSON.stringify(after));
console.log('any element now containing "demo":', els.filter((e) => /demo/i.test(e.label)).map((e) => e.label));
process.exit(0);
