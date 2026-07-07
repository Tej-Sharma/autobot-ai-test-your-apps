import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const mcp = new Client({ name: 'diag', version: '0.0.0' });
await mcp.connect(new StdioClientTransport({ command: 'npx', args: ['-y', '@mobilenext/mobile-mcp@latest'] }));
const { tools } = await mcp.listTools();
console.log('device-ish tools:', tools.map(t=>t.name).filter(n=>/device|list/i.test(n)));

const callByKw = async (label, kw, args={}) => {
  const t = tools.find(t => kw.every(k => t.name.toLowerCase().includes(k)));
  if (!t) { console.log(label, '-> no tool'); return; }
  try {
    const r = await mcp.callTool({ name: t.name, arguments: args });
    const txt = (r.content||[]).map(c=>c.text||c.type).join(' ');
    console.log(`${label} [${t.name}] ->`, txt.slice(0,400));
  } catch (e) { console.log(`${label} [${t.name}] -> ERROR`, String(e.message).slice(0,200)); }
};

await callByKw('list-devices', ['list','devices']);
await callByKw('use-device(udid)', ['use','device'], { device: '00008140-000979662E10801C' });
await callByKw('use-device(name+type)', ['use','device'], { device: '00008140-000979662E10801C', deviceType: 'ios' });
process.exit(0);
