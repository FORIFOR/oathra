// Controlled usage events cover the accounting protocol, without provider calls or conversation data.
import {it,expect} from 'vitest';
import {RealtimeUsage,type RealtimeUsageEvent} from './usage.js';
it('reports cancelled/failed usage and strips non-accounting fields',()=>{
 const events:RealtimeUsageEvent[]=[],meter=new RealtimeUsage('gpt-realtime-1.5',e=>events.push(e));meter.start();
 for(const status of ['completed','cancelled','failed']){
  meter.message({type:'response.created',response:{id:status}});
  meter.message({type:'response.done',response:{id:status,status,usage:{input_tokens:1,output_tokens:0,input_token_details:{text_tokens:1,audio_tokens:0,cached_tokens:0},output_token_details:{text_tokens:0,audio_tokens:0},privateText:'must not persist'},output:[{text:'must not persist'}]}});
 }
 meter.close(true);expect(events.filter(e=>e.kind==='response')).toHaveLength(3);expect(events.at(-1)?.complete).toBe(true);expect(JSON.stringify(events)).not.toContain('must not persist');
});
it('missing response completion and a disconnected session cannot claim complete usage',()=>{
 const events:RealtimeUsageEvent[]=[],meter=new RealtimeUsage('gpt-realtime-1.5',e=>events.push(e));meter.start();meter.message({type:'response.created',response:{id:'pending'}});meter.close(true);expect(events.at(-1)?.complete).toBe(false);
 meter.message({type:'response.done',response:{id:'pending',usage:{}}});meter.close(false);meter.close(true);expect(events.at(-1)?.complete).toBe(false);
});
