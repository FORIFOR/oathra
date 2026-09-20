/** Experimental authenticated Gateway v1 client. Never retries mutations automatically. */
export function gatewayClient({baseUrl,token,fetchImpl=fetch}) {
 const url=new URL(baseUrl);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new TypeError('Use an HTTPS origin (HTTP is allowed only on loopback).');
 async function request(path,method='GET',body,key) {
  const response=await fetchImpl(url.origin+'/v1'+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error??'gateway_error'),{status:response.status,code:result.error,requestId:result.requestId});return result;
 }
 const id=value=>encodeURIComponent(value);
 return {
  credits:()=>request('/credits'),ledger:(after=0)=>request('/credits/ledger?after='+id(after)),
  phoneStatus:()=>request('/phone/status'),phoneTemplates:()=>request('/phone/templates'),
  phoneDraft:input=>request('/phone/draft','POST',input),phoneHistory:()=>request('/phone/history'),
  phoneRecord:missionId=>request('/phone/calls/'+id(missionId)),
  consent:version=>request('/consent','POST',{version}),
  draft:input=>request('/missions/draft','POST',input),review:missionId=>request('/missions/'+id(missionId)+'/review','POST',{}),
  start:({missionId,approvalToken,idempotencyKey,acknowledged})=>request('/missions/'+id(missionId)+'/start','POST',{approvalToken,acknowledged},idempotencyKey),
  status:missionId=>request('/missions/'+id(missionId)),cancel:missionId=>request('/missions/'+id(missionId)+'/cancel','POST',{}),
  waiveBilling:({missionId,reason,acknowledged})=>request('/missions/'+id(missionId)+'/billing-waive','POST',{reason,acknowledged}),
 };
}
