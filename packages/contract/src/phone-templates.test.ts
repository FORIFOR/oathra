import {describe,it,expect} from 'vitest';
import {PHONE_PURPOSE_TEMPLATES} from './phone-templates.js';
import {PhoneRequestSchema} from './phone-input.js';
describe('editable purpose templates',()=>{
 it('has unique bilingual starters within the request limit and blocks unresolved placeholders',()=>{
   expect(new Set(PHONE_PURPOSE_TEMPLATES.map(t=>t.id)).size).toBe(PHONE_PURPOSE_TEMPLATES.length);
   for(const template of PHONE_PURPOSE_TEMPLATES) for(const language of ['ja','en'] as const) {
     expect(template.title[language].length).toBeGreaterThan(0);
     expect(template.instruction[language].length).toBeLessThanOrEqual(2000);
     // Chat is ready to edit/use without requiring the caller to provide their own name.
     expect(PhoneRequestSchema.shape.instruction.safeParse(template.instruction[language]).success).toBe(template.id === 'chat');
   }
 });
 it('exposes a named chat template with explicit mode rather than inferring permissions from text',()=>{
   const chat=PHONE_PURPOSE_TEMPLATES.find(t=>t.id==='chat')!;
   expect(chat.title.ja).toBe('雑談');expect(chat.conversationMode).toBe('chat');
   expect(chat.instruction.ja).toContain('ニュース');
 });
 it('accepts a user-written purpose without substitution markup',()=>{
   expect(PhoneRequestSchema.shape.instruction.safeParse('電話の使い方について、説明を聞きたいと伝えてください。').success).toBe(true);
 });
});
