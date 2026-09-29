// Local carrier protocol fixtures are limited to the dial/notice/media authorization boundary.
// No external call or AI request is sent; actual HTTP, WebSocket, signatures and PhoneSession are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {Store} from '../lib/store.mjs';
import {Phone,PhoneSession,RECORDING_NOTICE} from '../lib/phone.mjs';
import * as voice from '../../../packages/voice/dist/index.js';
const require=createRequire(new URL('../../../providers/phone-twilio/package.json',import.meta.url)),{WebSocket}=require('ws');
const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('condition not reached')};

async function fixture(fn){
 const store=new Store(':memory:',randomBytes(32).toString('hex'));
 const env={TWILIO_ACCOUNT_SID:'AC'+randomBytes(16).toString('hex'),TWILIO_AUTH_TOKEN:randomBytes(32).toString('hex')};
 const config={publicUrl:'https://gateway.test',callerId:'+15005550006'};
 const sid='CA'+randomBytes(16).toString('hex'),stream='MZ'+randomBytes(16).toString('hex'),requests=[],events=[],sockets=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,params:Object.fromEntries(new URLSearchParams(body))});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({sid,status:req.url.includes(sid)?'completed':'queued'}));});
 const phone=new Phone({store,config},env);await phone.attach(server);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 // Restrict the external REST endpoint to this local protocol fixture.
 phone.callURL=(id='')=>base+'/Calls'+(id?'/'+id:'')+'.json';
 const m={id:randomUUID(),owner:'local',team:'local',target:{phone:'+15005550006'},kind:'phone-request',maxSeconds:60};store.put('mission',m);
 const session=new PhoneSession(phone,m,{signal:new AbortController().signal,onEvent:e=>events.push(e)},voice);
 const signature=path=>createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(config.publicUrl+path).digest('base64');
 const connect=(path=session.path,sig=signature(path))=>new Promise((resolve,reject)=>{
  const ws=new WebSocket(base.replace(/^http:/,'ws:')+path,{headers:{'x-twilio-signature':sig}});sockets.push(ws);
  ws.once('open',()=>resolve(ws));ws.once('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode)});ws.once('error',reject);
 });
 const start=(socket,overrides={})=>socket.send(JSON.stringify({event:'start',streamSid:stream,start:{streamSid:stream,callSid:sid,accountSid:env.TWILIO_ACCOUNT_SID,mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000,channels:1},...overrides}}));
 try{await session.dial();await fn({session,phone,requests,events,connect,start,sid,stream,env});}
 finally{await session.hangup();for(const socket of sockets)socket.terminate();for(const socket of phone.wss.clients)socket.terminate();await new Promise(r=>phone.wss.close(r));await new Promise(r=>server.close(r));store.close();}
}

test('one recording notice is followed immediately by a stream without asking for digits',()=>fixture(async f=>{
 const params=f.requests[0].params;
 assert.equal(params.Twiml,`<Response><Say language="ja-JP" voice="Polly.Kazuha-Neural">${RECORDING_NOTICE}</Say><Connect><Stream url="wss://gateway.test${f.session.path}"/></Connect><Hangup/></Response>`);
 assert.equal(RECORDING_NOTICE,'この通話は記録されています。');assert.equal(params.Record,'false');assert.equal(params.TimeLimit,'60');assert.ok(!params.Twiml.includes('Gather'));
 assert.equal(f.events.some(e=>e.type==='recording.notice'),false);
 const socket=await f.connect();f.start(socket);
 const event=await f.session.events[Symbol.asyncIterator]().next();assert.equal(event.value.type,'connected');
 assert.deepEqual(f.events.filter(e=>e.type==='recording.notice'),[{type:'recording.notice',method:'twiml-say',text:RECORDING_NOTICE}]);
 assert.equal(f.session.consent,false);assert.equal(f.events.some(e=>e.type==='callee.consent'),false);
 socket.send(JSON.stringify({event:'dtmf',streamSid:f.stream,dtmf:{track:'inbound_track',digit:'2'}}));
 await wait(()=>f.events.some(e=>e.type==='contact.opt_out'));await f.session.hangup();
 assert.equal(f.requests.filter(r=>r.path.includes(f.sid)).length,1);
}));

