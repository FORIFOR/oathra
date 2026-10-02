import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { gatewayClient } from './index.mjs';

/** Shared local secret format for Multibot and stdio MCP. Never put this document in a prompt. */
export function readConnectionFile(path) {
  if (!path || !isAbsolute(path)) throw Error('OATHRA_CONNECTION_FILE must be an absolute path.');
  const info = statSync(path);
  if (!info.isFile() || (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid()))) throw Error('Connection file must be private to the current user (chmod 600).');
  if (info.size > 65536) throw Error('Invalid Oathra connection file.');
  let c; try { c = JSON.parse(readFileSync(path,'utf8')); } catch { throw Error('Cannot read the Oathra connection JSON.'); }
  if (c.schemaVersion !== 1 || c.kind !== 'oathra.agent-connection' || typeof c.token !== 'string' || c.token.length < 32 || !/^[a-f0-9-]{36}$/.test(c.grantId)) throw Error('Invalid Oathra connection file.');
  return {connection:c,client:gatewayClient(c)};
}
