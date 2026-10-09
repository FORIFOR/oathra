/** Isolated preview of existing records; no worker, fabricated data or provider credentials. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, platform, release } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { backupDatabase } from '../../apps/gateway/backup.mjs';
import { configuration, createGateway } from '../../apps/gateway/server.mjs';
import { freePort, launch } from './cdp.mjs';

const {values}=parseArgs({options:{mode:{type:'string',default:'serve'},env:{type:'string'},url:{type:'string'},output:{type:'string',default:'docs/quality/evidence/2026-10-02-craft'},label:{type:'string',default:'before'},widths:{type:'string',default:'1440,390'}}});
const output=resolve(values.output);mkdirSync(output,{recursive:true,mode:0o700});
const save=(file,value)=>writeFileSync(join(output,file),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const digest=value=>createHash('sha256').update(value).digest('hex');

if(values.mode==='serve'){
  assert(values.env,'An existing private --env path is required.');
  const source=parseEnv(readFileSync(values.env,'utf8')),sourceConfig=configuration(source);
  const temporary=mkdtempSync(join(tmpdir(),'oathra-craft-'));
  let app,finished=false;
  const report={createdAt:new Date().toISOString(),node:process.version,os:platform()+' '+release(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workerStarted:false,providerCredentialsCopied:false,syntheticBusinessRecordsCreated:false,originalDatabaseWritten:false};
  try{
    await backupDatabase(sourceConfig.dbPath,join(temporary,'backup'));
    const port=await freePort(),origin=`http://127.0.0.1:${port}`;
    const keys=['OATHRA_DATA_KEY','OATHRA_USERS_JSON','OATHRA_DEPLOYMENT','OATHRA_CREDITS_PER_CALL','OATHRA_CREDIT_POLICY','OATHRA_CREDIT_USD','OATHRA_LIVE_PRICES_JSON','OATHRA_CARRIER_JPY_PER_USD','OATHRA_CARRIER_FX_DATE','OATHRA_SETTLEMENT_MODE','OATHRA_USAGE_PRICES_JSON','OATHRA_VOICE_ENGINE','OATHRA_VOICE_MODEL'];
    const env=Object.fromEntries(keys.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
    Object.assign(env,{OATHRA_MODE:'simulator',OATHRA_PUBLIC_URL:origin,OATHRA_MCP_ENABLED:'true',OATHRA_PUBLIC_SIGNUP:'false',OATHRA_LOCAL_OPEN:'false',OATHRA_RELEASE_STAGE:'prerelease',OATHRA_PRERELEASE_PAUSED:'true',OATHRA_PRERELEASE_GLOBAL_DAILY_USD:'0',OATHRA_DB:join(temporary,'backup/gateway.sqlite'),PORT:String(port),HOST:'127.0.0.1'});
    const config=configuration(env);assert.equal(config.liveReady,false);assert.equal(config.localOpen,false);assert.equal(config.prerelease.paused,true);
    app=await createGateway(config,{env});
    const business=()=>app.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all().filter(row=>!row.kind.startsWith('mcp-')).map(row=>({kind:row.kind,id:row.id,body:app.store.open(row.body)}));
    report.before={rows:business().length,hash:digest(JSON.stringify(business()))};
    await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
    const publicMcp=await (await fetch(origin+'/v1/public/mcp')).json();
    Object.assign(report,{origin,mode:config.mode,localOpen:config.localOpen,liveReady:config.liveReady,prereleasePaused:config.prerelease.paused,registrationEnabled:false,mcpEnabled:publicMcp.enabled});
    save('preview.json',report);console.log(JSON.stringify({origin,workerStarted:false,liveReady:false,prereleasePaused:true,isolatedBackup:true}));
    const stop=async()=>{if(finished)return;finished=true;report.after={rows:business().length,hash:digest(JSON.stringify(business()))};report.businessRecordsUnchanged=report.before.hash===report.after.hash;await app.close();rmSync(temporary,{recursive:true,force:true});report.stoppedAt=new Date().toISOString();report.temporaryDatabaseRemoved=true;save('preview.json',report);process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }catch(error){if(app)await app.close();rmSync(temporary,{recursive:true,force:true});throw error;}
}else if(values.mode==='capture'){
  const origin=new URL(values.url);assert(['localhost','127.0.0.1'].includes(origin.hostname)&&origin.protocol==='http:','Only isolated loopback preview is permitted.');
  assert(/^[a-z0-9-]+$/.test(values.label),'Use a simple evidence label.');
  const widths=values.widths.split(',').map(Number);assert(widths.every(width=>Number.isInteger(width)&&width>=320&&width<=1920),'Unsupported viewport width.');
  const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const trackedDiffHash=digest(execFileSync('git',['diff','HEAD','--','apps/gateway','scripts/ui/quality-preview.mjs']));
  const sourcePaths=['apps/gateway/public/app/index.html','apps/gateway/public/app/app.js','apps/gateway/public/app/style.css','apps/gateway/public/phone/account.js','apps/gateway/public/phone/public-service.js','apps/gateway/public/phone/public-service.css','apps/gateway/public/managed-phone.css','apps/gateway/lib/phone-ui.mjs','apps/gateway/public/connect/index.html','apps/gateway/public/connect/connect.js','apps/gateway/public/connect/connect.css'];
  const sourceHashes=()=>Object.fromEntries(sourcePaths.map(path=>[path,digest(readFileSync(path))]));
  const report={capturedAt:new Date().toISOString(),node:process.version,origin:origin.origin,revision,trackedDiffHash,sourceHashes:sourceHashes(),method:'Unauthenticated real Chrome, no business-data mutation',views:[]};
  const page=await launch();
  try{
    for(const width of widths){
      await page.viewport(width,width===1440?900:844);
      for(const [name,path]of [['managed-root','/'],['app','/app/'],['connect','/connect']]){
        await page.goto(origin.origin+path);
        const snapshot=await page.js(`({title:document.title,headings:[...document.querySelectorAll('h1,h2,h3')].filter(n=>n.getBoundingClientRect().height>0).map(n=>n.textContent.trim()),controls:[...document.querySelectorAll('a,button,input,select,summary')].filter(n=>n.getBoundingClientRect().height>0).map(n=>({tag:n.tagName,id:n.id,text:(n.textContent||n.getAttribute('aria-label')||n.getAttribute('placeholder')||'').trim().slice(0,120),href:n.getAttribute('href'),type:n.getAttribute('type'),disabled:n.disabled??false,rect:{top:Math.round(n.getBoundingClientRect().top),height:Math.round(n.getBoundingClientRect().height)}}))})`);
        const image=join(output,`${values.label}-${name}-${width}.png`);await page.screenshot(image);
        report.views.push({name,path,width,height:width===1440?900:844,horizontalOverflow:!(await page.noSidewaysScroll()),snapshot,screenshot:image});
      }
    }
    report.runtimeExceptions=page.pageErrors.filter(e=>!e.startsWith('console.error:')).length;
    report.sourceUnchanged=JSON.stringify(report.sourceHashes)===JSON.stringify(sourceHashes());
    save(values.label+'-first-use.json',report);console.log(JSON.stringify({views:report.views.length,runtimeExceptions:report.runtimeExceptions,evidence:join(output,values.label+'-first-use.json')}));
  }finally{await page.close();}
}else throw new Error('Unknown preview mode.');
