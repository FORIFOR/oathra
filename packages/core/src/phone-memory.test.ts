// Bounded deterministic conversation fixtures; no external calls or persistent data.
import {it,expect} from 'vitest';
import {preparePhoneRequest} from '@oathra/contract';
import {phoneMemory} from './phone-memory.js';
const request=preparePhoneRequest({phone:'+819000000000',name:'条件確認',instruction:'2026年9月25日の19時に2名の空席を確認してください。予約はしないでください。'});
const now=Date.parse('2026-09-20T03:00:00Z');
const turn=(source:'caller'|'callee',text:string,t:number)=>({id:'t'+t,source,text,t});
it('keeps requested conditions separate from what was actually said',()=>{
 const m=phoneMemory(request,[],now);expect(m.notes.find(n=>n.field==='time')).toMatchObject({requested:'19:00',status:'missing'});expect(m.notes.find(n=>n.field==='partySize')).toMatchObject({requested:2,status:'missing'});expect(m.originalRequest).toBe(request.instruction);expect(m.bookingStatus).toBe('not_authorized');
});
it('preserves a changed offer and evidence without reusing the old settled time',()=>{
 const turns=[turn('callee','19時半でしたら空いております。',1),turn('caller','では、19時半でお願いします。',2)];
 expect(phoneMemory(request,turns,now).notes.find(n=>n.field==='time')).toMatchObject({value:'19:30',status:'verified'});
 turns.push(turn('callee','かしこまりました。19時でご予約承りました。',3));
 const m=phoneMemory(request,turns,now);expect(m.notes.find(n=>n.field==='time')).toMatchObject({value:'19:00',status:'proposed',source:'callee'});expect(m.notes.find(n=>n.field==='confirmed')?.status).not.toBe('verified');expect(m.history.some(n=>n.value==='19:30')).toBe(true);expect(m.bookingStatus).toBe('not_authorized');
});
it('caller-only completion and hedged replies never become a booking',()=>{
 const m=phoneMemory(request,[turn('caller','予約できました。',1),turn('callee','たぶん大丈夫です。ご予約承れると思います。',2)],now);
 expect(m.notes.find(n=>n.field==='confirmed')?.status).not.toBe('verified');expect(m.bookingStatus).toBe('not_authorized');
});

it('does not accept a proposal using an interrupted readback',()=>{
 const m=phoneMemory(request,[turn('callee','19時半でしたら空いております。',1),{...turn('caller','では、19時半でお願いします。',2),interrupted:true}],now);
 expect(m.notes.find(n=>n.field==='time')).toMatchObject({value:'19:30',status:'proposed'});
});

it('anchors Japanese relative dates to the approval day in Tokyo across year boundaries',()=>{
 const input={...request,instruction:'明日の19時に2名の空席を確認'};
 expect(phoneMemory(input,[],Date.parse('2026-12-31T15:30:00Z')).notes.find(n=>n.field==='date')?.requested).toBe('2027-01-02');
});
