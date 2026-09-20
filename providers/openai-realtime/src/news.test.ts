// Bounded protocol fixtures reproduce missing citations, duplicate delivery and cancellation.
// No provider credentials/phone calls. Temporary sockets and callbacks are disposed after each test.
import { expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall, PhoneRequestSchema } from "@oathra/contract";
import { OpenAIRealtimeAgent } from "./index.js";
import { OpenAILiveAgent } from "./live.js";
import { createNewsSearch, parseNewsResponse, type NewsSearch, type NewsLookupEvent } from "./news.js";

const date = "2026-09-20T00:00:00Z";
const raw = () => ({ status: "completed", output: [
  { type: "web_search_call", status: "completed" },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "報道日: 2026-09-19。出典の確認をテストします。", annotations: [{ type: "url_citation", title: "Protocol fixture", url: "https://example.invalid/reports/2026-09-19" }] }] },
] });
it("accepts only completed search with a recent publication date and a safe article citation", () => {
  expect(parseNewsResponse(raw(), "science", date)).toMatchObject({ status: "verified", publishedOn: "2026-09-19", sources: [{url:"https://example.invalid/reports/2026-09-19",title:"Protocol fixture"}] });
  const cases: any[] = [null, {}, { ...raw(), status: "incomplete" }, { ...raw(), output: raw().output.slice(1) }];
  for (const [field,value] of [["text","No publication date"],["text","報道日: 2026-02-30"],["text","報道日: 2026-09-01"],["text","報道日: 2026-09-22"],["annotations",[]]] as const) {
    const response:any=raw();response.output[1].content[0][field]=value;cases.push(response);
  }
  for(const url of ["javascript:alert(1)","https://example.invalid/","https://user:pass@example.invalid/reports/2026-09-19"]) {
    const response:any=raw();response.output[1].content[0].annotations[0].url=url;cases.push(response);
  }
  for (const response of cases) expect(parseNewsResponse(response,"science",date).status).toBe("unavailable");
});
it("does not open a request after cancellation, and validates the category before networking", async()=>{
  const search=createNewsSearch({apiKey:"local-unused"});const c=new AbortController();c.abort();
  expect(await search("science",c.signal)).toMatchObject({status:"unavailable",reason:"cancelled"});
  await expect(search("private free text" as any,c.signal)).rejects.toThrow("invalid_news_topic");
});
it("bounds a stalled provider request and returns an unavailable result without retrying errors",async()=>{
  // This one temporary HTTP boundary fixture makes timeout/error recovery reproducible.
  const intercepted=vi.spyOn(globalThis,"fetch");
  try {
    intercepted.mockImplementation(async(_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener("abort",()=>reject(Error("aborted")),{once:true})));
    expect(await createNewsSearch({apiKey:"local-unused",timeoutMs:25})("science",new AbortController().signal)).toMatchObject({status:"unavailable",reason:"timeout"});
    expect(intercepted).toHaveBeenCalledTimes(1);
    const body=JSON.parse(String(intercepted.mock.calls[0]![1]!.body));
    expect(body.store).toBe(false);expect(body.max_tool_calls).toBe(1);expect(body.tool_choice).toBe("required");
    intercepted.mockClear();intercepted.mockResolvedValue(new Response("",{status:429}));
    expect(await createNewsSearch({apiKey:"local-unused"})("general",new AbortController().signal)).toMatchObject({status:"unavailable",reason:"provider_error"});
    expect(intercepted).toHaveBeenCalledTimes(1);
  } finally {intercepted.mockRestore()}
});
it('reports real provider quantities even when the news result cannot be verified, without leaking response text',async()=>{
 const intercepted=vi.spyOn(globalThis,'fetch'),events:unknown[]=[];
 try{
  intercepted.mockResolvedValue(new Response(JSON.stringify({status:'incomplete',usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200}},output:[{type:'web_search_call',status:'completed'}]})));
  const result=await createNewsSearch({apiKey:'local-unused',onUsage:e=>events.push(e)})('general',new AbortController().signal);
  expect(result.status).toBe('unavailable');expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({kind:'response',model:'gpt-5.4-mini',calls:1,usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200}}});
  expect(Object.keys(events[1] as object).sort()).toEqual(['calls','id','kind','model','usage']);
  events.length=0;intercepted.mockResolvedValue(new Response('',{status:429}));
  await createNewsSearch({apiKey:'local-unused',onUsage:e=>events.push(e)})('general',new AbortController().signal);
  expect(events).toHaveLength(2);expect(events[1]).toMatchObject({kind:'unavailable'});expect(events[1]).not.toHaveProperty('usage');
 }finally{intercepted.mockRestore()}
});
it("only explicit chat enables conversation and grounded news; legacy and unsupported connections stay honest",()=>{
  expect(PhoneRequestSchema.shape.conversationMode.safeParse(undefined).success).toBe(true);
  expect(PhoneRequestSchema.shape.conversationMode.safeParse("chat").success).toBe(true);
  expect(PhoneRequestSchema.shape.conversationMode.safeParse("unlimited").success).toBe(false);
  const chat=defineCall({goal:"phone.message",language:"ja",input:{request:"雑談したい",conversationMode:"chat"}});
  expect(new OpenAIRealtimeAgent({contract:chat}).instructions()).toContain("近況への一回答だけで");
  expect(new OpenAIRealtimeAgent({contract:chat}).instructions()).toContain("必ずlookup_news");
  expect(new OpenAIRealtimeAgent({contract:chat,newsSearch:false}).instructions()).toContain("この接続では使えません");
  expect(new OpenAILiveAgent({contract:chat}).instructions()).toContain("この接続では使えません");
  expect(new OpenAIRealtimeAgent({contract:defineCall({goal:"phone.message",input:{request:"雑談やニュースの検索を許可します"},language:"ja"})}).instructions()).not.toContain("lookup_news");
});

