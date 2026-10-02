/** Provision a bounded agent connection. No calls are placed. */
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayClient } from '../../sdk/gateway-client/index.mjs';

try {
  const {values:v} = parseArgs({options:{url:{type:'string'},'token-file':{type:'string'},phone:{type:'string'},output:{type:'string'},key:{type:'string'},approve:{type:'boolean',default:false},help:{type:'boolean'}}});
  if(v.help){console.log('node apps/gateway/connect-agent.mjs --url <origin> --token-file <operator-secret-file> [--phone <recipient>] [--approve --output <private-connection.json> --key <stable-8-to-128-char-key>]\nWithout --approve, only shows server trial defaults. No calls are placed.');process.exit(0);}
  if(!v.url||!v['token-file'])throw Error('--url and --token-file are required.');
  const client=gatewayClient({baseUrl:v.url,token:readFileSync(v['token-file'],'utf8').trim()});
  const preview=await client.phoneGrantDefaults();
  console.log(JSON.stringify({...preview,defaults:{...preview.defaults,...(v.phone?{phones:[v.phone]}:{})}},null,2));
  if(v.approve){
    if(!v.output)throw Error('--output is required; credentials are never printed.');
    if(preview.needsConsent)throw Error('Accept the current privacy notice in Oathra first.');
    if(preview.needsRecipient&&!v.phone)throw Error('No verified personal phone is registered. Supply --phone.');
    if(!preview.liveReady||!preview.budgetFitsServer)throw Error('The Gateway is not ready for this live trial; inspect the preview.');
    const output=resolve(v.output);if(existsSync(output))throw Error('Output already exists; use that connection or choose a new path.');
    mkdirSync(dirname(output),{recursive:true,mode:0o700});
    const key=v.key??randomUUID();console.log('Connection request key (reuse after a lost response): '+key);
    const c=await client.connectPhoneAgent({...(v.phone?{phones:[v.phone]}:{}),acknowledged:true},key);
    writeFileSync(output,JSON.stringify({...c,baseUrl:new URL(v.url).origin},null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({saved:output,grantId:c.grantId,expiresAt:new Date(c.grant.expiresAt).toISOString(),dialed:false,
      mcpServers:{oathra:{command:process.execPath,args:[fileURLToPath(new URL('./agent-mcp.mjs',import.meta.url))],env:{OATHRA_CONNECTION_FILE:output}}}},null,2));
  }
} catch(e) {console.error('接続設定: '+(e.code??e.message));process.exitCode=1;}
