import { DemoSession, FLOWS, VENUES, MODELS, ORIGINAL_RESERVATION, type DemoKind, type DemoInput, type DemoScenario, type DemoSnapshot } from './use-case-model.js';

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const kindParam = new URLSearchParams(location.search).get('flow');
let demo = new DemoSession(kindParam === 'stock' || kindParam === 'modify' ? kindParam : 'restaurant');
const capture = new URLSearchParams(location.search).get('capture') === '1';
document.body.classList.toggle('capture', capture);
Object.assign(window, { demoSnapshot: () => demo.snapshot(), setDemoCaption: (text: string) => { $('#demo-caption').textContent = text; } });
if (capture) $('#demo-caption').textContent = '条件を決めてから、あなたが承認する。';
const summary = (rows: [string, string][]) => `<dl class="summary">${rows.map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
const timeOptions = (start: number, end: number, value: string) => Array.from({ length:(end-start+1)*2 }, (_,i) => `${String(start+Math.floor(i/2)).padStart(2,'0')}:${i%2 ? '30' : '00'}`).map(t => `<option${t===value?' selected':''}>${t}</option>`).join('');
const button = (id: string, text: string, klass='primary') => `<button type="button" data-action="${id}" data-testid="${id}" class="${klass}">${text}</button>`;
function transcript(s: DemoSnapshot) {
  return `<div class="transcript" aria-label="模擬通話の記録">${s.transcript.length ? s.transcript.map(t => `<div class="turn ${t.source}"><strong>${t.source==='caller'?'Oathra':t.source==='callee'?'架空の店員':'システム'}</strong><p>${esc(t.text)}</p></div>`).join('') : '<p class="empty">承認した条件で、模擬通話を始めます。<br>「次の応答へ」で相手との会話を進めてください。</p>'}</div>`;
}
function inputScreen(s: DemoSnapshot) {
  const i=s.input;
  const venues = `<div class="venue-options" role="group" aria-label="合成した近隣の検索結果">${VENUES.map(v=>`<label class="venue"><input type="radio" name="venueId" value="${v.id}"${i.venueId===v.id?' checked':''}><span><strong>${esc(v.name)}</strong><small>${esc(v.distance)}<br>${esc(v.number)} · 発信できない架空番号</small></span></label>`).join('')}</div>`;
  const restaurant = `${venues}<div class="fields"><label>予約する日<input data-testid="input-date" name="date" type="date" min="2026-10-11" max="2026-12-31" value="${i.date}" required></label><label>希望時刻<select data-testid="input-time" name="time">${timeOptions(17,21,i.time)}</select></label><label>人数<input data-testid="input-partySize" name="partySize" type="number" min="1" max="6" step="1" value="${i.partySize}" required></label><label>食事代の合計上限（円）<input data-testid="input-budget" name="budget" type="number" min="2000" max="20000" step="1" value="${i.budget}" required></label></div>`;
  const stock = `<div class="fields"><label class="wide">在庫を確認する型番<select name="model" data-testid="input-model">${MODELS.map(m=>`<option value="${m.id}"${m.id===i.model?' selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>商品価格の上限（円）<input data-testid="input-budget" name="budget" type="number" min="2000" max="20000" step="1" value="${i.budget}" required></label><label>受け取る日<input data-testid="input-date" name="date" type="date" min="2026-10-11" max="2026-12-31" value="${i.date}" required></label><label>受取期限<select name="pickupDeadline" data-testid="input-pickupDeadline">${timeOptions(10,20,i.pickupDeadline)}</select></label><div class="field">取り置き条件<p class="sub">費用 ¥0 · 購入義務なし<br>別の型番への変更は許可しない</p></div></div>`;
  const modify = `<div class="review-grid"><div class="review-block"><h3>現在の予約（デモ台帳）</h3><p><strong>11月20日 19:00 · 2名</strong><br>${esc(s.target.name)}<br>予約番号 ${ORIGINAL_RESERVATION.id}</p></div><div class="review-block"><h3>変更したい時刻</h3><p><strong>20:00</strong><br>日付・人数はそのまま<br>変更手数料 ¥0 の場合だけ</p></div><div class="review-block wide"><h3>変更できない場合</h3><p><strong>19:00の元予約を維持</strong><br>取消や別時間への変更は許可しません。</p></div></div>`;
  return `<h2 tabindex="-1">${s.kind==='restaurant'?'近隣の候補から、条件を決める。':s.kind==='stock'?'欲しい型番と、受取期限を。':'19時を20時へ。無理なら、そのまま。'}</h2><p class="sub">${s.kind==='restaurant'?'架空のまち・中央広場周辺の合成検索結果です。':s.kind==='stock'?'対象は合成した商品だけ。商品代の支払いも購入確約も行いません。':'架空の既存予約を使用します。個人情報の入力は不要です。'}</p><form id="conditions">${s.kind==='restaurant'?restaurant:s.kind==='stock'?stock:modify}${s.error?`<p class="error" role="alert">${esc(s.error)}</p>`:''}<div class="actions"><button type="submit" class="primary" data-testid="review">内容を確認する →</button></div></form>`;
}
function reviewScreen(s: DemoSnapshot) {
  const name=s.kind==='modify'?'デモ利用者・予約番号 DEMO-RSV-001':'デモ利用者（架空の名前）';
  const scope=s.kind==='restaurant'?`席の予約のみ。${s.input.date} ${s.input.time}、${s.input.partySize}名。食事代は合計${yen(s.input.budget)}以下。`:s.kind==='stock'?`${s.input.model}のみ。${yen(s.input.budget)}以下、${s.input.date} ${s.input.pickupDeadline}までの無料取り置き。`:`${s.input.date}・${s.input.partySize}名の同じ予約を19:00から20:00へ無料で変更。不可なら元予約を維持。`;
  return `<h2 tabindex="-1">この相手に、この範囲だけ。</h2><p class="sub">承認するまで模擬通話は始まりません。</p><div class="review-grid"><div class="review-block"><h3>電話先（架空）</h3><p><strong>${esc(s.target.name)}</strong><br>${esc(s.target.number)} · 発信できない架空番号</p></div><div class="review-block"><h3>開示する情報</h3><p>${name}<br>${s.kind==='stock'?'型番・価格上限・受取日時':'予約日時・人数・希望条件'}<br>住所・連絡先は開示しません。</p></div><div class="review-block"><h3>任せる範囲</h3><p>${esc(scope)}</p></div><div class="review-block"><h3>支払い・契約</h3><p><strong>費用 ¥0 · 購入義務なし</strong><br>支払い・有料条件・取消の許可はありません。</p></div></div><p class="approval-note">下のボタンで、表示中の条件に限ってシミュレーションを承認します。実際の電話・予約は行いません。</p><div class="actions">${button('approve','この条件で模擬通話を承認 →')}${button('back','戻って変更','secondary')}${button('cancel','取消','quiet')}</div>`;
}
function callingScreen(s: DemoSnapshot) {
  return `<div class="call-top"><div><h2 tabindex="-1">${esc(s.target.name)}と確認中</h2><p class="sub">合成した会話です。実際には電話していません。</p></div><span class="call-indicator">● 模擬通話<br>${s.step} / ${s.totalSteps}</span></div>${transcript(s)}<div class="actions">${button('next',s.step>=s.totalSteps?'結果を確認する →':'次の応答へ →')}${button('cancel','模擬通話を中止','secondary')}${button('back','戻る','quiet')}</div>`;
}
function resultScreen(s: DemoSnapshot) {
  const r=s.result!;const completed=r.status==='completed';
  const quote=[...s.transcript].reverse().find(t=>t.source==='callee');
  const visibleFields: [string,string][] = [];
  const labels:Record<string,string>={date:'日付',time:s.kind==='stock'?'受取期限':'時刻',partySize:'人数',price:'参考金額',serial:'型番'};
  for(const [key,label] of Object.entries(labels)){const v=r.fields[key];if(completed && v!==undefined) visibleFields.push([label,key==='price'?yen(Number(v)):key==='partySize'?`${v}名`:String(v)]);}
  return `<div data-testid="result" role="status"><span class="result-status ${completed?'complete':''}">${completed?'相手の発言から確認済み':'成立として報告しません'}</span><h2 tabindex="-1">${esc(r.title)}</h2><p class="result-detail">${esc(r.detail)}</p>${visibleFields.length?`<dl class="result-fields">${visibleFields.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`:''}${quote?`<blockquote class="evidence-quote"><small>最後に届いた相手の言葉（合成データ）</small>「${esc(quote.text)}」</blockquote>`:''}<p class="hint">通話が終わっただけでは成功になりません。相手の発言・必須項目・承認した条件を照合します。</p></div><details class="result-transcript"><summary>模擬通話の記録をすべて見る</summary>${transcript(s)}</details><div class="actions">${button('back','条件に戻って、もう一度','primary')}</div>`;
}
function render(focus=false) {
  const s=demo.snapshot();
  document.querySelectorAll<HTMLElement>('[data-flow]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.flow===s.kind)));
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(b=>{if(b.dataset.stage===s.stage)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
  $('#mission-title').textContent=FLOWS[s.kind].title;
  const rows:[string,string][]=[['相手',s.target.name],['宛先',`${s.target.number}（架空）`]];
  if(s.kind==='stock')rows.push(['型番',s.input.model],['受取期限',`${s.input.date} ${s.input.pickupDeadline}`],['価格上限',yen(s.input.budget)]);
  else rows.push(['日時',`${s.input.date} ${s.input.time}`],['人数',`${s.input.partySize}名`],s.kind==='modify'?['元の予約','19:00 · DEMO-RSV-001']:['合計上限',yen(s.input.budget)]);
  $('#mission-summary').innerHTML=summary(rows);
  $('#boundary-copy').textContent=s.kind==='modify'?'変更は20時だけ。変更不可・要確認なら、デモ台帳の元予約を残します。':s.kind==='stock'?'型番・価格・受取期限を守り、費用も購入義務も発生しない取り置きだけ。':'予算・日時・人数の範囲を超えた条件は、受け入れません。';
  const scenario=$<HTMLSelectElement>('#scenario');scenario.value=s.scenario;scenario.disabled=s.stage==='calling';
  $('#screen').innerHTML=s.stage==='input'?inputScreen(s):s.stage==='review'?reviewScreen(s):s.stage==='calling'?callingScreen(s):resultScreen(s);
  if(s.stage==='calling'){const log=$<HTMLElement>('.transcript');log.scrollTop=log.scrollHeight;}
  if(focus){const heading=$<HTMLElement>('#screen h2');heading.focus({preventScroll:true});if(innerWidth<=760)heading.scrollIntoView({block:'nearest'});}
}
function syncInputs(){
  const form=$<HTMLFormElement>('#conditions');if(!form)return;
  const patch:Partial<DemoInput>={};
  for(const [key,value] of new FormData(form)){if(key==='partySize'||key==='budget')patch[key]=Number(value);else if(['venueId','date','time','model','pickupDeadline'].includes(key))(patch as Record<string,unknown>)[key]=String(value);}
  demo.update(patch);
}
$('#screen').addEventListener('submit',event=>{event.preventDefault();syncInputs();demo.review();render(true);});
$('#screen').addEventListener('change',event=>{if((event.target as HTMLElement).closest('#conditions')){syncInputs();const s=demo.snapshot();$('#mission-summary').innerHTML=summary([['相手',s.target.name],['宛先',`${s.target.number}（架空）`],...(s.kind==='stock'? [['型番',s.input.model],['受取期限',`${s.input.date} ${s.input.pickupDeadline}`],['価格上限',yen(s.input.budget)]] : [['日時',`${s.input.date} ${s.input.time}`],['人数',`${s.input.partySize}名`],['合計上限',yen(s.input.budget)]]) ] as [string,string][]);}});
let nextAt=0;
$('#screen').addEventListener('click',event=>{
  const b=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');if(!b)return;
  const action=b.dataset.action;
  if(action==='next'){if(performance.now()-nextAt<350)return;nextAt=performance.now();demo.next(demo.snapshot().step);}
  else if(action==='approve')demo.approve();
  else if(action==='cancel')demo.cancel();
  else if(action==='back')demo.back();
  render(action!=='next'||demo.stage==='result');
  if(action==='next'&&demo.stage==='calling')$<HTMLButtonElement>('[data-testid="next"]').focus({preventScroll:true});
});
$('#scenario').addEventListener('change',()=>{if(demo.stage==='result')demo.back();demo.setScenario($<HTMLSelectElement>('#scenario').value as DemoScenario);render(true);});
document.querySelectorAll<HTMLButtonElement>('[data-flow]').forEach(b=>b.addEventListener('click',()=>{demo.cancel();demo=new DemoSession(b.dataset.flow as DemoKind);const u=new URL(location.href);u.searchParams.set('flow',demo.snapshot().kind);history.replaceState(null,'',u);render(true);}));
render();