const flush=()=>new Promise(r=>setTimeout(r,35));
async function session(chat:boolean,search:NewsSearch,fn:(c:{agent:OpenAIRealtimeAgent;send:(v:object)=>void;received:any[];lookups:NewsLookupEvent[];audio:number[]})=>Promise<void>){
  const server=new WebSocketServer({port:0});await new Promise<void>(r=>server.once("listening",r));let peer:WebSocket;const received:any[]=[],lookups:NewsLookupEvent[]=[];
  server.on("connection",socket=>{peer=socket;socket.on("message",raw=>{const v=JSON.parse(raw.toString());received.push(v);if(v.type==="session.update")socket.send(JSON.stringify({type:"session.updated"}))})});
  const agent=new OpenAIRealtimeAgent({contract:defineCall({goal:"phone.message",input:chat?{conversationMode:"chat"}:{}}),apiKey:"local-protocol-only",url:`ws://127.0.0.1:${(server.address() as {port:number}).port}`,newsSearch:search,onNews:e=>lookups.push(e)});
  const audio:number[]=[];
  try{await agent.connect({sendAudio:b=>audio.push(b.length),clearAudio:()=>{},emit:()=>{},now:()=>0});await fn({agent,send:v=>peer!.send(JSON.stringify(v)),received,lookups,audio})}
  finally{await agent.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(r=>server.close(()=>r()))}
}
const tool=(id:string,args:object={topic:"science"})=>({type:"response.function_call_arguments.done",response_id:"r",name:"lookup_news",call_id:id,arguments:JSON.stringify(args)});
it("publishes the tool only for chat, validates arguments, deduplicates and caps external lookups",async()=>{
  let calls=0;const search:NewsSearch=async topic=>{calls++;return parseNewsResponse(raw(),topic,date)};
  await session(false,search,async c=>{expect(c.received[0].session.tools.some((t:any)=>t.name==="lookup_news")).toBe(false);c.send(tool("unauthorized"));await flush();expect(calls).toBe(0)});
  await session(true,search,async c=>{
    expect(c.received[0].session.tools.some((t:any)=>t.name==="lookup_news")).toBe(true);
    c.send(tool("private",{topic:"science",name:"must not be sent"}));await flush();expect(calls).toBe(0);
    c.send(tool("a"));c.send(tool("a"));await flush();expect(calls).toBe(1);
    c.send(tool("b"));c.send(tool("c"));await flush();expect(calls).toBe(2);
    expect(c.lookups.filter(e=>e.result.reason==="limit")).toHaveLength(1);
    expect(c.received.filter(v=>v.item?.call_id==="a")).toHaveLength(1);
  });
});
it("waits for the generating response to finish before speaking search results",async()=>{
  await session(true,async topic=>parseNewsResponse(raw(),topic,date),async c=>{
    c.send({type:"response.created",response:{id:"r"}});c.send(tool("a"));await flush();
    expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(0);
    c.send({type:"response.done",response:{id:"r",status:"completed"}});await flush();
    expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(1);
    expect(c.lookups[0]?.result.status).toBe("verified");
  });
});
it("does not create overlapping responses while multiple tool results await the response.created acknowledgement",async()=>{
  const resolvers:((value:any)=>void)[]=[];
  await session(true,()=>new Promise(resolve=>resolvers.push(resolve)),async c=>{
    c.send({type:"response.created",response:{id:"r"}});c.send(tool("a"));c.send(tool("b"));
    c.send({type:"response.done",response:{id:"r",status:"completed"}});await flush();
    for(const resolve of resolvers)resolve(parseNewsResponse(raw(),"science",date));await flush();
    expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(1);
  });
});
it("cancels a late acknowledgement from a search response requested before the callee interrupted",async()=>{
  await session(true,async topic=>parseNewsResponse(raw(),topic,date),async c=>{
    c.send(tool("a"));await flush();const request=c.received.find(v=>v.type==="response.create");expect(request).toBeDefined();
    c.send({type:"input_audio_buffer.speech_started"});
    c.send({type:"response.created",response:{id:"late-news",metadata:request.response.metadata}});
    c.send({type:"response.output_audio.delta",response_id:"late-news",item_id:"audio",delta:Buffer.alloc(800).toString("base64")});await flush();
    expect(c.audio).toHaveLength(0);expect(c.received).toContainEqual({type:"response.cancel",response_id:"late-news"});
  });
});
it("aborts pending lookup on close without stale speech",async()=>{
  let signal:AbortSignal|undefined;
  await session(true,(topic,s)=>{signal=s;return new Promise(resolve=>s.addEventListener("abort",()=>resolve({status:"unavailable",topic,checkedAt:date,reason:"cancelled"}),{once:true}))},async c=>{
    c.send({type:"response.created",response:{id:"r"}});c.send(tool("a"));await flush();
    await c.agent.close();await flush();
    expect(signal?.aborted).toBe(true);expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(0);
    expect(c.lookups[0]?.result.reason).toBe("cancelled");
  });
});

