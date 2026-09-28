import {describe,it,expect} from 'vitest';
import {PHONE_PURPOSE_TEMPLATES} from './phone-templates.js';
import {PhoneRequestFieldsSchema} from './phone-input.js';
describe('editable purpose templates',()=>{
 it('has unique bilingual starters within the request limit and blocks unresolved placeholders',()=>{
   expect(new Set(PHONE_PURPOSE_TEMPLATES.map(t=>t.id)).size).toBe(PHONE_PURPOSE_TEMPLATES.length);
   for(const template of PHONE_PURPOSE_TEMPLATES) for(const language of ['ja','en'] as const) {
     expect(template.title[language].length).toBeGreaterThan(0);
     expect(template.instruction[language].length).toBeLessThanOrEqual(2000);
     // Chat is ready to edit/use without requiring the caller to provide their own name.
     expect(PhoneRequestFieldsSchema.shape.instruction.safeParse(template.instruction[language]).success).toBe(template.id === 'chat');
   }
 });
 it('exposes a named chat template with explicit mode rather than inferring permissions from text',()=>{
   const chat=PHONE_PURPOSE_TEMPLATES.find(t=>t.id==='chat')!;
   expect(chat.title.ja).toBe('雑談');expect(chat.conversationMode).toBe('chat');
   expect(chat.instruction.ja).toContain('ニュース');
 });
 it('accepts a user-written purpose without substitution markup',()=>{
   expect(PhoneRequestFieldsSchema.shape.instruction.safeParse('電話の使い方について、説明を聞きたいと伝えてください。').success).toBe(true);
 });
  it('only the reservation template books, and only its contract may reserve',async()=>{
   const {definePhoneRequest,preparePhoneRequest}=await import('./index.js');
   expect(PHONE_PURPOSE_TEMPLATES.filter(t=>(t as {task?:string}).task==='reservation').map(t=>t.id)).toEqual(['reserve']);
   const base={phone:'+819012345678',name:'焼肉 たけ',instruction:'10月3日19時に2名で予約を取ってください。名前は田中です。'};
   const booking=definePhoneRequest(preparePhoneRequest({...base,task:'reservation'}));
   expect(booking.permissions).toMatchObject({ask:true,reserve:true});expect(booking.permissions.payment).toBeFalsy();
   expect(Object.keys(booking.require).sort()).toEqual(['confirmed','date','time']);expect(booking.confirmation).toBe('callee_acceptance');
   expect(String(booking.input.policy)).toContain('支払い');
   const ask=definePhoneRequest(preparePhoneRequest(base));
   expect(ask.permissions.reserve).toBeFalsy();expect(String(ask.input.policy)).toContain('予約・購入・支払い');
 });
});
