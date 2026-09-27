/** An intentionally narrow HTTP client shared by MCP and external applications. */
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
export function gatewayOrigin(raw) {
 const u=new URL(raw);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&LOOPBACK.has(u.hostname)))) throw Error('gateway_origin_required');
 return u.origin;
}
export function safeError(error) {
 if(typeof error?.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(error.code))return error.code;
 return error?.name==='AbortError'||error?.name==='TimeoutError'?'gateway_timeout':'gateway_unavailable';
}
export function agentClient({baseUrl,token,fetchImpl=fetch,timeoutMs=15000}) {
 const base=gatewayOrigin(baseUrl);
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('gateway_token_required');
 async function request(path,method='GET',body,signal) {
  const timeout=AbortSignal.timeout(timeoutMs), combined=signal?AbortSignal.any([timeout,signal]):timeout;
  let response;
  try{response=await fetchImpl(base+path,{method,redirect:'error',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:combined});}
  catch(e){throw Object.assign(new Error('Gateway request failed'),{code:combined.aborted?'gateway_timeout':'gateway_unavailable'});}
  const chunks=[];let bytes=0;
  if(!response.body)throw Object.assign(Error('Empty response'),{code:'gateway_invalid_response'});
  for await(const part of response.body){bytes+=part.length;if(bytes>262144)throw Object.assign(Error('Response too large'),{code:'gateway_response_too_large'});chunks.push(part);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Not JSON'),{code:'gateway_invalid_response'});}
  if(!response.ok)throw Object.assign(Error('Gateway rejected the request'),{code:typeof value.error==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(value.error)?value.error:'gateway_request_failed',status:response.status});
  // Do not allow an unexpected credential field to cross into an LLM's tool output.
  const clean=(x,depth=0)=>{
   if(depth>20)throw Object.assign(Error('Invalid response'),{code:'gateway_invalid_response'});
   if(typeof x==='string')return x.split(token).join('[redacted]');
   if(Array.isArray(x))return x.map(v=>clean(v,depth+1));
   if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>!/(token|secret|password|authorization|credential|api.?key)/i.test(k)).map(([k,v])=>[k,clean(v,depth+1)]));
   return x;
  };
  return clean(value);
 }
 const id=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw Object.assign(Error('Invalid ID'),{code:'invalid_mission_id'});return value;};
 return Object.freeze({
  capabilities:signal=>request('/v1/agent/phone/capabilities','GET',undefined,signal),
  draft:(input,signal)=>request('/v1/agent/phone/draft','POST',input,signal),
  status:(missionId,signal)=>request('/v1/agent/phone/calls/'+id(missionId),'GET',undefined,signal),
  // Legacy read/draft tools retained, with no review/start operation.
  list:()=>request('/v1/bootstrap').then(v=>({products:v.products,contacts:v.contacts,missions:v.missions})),
  missionDraft:input=>request('/v1/missions/draft','POST',input),
  missionStatus:missionId=>request('/v1/missions/'+id(missionId)),
 });
}