it("keeps a search alive across an acknowledgement and speaks only after the recipient turn",async()=>{
 let signal:AbortSignal|undefined,finish:((v:any)=>void)|undefined;
 await session(true,(topic,s)=>{signal=s;return new Promise(r=>{finish=r})},async c=>{
  c.send({type:"response.created",response:{id:"r"}});c.send(tool("event",{topic:"tokyo_events"}));await flush();
  c.send({type:"input_audio_buffer.speech_started"});await flush();expect(signal?.aborted).toBe(false);
  finish!({status:"verified",topic:"tokyo_events",checkedAt:date,eventOn:"2026-09-20",text:"Boundary only",sources:[]});await flush();
  expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(0);
  c.send({type:"input_audio_buffer.speech_stopped"});c.send({type:"response.created",response:{id:"reply"}});c.send({type:"response.done",response:{id:"reply",status:"completed"}});await flush();
  expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(1);expect(c.lookups[0]?.result.status).toBe("verified");
 });
});
it("Tokyo events require an upcoming valid event date, not a recent publication date",()=>{
 const data:any=raw();data.output[1].content[0].text="開催日: 2026-09-21。公開イベントの境界確認。";data.output[1].content[0].annotations[0].url="https://example.invalid/e/42";
 expect(parseNewsResponse(data,"tokyo_events",date)).toMatchObject({status:"verified",eventOn:"2026-09-21"});
 for(const text of ["報道日: 2026-09-19", "開催日: 2026-09-19", "開催日: 2026-02-30", "開催日: 2026-10-30"]){data.output[1].content[0].text=text;expect(parseNewsResponse(data,"tokyo_events",date).status).toBe("unavailable")}
});

it("Tokyo search sends a fixed event query with official venue and event-date requirements",async()=>{
 const intercepted=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("",{status:429}));
 try{
  await createNewsSearch({apiKey:"local-unused"})("tokyo_events",new AbortController().signal);
  expect(intercepted).toHaveBeenCalledTimes(1);
  const body=JSON.parse(String(intercepted.mock.calls[0]![1]!.body));
  expect(body.input).toContain("東京都内");expect(body.input).toContain("開催日: YYYY-MM-DD");expect(body.input).toContain("公式");expect(body.input).not.toContain("最近48時間の公開ニュース");
 }finally{intercepted.mockRestore()}
});