test('automatic media still rejects forged signatures, unknown sessions and a duplicate socket',()=>fixture(async f=>{
 assert.equal(await f.connect(f.session.path,'forged'),401);
 assert.equal(await f.connect('/media/not-an-active-session'),401);
 const socket=await f.connect();f.start(socket);await wait(()=>f.events.some(e=>e.type==='recording.notice'));
 assert.equal(await f.connect(),401);
}));

for(const kind of ['call','account','format','stream'])test(`automatic media rejects a mismatched ${kind} before recording a notice`,()=>fixture(async f=>{
 const socket=await f.connect(),closed=new Promise(r=>socket.once('close',r));
 f.start(socket,kind==='call'?{callSid:'CA'+randomBytes(16).toString('hex')}:kind==='account'?{accountSid:'AC'+randomBytes(16).toString('hex')}:kind==='stream'?{streamSid:''}:{mediaFormat:{encoding:'audio/pcm',sampleRate:24000,channels:1}});
 assert.equal(await closed,1008);assert.equal(f.events.some(e=>e.type==='recording.notice'||e.type==='callee.consent'),false);
}));

// An incoming call: the caller is already on the line when the session starts, so nothing may be dialled and the
// stream must be accepted only under the token that was placed in the answering TwiML, for that call and account.
test('an incoming call is carried by the same authenticated stream, without any dial request',async()=>{
 const store=new Store(':memory:',randomBytes(32).toString('hex')),env={TWILIO_ACCOUNT_SID:'AC'+randomBytes(16).toString('hex'),TWILIO_AUTH_TOKEN:randomBytes(32).toString('hex')},config={publicUrl:'https://gateway.test',callerId:'+15005550006'};
 const sid='CA'+randomBytes(16).toString('hex'),stream='MZ'+randomBytes(16).toString('hex'),token=randomBytes(24).toString('base64url'),requests=[],events=[],sockets=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,params:Object.fromEntries(new URLSearchParams(body))});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({sid,status:'completed'}));});
 const phone=new Phone({store,config},env);await phone.attach(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;phone.callURL=(id='')=>base+'/Calls'+(id?'/'+id:'')+'.json';
 const m={id:randomUUID(),owner:'local',team:'local',target:{phone:'+15005550006'},kind:'phone-request',direction:'inbound',inbound:{callSid:sid,token,ownerName:'local'},maxSeconds:60};store.put('mission',m);
 const session=new PhoneSession(phone,m,{signal:new AbortController().signal,onEvent:e=>events.push(e)},voice);
 const open=(path,signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(config.publicUrl+path).digest('base64'))=>new Promise((resolve,reject)=>{const ws=new WebSocket(base.replace(/^http:/,'ws:')+path,{headers:{'x-twilio-signature':signature}});sockets.push(ws);ws.once('open',()=>resolve(ws));ws.once('unexpected-response',(_q,res)=>{res.resume();resolve(res.statusCode)});ws.once('error',reject);});
 try{
  // Before the worker has taken the call there is no session: the stream is refused rather than left unattended.
  assert.equal(await open('/media/'+token),401);
  await session.dial();
  assert.equal(requests.length,0);assert.equal(session.path,'/media/'+token);assert.deepEqual(events,[{type:'carrier.sid',sid}]);
  assert.equal(await open('/media/'+token,'forged'),401);assert.equal(await open('/media/another-token'),401);
  const socket=await open('/media/'+token);
  socket.send(JSON.stringify({event:'start',streamSid:stream,start:{streamSid:stream,callSid:sid,accountSid:env.TWILIO_ACCOUNT_SID,mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000,channels:1}}}));
  const first=await session.events[Symbol.asyncIterator]().next();assert.equal(first.value.type,'connected');
  assert.deepEqual(events.filter(e=>e.type==='recording.notice'),[{type:'recording.notice',method:'twiml-say',text:RECORDING_NOTICE}]);
  // Hanging up an incoming call ends that call at the carrier; it is the only request this session ever makes.
  await session.hangup();assert.deepEqual(requests.map(r=>[r.path.includes(sid),r.params.Status]),[[true,'completed']]);
 }finally{await session.hangup();for(const socket of sockets)socket.terminate();for(const socket of phone.wss.clients)socket.terminate();await new Promise(r=>phone.wss.close(r));await new Promise(r=>server.close(r));store.close();}
});
