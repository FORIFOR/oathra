#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, lstatSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDirectory, requirePlugin } from '../../sdk/plugin-kit/index.mjs';
import { builtinRegistry, loadPluginRegistry } from './lib/plugins.mjs';

export function scaffold(kind,id,path) {
 requirePlugin(['channel','capability'].includes(kind)&&/^[a-z][a-z0-9-]{0,47}$/.test(id),'usage_create_channel_or_capability_id_directory');
 requirePlugin(!existsSync(path),'plugin_directory_exists');
 const manifest={id,name:id,version:'0.1.0',apiVersion:1,kind,entry:'./index.mjs',permissions:kind==='channel'?['mission:draft','mission:read','approval:request','channel:send']:['followup:execute'],environment:kind==='channel'?['CUSTOM_WEBHOOK_SECRET']:[],configSchema:{type:'object',properties:{},additionalProperties:false},...(kind==='capability'?{effect:'crm'}:{features:{text:true,audio:false,interactiveApproval:true,progress:true,result:true}})};
 mkdirSync(path,{recursive:true,mode:0o700});
 writeFileSync(resolve(path,'oathra.plugin.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 const channel=`import { createHmac, timingSafeEqual } from 'node:crypto';
export default function create({env}) {
 return {
  ready:()=>false, // Set true only after outbound delivery is implemented/configured.
  verify(raw,headers){
   if(!env.CUSTOM_WEBHOOK_SECRET||typeof headers['x-plugin-signature']!=='string')return false;
   const a=Buffer.from(createHmac('sha256',env.CUSTOM_WEBHOOK_SECRET).update(raw).digest('hex'));
   const b=Buffer.from(headers['x-plugin-signature']);return a.length===b.length&&timingSafeEqual(a,b);
  },
  decode(raw){const data=JSON.parse(raw);return {events:data.events};},
  async send(message,{signal}){throw Error('implement_provider_delivery_before_enabling');}
 };
}
`;
 const capability=`export default function create() {
 return {
  ready:()=>false,
  preview(input){if(typeof input.body!=='string'||!input.body.trim())throw Error('body_required');return {body:input.body};},
  async execute(action,{signal}){throw Error('implement_provider_write_before_enabling');}
 };
}
`;
 writeFileSync(resolve(path,'index.mjs'),kind==='channel'?channel:capability,{mode:0o600});
 writeFileSync(resolve(path,'README.md'),`# ${id}\n\nGenerated Oathra ${kind} plugin. This template cannot send messages or place calls.\nImplement the provider adapter, review its data destinations and credentials, test authentication,\nthen inspect and explicitly trust the local directory. Do not replace send/execute with fake success.\n\nSee docs/PLUGINS.ja.md in the Oathra repository for protocol v1 and trust boundaries.\n`,{mode:0o600});
 return inspectDirectory(path);
}
function save(path,c){mkdirSync(dirname(path),{recursive:true,mode:0o700});requirePlugin(!existsSync(path)||!lstatSync(path).isSymbolicLink(),'plugin_config_symlink_rejected');const tmp=path+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,path);}
export async function cli(args,env=process.env){
 const [cmd,...rest]=args,flag=name=>{const i=rest.indexOf('--'+name);return i<0?undefined:rest[i+1];};
 const file=resolve(flag('file')??env.OATHRA_PLUGINS_FILE??'.oathra/plugins.json');
 if(cmd==='create'){const info=scaffold(rest[0],rest[1],resolve(rest[2]??''));return {created:info.manifest.id,integrity:info.integrity,enabled:false};}
 if(cmd==='inspect'||cmd==='pin'){const info=inspectDirectory(resolve(rest[0]));return {id:info.manifest.id,manifest:info.manifest,integrity:info.integrity,executesCode:false};}
 if(cmd==='doctor'){const r=await loadPluginRegistry({...env,OATHRA_PLUGINS_FILE:existsSync(file)?file:undefined});try{return {scope:'local_registration_and_configuration_not_provider_connectivity',plugins:r.list()};}finally{await r.close();}}
 let c=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:1,disabledBuiltins:[],entries:[]};
 requirePlugin(c.version===1&&Array.isArray(c.entries)&&Array.isArray(c.disabledBuiltins),'invalid_plugins_configuration');
 if(cmd==='list')return {restartRequiredAfterChanges:true,builtins:builtinRegistry({},{disabled:c.disabledBuiltins}).list(),external:c.entries.map(e=>({id:e.id,enabled:e.enabled,integrity:e.integrity}))};
 if(cmd==='add'){
  const info=inspectDirectory(resolve(rest[0]));requirePlugin(flag('trust')===info.integrity,'review_source_then_pass_exact_trust_hash',403);
  requirePlugin(!builtinRegistry({}).list().some(p=>p.id===info.manifest.id)&&!c.entries.some(e=>e.id===info.manifest.id),'duplicate_plugin_id');
  c.entries.push({id:info.manifest.id,path:relative(dirname(file),info.root)||'.',enabled:true,integrity:info.integrity,grants:info.manifest.permissions,config:{}});
  save(file,c);return {id:info.manifest.id,added:true,restartRequired:true};
 }
 if(cmd==='enable'||cmd==='disable'){
  const id=rest[0],builtin=builtinRegistry({}).list().some(p=>p.id===id);
  if(builtin)c.disabledBuiltins=cmd==='disable'?[...new Set([...c.disabledBuiltins,id])]:c.disabledBuiltins.filter(x=>x!==id);
  else {const e=c.entries.find(e=>e.id===id);requirePlugin(e,'plugin_not_found');if(cmd==='enable')requirePlugin(inspectDirectory(resolve(dirname(file),e.path)).integrity===e.integrity,'plugin_integrity_mismatch',403);e.enabled=cmd==='enable';}
  save(file,c);return {id,enabled:cmd==='enable',restartRequired:true};
 }
 throw Error('Usage: plugins.mjs create <channel|capability> <id> <dir> | inspect <dir> | pin <dir> | add <dir> --trust <hash> [--file <config>] | list | doctor | enable <id> | disable <id>');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.code??e.message);process.exitCode=1;});
