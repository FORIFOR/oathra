// Browser only. Approval tokens are held in memory and are never returned to MCP/Genie.
const $=id=>document.getElementById(id),id=location.hash.slice(1);
const valid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
let grant=null,ready=null,account=null,submitting=false,loading=false;
const pendingKey='oathra.agent-review.pending.'+id;
let blockedAfterSubmit=sessionStorage.getItem(pendingKey)==='1';
const show=text=>{$('status').textContent=text;};
async function api(path,method='GET',body,headers={}){
 const r=await fetch('/v1'+path,{method,credentials:'same-origin',redirect:'error',headers:{...(body?{'content-type':'application/json'}:{}),...(account?.user?.id?{'x-oathra-account':account.user.id}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok)throw new Error(r.status===401?'Oathraへログインした後、状態を再確認してください。':String(data.error??'request_failed'));
 return data;
}
function render(m){
 $('details').replaceChildren();
 const fields=[['依頼ID',m.id],['状態',m.status],['環境',m.mode==='simulator'?'シミュレーター（実発信なし）':'実電話'],['相手',m.target?.name],['電話番号',m.target?.phone],['音声AI',m.phoneRequest?.engine??'サービスの標準'],['声・プリセット',[m.phoneRequest?.voice,m.phoneRequest?.voicePreset].filter(Boolean).join(' / ')||'標準'],['最長時間',`${m.maxSeconds}秒`],['予算上限',`USD ${m.maxUsd}`],['見積最大額',`USD ${m.estimatedMaximumUsd}`]];
 for(const [label,value]of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value??'未確認');$('details').append(dt,dd);}
 $('instruction').textContent=m.phoneRequest?.instruction??m.request??'';
 $('billing').textContent='クレジット条件\n'+JSON.stringify(m.creditQuote??{},null,2);
}
function reset(){grant=null;$('approval').hidden=true;$('consent').checked=false;$('start').disabled=true;$('review').hidden=true;}
async function refresh(){
 if(!valid){show('依頼IDが不正です。');return;}if(submitting||loading)return;loading=true;reset();
 try{
  const [m,r,b]=await Promise.all([api('/missions/'+id),api('/phone/status'),api('/bootstrap')]);
  ready=r;account=b;render(m);
  if(m.status!=='DRAFT'){blockedAfterSubmit=true;sessionStorage.setItem(pendingKey,'1');}
  $('disclosure').textContent=r.disclosure??'';
  // The chosen engine's vendor disclosure must not silently inherit a GPT-only description.
  if(m.phoneRequest?.engine==='gemini-live')$('disclosure').textContent+=' 選択した音声エンジンではGoogleにも会話データを送信します。';
  show(m.status==='DRAFT'?'下書きです。まだ発信していません。':`現在の状態：${m.status}。通話終了と業務の完了は別です。`);
  $('review').hidden=!(m.status==='DRAFT'&&r.ready&&['admin','operator'].includes(b.user?.role)&&!blockedAfterSubmit);
  if(m.status==='DRAFT'&&!['admin','operator'].includes(b.user?.role))show('このアカウントでは発信を承認できません。');
  if(m.status==='DRAFT'&&!r.ready)show('現在は実発信できません。'+(r.issues??[]).join(' '));
  if(blockedAfterSubmit&&m.status==='DRAFT')show('開始要求の結果を確認中です。再送・再発信せず管理者に確認してください。');
 }catch(e){show(e.message);}finally{loading=false;}
}
$('review').addEventListener('click',async()=>{
 if(submitting||loading||blockedAfterSubmit)return;
 reset();$('review').disabled=true;
 try{
  const result=await api('/missions/'+id+'/review','POST',{});render(result.mission);
  grant={...result,obtainedAt:Date.now(),key:crypto.randomUUID()};$('approval').hidden=false;
  show('上の相手・用件・料金を確認し、ご本人が最終承認してください。');
 }catch(e){show(e.message);}finally{$('review').disabled=false;}
});
$('consent').addEventListener('change',()=>{$('start').disabled=!$('consent').checked||!grant||submitting||blockedAfterSubmit;});
$('start').addEventListener('click',async()=>{
 if(!grant||!$('consent').checked||submitting||blockedAfterSubmit)return;
 if(Date.now()-grant.obtainedAt>Math.min(grant.expiresInSeconds??300,300)*1000){reset();show('確認の期限が切れました。再度内容を確認してください。');return;}
 submitting=true;$('start').disabled=true;
 try{
  // consentVersion comes from server state, never from the agent's tool arguments.
  const version=account?.configuration?.consentVersion;
  if(typeof version!=='string')throw Error('同意文書の版を取得できません。Gatewayの通常画面で確認してください。');
  if(account?.account?.consentVersion!==version)await api('/consent','POST',{version});
  // Remember uncertainty across reload: refresh may read status, never resubmit a call.
  sessionStorage.setItem(pendingKey,'1');blockedAfterSubmit=true;
  await api('/missions/'+id+'/start','POST',{approvalToken:grant.approvalToken,acknowledged:true},{'idempotency-key':grant.key});
  show('開始要求を受け付けました。接続・会話の完了はまだ確認していません。');
  reset();
 }catch(e){show((blockedAfterSubmit?'開始要求の結果が不明または拒否されました。再発信せず状態を確認してください。 ':'')+e.message);}
 finally{submitting=false;}
});
$('refresh').addEventListener('click',()=>void refresh());
void refresh();
