import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const API_VERSION = 1;
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const permissions = {
  channel: new Set(['mission:draft', 'mission:read', 'approval:request', 'channel:send', 'media:transcribe']),
  capability: new Set(['followup:execute', 'call:execute']),
};
export class PluginError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requirePlugin(ok, code, status) { if (!ok) throw new PluginError(code, status); }
export const digest = value => createHash('sha256').update(value).digest('hex');
export function freezeData(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freezeData(v); Object.freeze(value); }
  return value;
}
export function jsonData(value, maxBytes = 65536) {
  const s = JSON.stringify(value);
  requirePlugin(typeof s === 'string' && Buffer.byteLength(s) <= maxBytes, 'plugin_payload_too_large');
  const check = v => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    requirePlugin(!['__proto__', 'constructor', 'prototype'].includes(k), 'unsafe_plugin_key'); check(x);
  }};
  const data = JSON.parse(s); check(data); return data;
}
export function validateManifest(input) {
  const m = jsonData(input, 16384);
  requirePlugin(m && !Array.isArray(m) && typeof m === 'object', 'invalid_plugin_manifest');
  const allowed = ['id','name','version','apiVersion','kind','entry','permissions','environment','configSchema','features','effect'];
  requirePlugin(Object.keys(m).every(k => allowed.includes(k)), 'unknown_manifest_field');
  requirePlugin(typeof m.id === 'string' && idPattern.test(m.id), 'invalid_plugin_id');
  requirePlugin(typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 100, 'invalid_plugin_name');
  requirePlugin(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version), 'invalid_plugin_version');
  requirePlugin(m.apiVersion === API_VERSION, 'incompatible_plugin_api');
  requirePlugin(Object.hasOwn(permissions, m.kind), 'invalid_plugin_kind');
  requirePlugin(typeof m.entry === 'string' && /^\.\/[a-zA-Z0-9_./-]+\.mjs$/.test(m.entry) && !m.entry.split('/').includes('..'), 'invalid_plugin_entry');
  requirePlugin(Array.isArray(m.permissions) && new Set(m.permissions).size === m.permissions.length && m.permissions.every(p => permissions[m.kind].has(p)), 'invalid_plugin_permissions');
  const needed = m.kind === 'channel' ? ['channel:send'] : [m.effect === 'call' ? 'call:execute' : 'followup:execute'];
  requirePlugin(needed.every(p => m.permissions.includes(p)), 'missing_plugin_permission');
  requirePlugin(Array.isArray(m.environment) && m.environment.length <= 30 && new Set(m.environment).size === m.environment.length && m.environment.every(k => typeof k==='string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(k) && !['OATHRA_DATA_KEY','OATHRA_USERS_JSON','OATHRA_GATEWAY_TOKEN','OATHRA_PLUGINS_FILE','NODE_OPTIONS'].includes(k)), 'invalid_plugin_environment');
  if(m.kind==='channel'&&m.permissions.includes('approval:request'))requirePlugin(m.permissions.includes('mission:read'),'approval_requires_mission_read');
  if (m.kind === 'capability') requirePlugin(['email','calendar','sms','crm','call'].includes(m.effect), 'invalid_capability_effect');
  if (m.features !== undefined) requirePlugin(m.features && !Array.isArray(m.features) && Object.keys(m.features).every(k => ['text','audio','interactiveApproval','progress','result'].includes(k) && typeof m.features[k] === 'boolean'), 'invalid_channel_features');
  validateSchema(m.configSchema ?? {type:'object', properties:{}, additionalProperties:false});
  return freezeData(m);
}
// Deliberately small JSON Schema subset. Unsupported schema keywords fail closed.
function validateSchema(s, depth = 0) {
  requirePlugin(depth <= 6 && s && !Array.isArray(s) && typeof s === 'object', 'invalid_config_schema');
  requirePlugin(Object.keys(s).every(k => ['type','properties','required','additionalProperties','enum','minLength','maxLength','minimum','maximum','items','maxItems','description'].includes(k)), 'unsupported_config_schema_keyword');
  requirePlugin(['object','string','boolean','number','integer','array'].includes(s.type), 'unsupported_config_schema_type');
  if (s.type === 'object') {
    requirePlugin(s.additionalProperties === false, 'config_schema_must_be_strict');
    requirePlugin(s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties), 'invalid_config_schema');
    requirePlugin(Object.keys(s.properties).length <= 40 && (!s.required || (Array.isArray(s.required) && s.required.every(k => Object.hasOwn(s.properties, k)))), 'invalid_config_schema');
    for (const v of Object.values(s.properties)) validateSchema(v, depth + 1);
  }
  if (s.type === 'array') validateSchema(s.items, depth + 1);
}
export function validateConfig(value, schema = {type:'object', properties:{}, additionalProperties:false}) {
  validateSchema(schema);
  const v = jsonData(value ?? {}, 16384);
  function check(x, s) {
    if (s.type === 'object') { requirePlugin(x && typeof x === 'object' && !Array.isArray(x), 'invalid_plugin_config');
      requirePlugin(Object.keys(x).every(k => Object.hasOwn(s.properties, k)) && (s.required ?? []).every(k => Object.hasOwn(x, k)), 'invalid_plugin_config');
      for (const [k,y] of Object.entries(x)) check(y, s.properties[k]);
    } else if (s.type === 'array') { requirePlugin(Array.isArray(x) && x.length <= (s.maxItems ?? 100), 'invalid_plugin_config'); for (const y of x) check(y,s.items); }
    else if (s.type === 'string') requirePlugin(typeof x === 'string' && x.length >= (s.minLength ?? 0) && x.length <= (s.maxLength ?? 4000), 'invalid_plugin_config');
    else if (s.type === 'boolean') requirePlugin(typeof x === 'boolean', 'invalid_plugin_config');
    else requirePlugin(Number.isFinite(x) && (s.type !== 'integer' || Number.isSafeInteger(x)) && x >= (s.minimum ?? -Infinity) && x <= (s.maximum ?? Infinity), 'invalid_plugin_config');
    if (s.enum) requirePlugin(Array.isArray(s.enum) && s.enum.includes(x), 'invalid_plugin_config');
  }
  check(v, schema); return freezeData(v);
}
export function inspectDirectory(path) {
  requirePlugin(!lstatSync(path).isSymbolicLink(), 'plugin_symlink_rejected');
  const root = realpathSync(path), records = []; let total = 0;
  function walk(dir, depth = 0) {
    requirePlugin(depth <= 10, 'plugin_directory_too_deep');
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name), stat = lstatSync(file);
      requirePlugin(!stat.isSymbolicLink(), 'plugin_symlink_rejected');
      if (stat.isDirectory()) { walk(file, depth + 1); continue; }
      requirePlugin(stat.isFile() && stat.size <= 2_000_000 && records.length < 256, 'plugin_file_limit');
      total += stat.size; requirePlugin(total <= 10_000_000, 'plugin_size_limit');
      records.push([relative(root,file).replaceAll('\\','/'), digest(readFileSync(file))]);
    }
  }
  walk(root);
  const manifest = validateManifest(JSON.parse(readFileSync(join(root,'oathra.plugin.json'),'utf8')));
  const entry = realpathSync(resolve(root,manifest.entry)), rel = relative(root,entry);
  requirePlugin(rel && !rel.startsWith('..') && !isAbsolute(rel), 'plugin_entry_outside_directory');
  return { root, entry, manifest, integrity: 'sha256-' + digest(JSON.stringify(records)) };
}
export class PluginRegistry {
  #plugins = new Map();
  register(manifest, adapter, { grants = manifest.permissions, enabled = true, integrity = 'bundled', config = {} } = {}) {
    const m = validateManifest(manifest);
    requirePlugin(!this.#plugins.has(m.id), 'duplicate_plugin_id');
    requirePlugin(Array.isArray(grants) && new Set(grants).size === grants.length && grants.every(p => m.permissions.includes(p)) && m.permissions.every(p => grants.includes(p)), 'plugin_permissions_not_granted',403);
    const cfg = validateConfig(config,m.configSchema);
    requirePlugin(typeof enabled === 'boolean', 'invalid_plugin_enabled');
    if (enabled) for (const key of m.kind === 'channel' ? ['verify','decode','send'] : m.effect === 'call' ? ['execute'] : ['preview','execute']) requirePlugin(typeof adapter?.[key] === 'function', 'invalid_plugin_implementation');
    const identity = digest(JSON.stringify([m,integrity,cfg]));
    this.#plugins.set(m.id, { manifest:m, adapter:enabled?Object.freeze({...adapter}):null, identity, enabled, grants:new Set(grants) });
    return this;
  }
  get(id, kind) { const p = this.#plugins.get(id); requirePlugin(p && p.enabled && (!kind || p.manifest.kind === kind), 'plugin_not_enabled',503); return p; }
  channel(id) { return this.get(id,'channel').adapter; }
  capability(id) { return this.get(id,'capability').adapter; }
  identity(id) { return this.get(id).identity; }
  allows(id, permission) { return this.get(id).grants.has(permission); }
  demand(id, permission) { requirePlugin(this.allows(id,permission), 'plugin_permission_denied',403); }
  has(id, kind) { const p=this.#plugins.get(id); return !!p?.enabled && (!kind || p.manifest.kind===kind); }
  list(kind) { return [...this.#plugins.values()].filter(p=>!kind||p.manifest.kind===kind).map(p=>({id:p.manifest.id,name:p.manifest.name,version:p.manifest.version,apiVersion:p.manifest.apiVersion,kind:p.manifest.kind,effect:p.manifest.effect,features:p.manifest.features,permissions:[...p.grants],identity:p.identity,enabled:p.enabled,configured:p.enabled ? p.adapter.ready?.() ?? true : false})); }
  async close() { for(const p of this.#plugins.values()) await p.adapter?.close?.(); }
}
/** No auto-discovery, remote downloads, npm lifecycle scripts or implicit approval. Trusted local code only. */
export async function loadExternal(registry, entries, { env = {}, baseDir = process.cwd(), fetchImpl = fetch, now = Date.now } = {}) {
  requirePlugin(Array.isArray(entries) && entries.length <= 64, 'invalid_plugin_entries');
  const prepared=[];const ids=new Set(registry.list().map(p=>p.id));
  for (const e of entries) {
    requirePlugin(e && typeof e.id==='string' && typeof e.path==='string' && typeof e.enabled==='boolean', 'invalid_plugin_entry_config');
    requirePlugin(Object.keys(e).every(k=>['id','path','enabled','integrity','grants','config'].includes(k)), 'unknown_plugin_entry_config');
    const info = inspectDirectory(resolve(baseDir,e.path));
    requirePlugin(info.manifest.id===e.id, 'plugin_id_mismatch');
    requirePlugin(typeof e.integrity==='string' && e.integrity===info.integrity, 'plugin_integrity_mismatch',403);
    const config=validateConfig(e.config,info.manifest.configSchema);
    // Validate grants, identity conflicts and all static metadata BEFORE importing any code.
    const trial=new PluginRegistry(); const shape=Object.fromEntries(['verify','decode','send','preview','execute'].map(k=>[k,()=>{}]));
    trial.register(info.manifest,shape,{grants:e.grants ?? [],enabled:e.enabled,integrity:info.integrity,config});
    requirePlugin(!ids.has(e.id), 'duplicate_plugin_id');ids.add(e.id);prepared.push({e,info,config});
  }
  for(const {e,info,config} of prepared){
    if (!e.enabled) { registry.register(info.manifest,null,{grants:e.grants,enabled:false,integrity:info.integrity,config}); continue; }
    const scopedEnv=freezeData(Object.fromEntries(info.manifest.environment.map(k=>[k,env[k]])));
    const mod=await import(pathToFileURL(info.entry).href+'?integrity='+info.integrity);
    requirePlugin(typeof mod.default==='function','plugin_factory_required');
    const adapter=await mod.default(Object.freeze({env:scopedEnv,config,fetchImpl,now}));
    registry.register(info.manifest,adapter,{grants:e.grants,enabled:true,integrity:info.integrity+':'+digest(JSON.stringify(scopedEnv)),config});
  }
  return registry;
}
