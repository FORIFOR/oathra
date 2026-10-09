// Read-only launch diagnostics. Never sends email, creates a Checkout Session, grants credit or calls a phone.
import { configuration } from './server.mjs';
import { Store } from './lib/store.mjs';
import { Service } from './lib/service.mjs';
import { PublicAccounts } from './lib/public-accounts.mjs';
import { Purchases, STRIPE_API_VERSION } from './lib/purchases.mjs';

const online=process.argv.includes('--online'),checks=[];
const add=(id,ok,detail)=>checks.push({id,status:ok?'PASS':'BLOCKED',detail});
const present=key=>typeof process.env[key]==='string'&&process.env[key].trim().length>0;
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
async function get(url,headers={}) {
  const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(10_000)});
  if(!response.ok){await response.body?.cancel();throw new Error('http_'+response.status);}
  return response;
}
let store;
try {
  const config=configuration();
  // Only the schema is initialised in memory. No customer, price, mail or call record is fabricated.
  store=new Store(':memory:',config.dataKey);
  const service=new Service(store,config),accounts=new PublicAccounts(service,process.env),purchases=new Purchases(service,process.env);
  add('managed',config.deployment==='managed','OATHRA_DEPLOYMENT=managed');
  add('live_configuration',config.mode==='live'&&config.liveReady,'Required phone settings present; this is not a live-call test.');
  add('fixed_https_origin',https(config.publicUrl)&&!/(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io))(?::\d+)?$/.test(new URL(config.publicUrl).host),'Use an operator-owned fixed HTTPS origin and an always-on server.');
  add('durable_database',config.dbPath!==':memory:'&&present('OATHRA_DATA_KEY'),'Preserve the database volume and its encryption key together.');
  add('administrator',config.users.some(u=>u.role==='admin'),'At least one configured administrator is required for support and reconciliation.');
  if(config.prerelease?.enabled){
    const p=config.prerelease;
    add('prerelease_admission',!p.paused&&p.maxAccounts>0,`Restricted prerelease: at most ${p.maxAccounts} public accounts; paused=${p.paused}.`);
    add('prerelease_call_budget',p.globalDailyUsd>0&&p.dailyUsdPerAccount>0&&p.dailyCallsPerAccount>0&&p.globalDailyCalls>0,'Requires an explicit shared rolling-24-hour budget. Zero refuses calls; inbound is disabled.');
  }
  add('registration',accounts.status().signupEnabled,'OATHRA_PUBLIC_SIGNUP, RESEND_API_KEY, OATHRA_MAIL_FROM, HTTPS origin, terms/privacy URLs and terms version.');
  add('password_recovery',accounts.status().passwordResetEnabled,'Email-verified public accounts can recover access; legacy operator setup remains supported.');
  add('commercial_policies',['OATHRA_COMMERCE_URL','OATHRA_SUPPORT_URL'].every(k=>https(process.env[k])),'Publish the actual operator, price/credit terms, refund handling and support details at these URLs.');
  add('payment_configuration',['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OATHRA_CREDIT_PACKS_JSON'].every(present),'Configure real Stripe prices and the /webhooks/stripe endpoint; no prices are invented.');
  const purchaseAdmissionReason=purchases.unavailableReason();
  add('purchase_admission',!purchaseAdmissionReason,purchaseAdmissionReason??'Configuration permits purchase admission; actual Stripe price verification is a separate check.');
  if(online) {
    try { const inspection=await purchases.inspectPrices({refresh:true});add('stripe_prices',inspection.verified,inspection.verified?`${inspection.packs.length} configured packs verified with Stripe; purchase admission is unchanged.`:inspection.reason??'unavailable'); }
    catch{add('stripe_prices',false,'Price lookup unavailable; not treated as zero.');}
    if(present('STRIPE_SECRET_KEY')) {
      try {const account=await (await get('https://api.stripe.com/v1/account',{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Stripe-Version':STRIPE_API_VERSION})).json();add('stripe_account',account.charges_enabled===true&&account.payouts_enabled===true,'Read actual account charge/payout eligibility.');}
      catch{add('stripe_account',false,'Account eligibility could not be read. Check the Dashboard without broadening API-key permissions just for this check.');}
    } else add('stripe_account',false,'Stripe secret key is not configured.');
    if(present('RESEND_API_KEY')&&present('OATHRA_MAIL_FROM')) {
      try {
        const domain=process.env.OATHRA_MAIL_FROM.trim().split('@').at(-1).toLowerCase();
        let found=false,after='';
        for(let page=0;page<20;page++) {
          const data=await (await get('https://api.resend.com/domains?limit=100'+(after?'&after='+encodeURIComponent(after):''),{Authorization:'Bearer '+process.env.RESEND_API_KEY})).json();
          found=data.data?.some(d=>d.name===domain&&d.status==='verified')??false;
          if(found||!data.has_more)break;
          after=data.data?.at(-1)?.id;if(!after)break;
        }
        add('sender_domain',found,'Read sender-domain verification; actual mail delivery still requires a consenting recipient.');
      } catch {add('sender_domain',false,'Domain verification is unknown (a send-only API key may not allow this read). Do not broaden permissions just for this check.');}
    } else add('sender_domain',false,'Resend key or sender address is not configured.');
    for(const [id,url] of [['public_health',config.publicUrl+'/healthz'],['worker_readiness',config.publicUrl+'/readyz'],...['TERMS','PRIVACY','COMMERCE','SUPPORT'].map(k=>['policy_'+k.toLowerCase(),process.env['OATHRA_'+k+'_URL']])]) {
      if(!https(url)){add(id,false,'HTTPS URL is not configured.');continue;}
      try {const response=await get(url);const value=id==='worker_readiness'?await response.json():null;if(!value)await response.body?.cancel();add(id,id==='worker_readiness'?value.ready===true:true,'Current HTTPS read completed; external acceptance is a separate check.');}
      catch{add(id,false,'HTTPS read unavailable or redirect requires correcting the configured URL.');}
    }
  }
}catch(error){add('configuration',false,error.code??'invalid_service_configuration');}
finally{store?.close();}
console.log(JSON.stringify({capturedAt:new Date().toISOString(),mode:online?'read-only-online':'local-configuration',checks,automaticChecksPassed:checks.every(c=>c.status==='PASS'),
  notVerified:['Actual confirmation email received and one-time registration completed','Actual paid Checkout, signed webhook and one credit-ledger grant','Password recovery, restart, backup restoration and customer isolation','Consented phone call with observed usage settlement','Availability over time and operational support']},null,2));
if(checks.some(c=>c.status!=='PASS'))process.exitCode=2;
