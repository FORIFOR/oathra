import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PluginRegistry, loadExternal, validateConfig, requirePlugin, digest, freezeData } from '../../../sdk/plugin-kit/index.mjs';
import line from '../../../plugins/line/index.mjs';
import slack from '../../../plugins/slack/index.mjs';
import call from '../../../plugins/call/index.mjs';
import email from '../../../plugins/email/index.mjs';
import calendar from '../../../plugins/calendar/index.mjs';
import sms from '../../../plugins/sms/index.mjs';
import crm from '../../../plugins/crm/index.mjs';
const factories={line,slack,call,email,calendar,sms,crm};
export function builtinRegistry(env={}, {now=Date.now,fetchImpl=fetch,executeCall,disabled=[]}={}) {
 const r=new PluginRegistry();
 requirePlugin(Array.isArray(disabled)&&disabled.every(id=>Object.hasOwn(factories,id)), 'invalid_builtin_disable');
 for(const [id,factory] of Object.entries(factories)){
  const root=new URL(`../../../plugins/${id}/`,import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('oathra.plugin.json',root),'utf8'));
  const scopedEnv=freezeData(Object.fromEntries(manifest.environment.map(k=>[k,env[k]])));
  const identity=digest(Buffer.concat([readFileSync(new URL('index.mjs',root)),readFileSync(new URL('../../../plugins/_shared/http.mjs',import.meta.url)),...(id==='call'?[readFileSync(new URL('./phone.mjs',import.meta.url)),Buffer.from(JSON.stringify([env.OATHRA_VOICE_ENGINE,env.OATHRA_VOICE_MODEL]))]:[])]));
  r.register(manifest,factory({env:scopedEnv,now,fetchImpl,executeCall,config:validateConfig({},manifest.configSchema)}),{enabled:!disabled.includes(id),integrity:identity+':'+digest(JSON.stringify(scopedEnv))});
 }
 return r;
}
export async function loadPluginRegistry(env={}, options={}) {
 let c={version:1,disabledBuiltins:[],entries:[]},baseDir=process.cwd();
 if(env.OATHRA_PLUGINS_FILE){const path=resolve(env.OATHRA_PLUGINS_FILE);baseDir=dirname(path);c=JSON.parse(readFileSync(path,'utf8'));}
 requirePlugin(c.version===1&&Object.keys(c).every(k=>['version','disabledBuiltins','entries'].includes(k)), 'invalid_plugins_configuration');
 const registry=builtinRegistry(env,{...options,disabled:c.disabledBuiltins??[]});
 try{return await loadExternal(registry,c.entries??[],{...options,env,baseDir});}
 catch(e){await registry.close();throw e;}
}
