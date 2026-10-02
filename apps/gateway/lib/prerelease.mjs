import { assert } from './security.mjs';

function setting(env,key,fallback,min,max,{integer=false}={}) {
  const value=Number(env[key]??fallback);
  assert(Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isSafeInteger(value)),`invalid_${key}`,500);
  return value;
}

/** Release limits apply to every outbound entry point, including delegated/API calls. */
export function prereleaseConfiguration(env,limits) {
  const stage=env.OATHRA_RELEASE_STAGE??(env.OATHRA_PUBLIC_SIGNUP==='true'?'prerelease':'standard');
  assert(['standard','prerelease'].includes(stage),'invalid_release_stage',500);
  if(stage!=='prerelease')return {enabled:false};
  assert([undefined,'true','false'].includes(env.OATHRA_PRERELEASE_PAUSED),'invalid_prerelease_paused',500);
  const perAccount=setting(env,'OATHRA_PRERELEASE_DAILY_CALLS',3,0,500,{integer:true});
  const globalDailyUsd=setting(env,'OATHRA_PRERELEASE_GLOBAL_DAILY_USD',0,0,1000);
  return {
    enabled:true,paused:env.OATHRA_PRERELEASE_PAUSED!=='false',inboundEnabled:false,
    maxAccounts:setting(env,'OATHRA_PRERELEASE_MAX_ACCOUNTS',10,0,1000,{integer:true}),
    // Legacy daily limits use zero to mean unlimited; dedicated prerelease zero limits refuse calls.
    dailyCallsPerAccount:limits.dailyCalls===0?perAccount:Math.min(limits.dailyCalls,perAccount),
    globalDailyCalls:setting(env,'OATHRA_PRERELEASE_GLOBAL_DAILY_CALLS',20,0,10000,{integer:true}),
    maxCallSeconds:Math.min(limits.maxSeconds,setting(env,'OATHRA_PRERELEASE_MAX_SECONDS',180,30,600,{integer:true})),
    maxCallUsd:limits.maxCallUsd,dailyUsdPerAccount:limits.dailyUsd===0?globalDailyUsd:limits.dailyUsd,
    // An operator must explicitly allocate a shared cost budget before accepting any call.
    globalDailyUsd,
  };
}

export function signupLimitReason(store,config) {
  const p=config.prerelease;if(!p?.enabled)return null;
  if(p.paused)return 'prerelease_paused';
  const count=store.db.prepare('SELECT COUNT(*) AS n FROM public_users').get().n;
  return count>=p.maxAccounts?'prerelease_capacity_reached':null;
}

export function prereleaseCallsAvailable(config) {
  const p=config.prerelease;
  return !p?.enabled||(!p.paused&&p.dailyCallsPerAccount>0&&p.globalDailyCalls>0&&p.dailyUsdPerAccount>0&&p.globalDailyUsd>0);
}

/** Run inside the same transaction as approval/reservation, and again before worker execution. */
export function checkPrereleaseCall(store,config,mission) {
  const p=config.prerelease;if(!p?.enabled)return;
  assert(!p.paused,'prerelease_paused',503);
  assert(mission.direction!=='inbound','prerelease_inbound_disabled',403);
  assert(Number.isFinite(mission.maxSeconds)&&mission.maxSeconds>0&&mission.maxSeconds<=p.maxCallSeconds&&
    Number.isFinite(mission.maxUsd)&&mission.maxUsd>0&&mission.maxUsd<=p.maxCallUsd&&
    Number.isFinite(mission.estimatedMaximumUsd)&&mission.estimatedMaximumUsd>=0&&mission.estimatedMaximumUsd<=p.maxCallUsd,
  'prerelease_limits_changed_review_again',409);
  let globalCalls=0,ownerCalls=0,globalUsd=0,ownerUsd=0;
  const cutoff=store.now()-86400_000;
  // A UI page is limited to 1000 rows; a shared spending limit must inspect the whole ledger.
  for(const row of store.db.prepare("SELECT body FROM records WHERE kind='reservation'").iterate()) {
    const r=store.open(row.body);
    if(r.id===mission.id||r.approvedAt<=cutoff)continue;
    globalCalls++;globalUsd+=r.estimatedMaximumUsd;
    if(r.owner===mission.owner){ownerCalls++;ownerUsd+=r.estimatedMaximumUsd;}
  }
  assert(ownerCalls<p.dailyCallsPerAccount,'prerelease_call_limit',429);
  assert(globalCalls<p.globalDailyCalls,'prerelease_global_call_limit',429);
  assert(p.dailyUsdPerAccount>0&&ownerUsd+mission.estimatedMaximumUsd<=p.dailyUsdPerAccount+1e-9,'prerelease_budget_limit',429);
  assert(p.globalDailyUsd>0&&globalUsd+mission.estimatedMaximumUsd<=p.globalDailyUsd+1e-9,'prerelease_global_budget_limit',429);
}
