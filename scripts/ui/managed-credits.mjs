// Runs real local Gateway/SQLite/Chrome. No call worker, carrier or payment connection is started.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';
import {hash} from '../../apps/gateway/lib/security.mjs';
import {launch} from './cdp.mjs';
const dir=mkdtempSync(join(tmpdir(),'oathra-credit-ui-')),token=randomBytes(32).toString('hex'),user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)};
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
let page;const out=resolve('artifacts/quality/managed-credits');mkdirSync(out,{recursive:true});
try {
 const email=randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url'),code=new URL(app.service.passwords.issue(user.id).url).hash.slice(7);
 const setup=await fetch(base+'/v1/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({code,email,password})});assert.equal(setup.status,200);
 page=await launch({width:1280,height:900});await page.goto(base);await page.js("document.querySelector('#managed-email').focus()");await page.type(email);await page.press('Tab');await page.type(password);await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");
 assert.match(await page.text('#managed-credit-button'),/^0 クレジット/);
 const response=await fetch(base+'/v1/admin/credits/grants',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({owner:user.id,amount:6,reason:'ローカルの残高表示と保存の動作確認'})});assert.equal(response.status,200);
 await page.click('#managed-credit-button');await page.until("document.querySelector('#managed-credits').open");await page.click('#managed-credits-close');await page.until("document.querySelector('#managed-credit-button').textContent.startsWith('6 ')");await page.click('#managed-credit-button');await page.until("document.querySelector('#managed-credits').open");assert.match(await page.text('#managed-ledger'),/追加 6/);
 for(const [label,w,h] of [['desktop',1280,900],['mobile',390,844]]){await page.viewport(w,h);assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));}
 await page.js("document.querySelector('#managed-credits-close').focus()");await page.press('Enter');assert.equal(await page.js("document.querySelector('#managed-credits').open"),false);
 await page.click('#managed-account-button');await page.click('#managed-logout');await page.until("!document.querySelector('#managed-login').hidden");assert.ok(!await page.visible('#managed-credit-button'));assert.equal(app.store.list('mission').length,0);assert.deepEqual(page.pageErrors,[]);
 console.log('PASS: authenticated managed UI, zero balance, real idempotent grant HTTP, updated balance/ledger, desktop/mobile, keyboard close/logout, no calls or payment.');
}finally{await page?.close();await app.close();rmSync(dir,{recursive:true,force:true});}
