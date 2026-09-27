import { createAgentMcp } from './lib/agent-mcp.mjs';
/** Newline-delimited stdio only. Never forward the parent's other credentials. */
const server = createAgentMcp({ baseUrl: process.env.OATHRA_GATEWAY_URL ?? '', token: process.env.OATHRA_GATEWAY_TOKEN ?? '' });
const limit = 65536;
let buffer = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  buffer = Buffer.concat([buffer, chunk]);
  let newline;
  while ((newline = buffer.indexOf(10)) !== -1) {
    const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
    if (line.length > limit) { process.stderr.write('MCP input limit exceeded\n'); process.exit(1); }
    if (!line.toString('utf8').trim()) continue;
    let message;
    try { message = JSON.parse(line.toString('utf8')); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
    const result = await server.handle(message);
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
  }
  if (buffer.length > limit) { process.stderr.write('MCP input limit exceeded\n'); process.exit(1); }
}
