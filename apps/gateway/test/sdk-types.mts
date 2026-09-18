import { defineChannel, type ChannelEvent } from '../../../sdk/channel-sdk/index.mjs';
import { defineCapability, defineCallCapability } from '../../../sdk/capability-sdk/index.mjs';
const events: ChannelEvent[]=[{eventId:'e',actor:'a',destination:'d',type:'message',text:'draft only'}];
defineChannel({verify:()=>false,decode:()=>({events}),send:async()=>({status:'accepted'})});
defineCapability({preview:()=>({body:'review me'}),execute:async(action,ctx)=>{
  // @ts-expect-error The reviewed payload cannot be changed by a capability.
  action.details.recipient='elsewhere';
  ctx.signal.throwIfAborted();return {id:'provider-receipt'};
}});
defineCallCapability({execute:async(m,h)=>{h.signal.throwIfAborted();return {result:{providerReference:m.id}};}});
// @ts-expect-error Missing send implementation must fail at compile time too.
defineChannel({verify:()=>false,decode:()=>({events})});
// @ts-expect-error Unsupported inbound event types cannot grant approval.
const invalid: ChannelEvent={eventId:'e',actor:'a',destination:'d',type:'grant-approval'};
void invalid;
