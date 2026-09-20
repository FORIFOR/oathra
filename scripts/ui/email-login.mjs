// Real HTTP, SQLite and Chrome. Temporary random identities are solely for core auth verification and removed on exit.
import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';import {hash} from '../../apps/gateway/lib/security.mjs';import {launch} from './cdp.mjs';
const dir=mkdtempSync(join(tmpdir(),'oathra-email-ui-')),token=randomBytes(32).toString('hex'),email=randomUUID()+'@example.invalid',password=randomBytes(4).toString('hex');
const user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)};
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
let app=await createGateway(config,{env:{}}),page;await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
const out=resolve(process.env.OATHRA_UI_EVIDENCE_DIR??'artifacts/quality/email-login');mkdirSync(out,{recursive:true});
async function fill(selector,value){await page.js(`document.querySelector(${JSON.stringify(selector)}).value='';document.querySelector(${JSON.stringify(selector)}).focus()`);await page.type(value)}
async function submit(emailValue,passwordValue){await fill('#managed-email',emailValue);await page.press('Tab');assert.equal((await page.focused()).id,'managed-password');await page.type(passwordValue);await page.press('Enter')}
async function logout(){await page.click('#managed-logout');await page.until("!document.querySelector('#managed-login').hidden");}
try{
 // Existing data is created through the same service used by the API; no call execution.
 const contact=app.service.contact(user,{company:'Oathra'});app.service.credits.grant(user,user.id,6,randomUUID(),'Local auth preservation verification');
 const link=app.service.passwords.issue(user.id).url;
 page=await launch({width:1280,height:900});await page.goto(link);assert.equal(await page.js('location.hash'),'');assert.equal(await page.js("document.querySelector('#managed-token')"),null);
 assert.equal(await page.text('#managed-login-title'),'ログイン方法を設定');assert.match(await page.text('#managed-password-help'),/^8文字以上/);await page.screenshot(join(out,'setup.png'));
 await submit(email,password.slice(0,7));await page.until("document.querySelector('#managed-login-error').textContent.includes('8〜128')");assert.equal(app.service.passwords.get(user.id),null);
 await fill('#managed-password',password);await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");
 assert.equal(await page.js('document.cookie'),'');assert.match(await page.text('#managed-credit-button'),/^6 /);assert.equal(app.store.list('contact',user.id)[0].id,contact.id);
 await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");await logout();
 for(const [label,w,h]of [['login',1280,900],['login-mobile',390,844]]){await page.viewport(w,h);await page.until("getComputedStyle(document.querySelector('#managed-login')).opacity==='1'");assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));}
 await submit(email,'wrong');await page.until("document.querySelector('#managed-login-error').textContent.includes('違います')");await page.screenshot(join(out,'invalid-login.png'));
 await fill('#managed-password',password);await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");
 await page.click('#managed-account-button');await page.until("document.querySelector('#managed-account').open");assert.equal(await page.text('#managed-account-email'),email);assert.match(await page.text('#managed-new-password-help'),/^8文字以上/);
 await fill('#managed-current-password',password);await fill('#managed-new-password',password+'改');await page.press('Enter');await page.until("document.querySelector('#managed-account-status').textContent.includes('変更しました')");
 assert.equal(await page.js("document.querySelector('#managed-new-password').value"),'');assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,'password-changed-mobile.png'));
 await page.press('Escape');assert.equal(await page.js("document.querySelector('#managed-account').open"),false);
 await logout();await submit(email,password);await page.until("document.querySelector('#managed-login-error').textContent.includes('違います')");
 await fill('#managed-password',password+'改');await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");
 await page.goto(link);await submit(email,password+'改');await page.until("document.querySelector('#managed-login-error').textContent.includes('使用済み')");await page.click('#managed-login-back');assert.equal(await page.text('#managed-login-title'),'ログイン');
 const resetLink=app.service.passwords.issue(user.id,{reset:true}).url;await page.goto(resetLink);await submit(email,password+'再設定');await page.until("!document.querySelector('#screen-real').hidden");
 assert.equal(app.service.credits.balance(user.id).available,6);assert.equal(app.store.list('contact',user.id)[0].id,contact.id);assert.equal(app.store.list('mission').length,0);
 await logout();await page.viewport(1280,900);await page.js("document.documentElement.style.zoom='2'");await page.emulateReducedMotion();assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,'login-zoom-200.png'));assert.deepEqual(page.pageErrors,[]);
 await page.close();page=null;await app.close();app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
 const r=await fetch(base+'/v1/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email,password:password+'再設定'})});assert.equal(r.status,200);assert.equal(app.service.credits.balance(user.id).available,6);
 console.log('PASS: real email setup with 8-character password, 8-character help for setup/change, fragment removal, 7-character password rejection and recovery, keyboard login, HttpOnly reload, generic wrong-password error, password change/old rejection, single-use link, reset, restart, credits/contact owner preservation, mobile/200%/reduced motion; no calls or email. Japanese text insertion is not native OS IME verification.');
}finally{await page?.close();await app.close();rmSync(dir,{recursive:true,force:true})}
