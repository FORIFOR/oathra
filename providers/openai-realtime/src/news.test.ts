// Bounded protocol fixtures reproduce missing citations, duplicate delivery and cancellation.
// No provider credentials/phone calls. Temporary sockets and callbacks are disposed after each test.
import { expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { defineCall, PhoneRequestSchema } from "@oathra/contract";
import { OpenAILiveAgent } from "./live.js";
import { publicQuery, createNewsSearch, parseNewsResponse, type NewsSearch, type NewsLookupEvent } from "./news.js";

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
    expect(body.store).toBe(false);expect(body.max_tool_calls).toBe(2);expect(body.tool_choice).toBe("required");
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
  expect(new OpenAILiveAgent({contract:chat}).instructions()).toContain("近況への一回答だけで");
  // A chat is carried by reactions to what was said, not by a question every turn.
  const talk=new OpenAILiveAgent({contract:chat}).instructions();
  for(const phrase of ["共感や同意","例え話","似た考え方や共通点","軽いアドバイス","質問攻め","実体験はありません","私はAIだから実際にはないんだけど","作り話は絶対にしない","はぐらかさず","最初から言い直さず","そこで必ず話すのをやめ、相手の返事を待ってください","過去に会話や約束があったかのような話は絶対に作らないでください","発話を質問で終えるのは三回に一回まで","別の質問を重ねてはいけません","特定の区や駅・施設","検索するふりをせず"])expect(talk).toContain(phrase);
  expect(talk).not.toContain("一度に一つだけ質問");
  expect(new OpenAILiveAgent({contract:chat}).instructions()).toContain("必ずlookup_news");
  expect(new OpenAILiveAgent({contract:chat}).backendInstructions()).toContain("- lookup_news:");
  expect(new OpenAILiveAgent({contract:chat,newsSearch:false}).instructions()).toContain("この接続では使えません");
  expect(new OpenAILiveAgent({contract:defineCall({goal:"phone.message",input:{request:"雑談やニュースの検索を許可します"},language:"ja"})}).instructions()).not.toContain("lookup_news");
});

const flush=()=>new Promise(r=>setTimeout(r,35));
async function session(chat:boolean,search:NewsSearch,fn:(c:{agent:OpenAILiveAgent;send:(v:object)=>void;received:any[];lookups:NewsLookupEvent[]})=>Promise<void>){
  const server=new WebSocketServer({port:0});await new Promise<void>(r=>server.once("listening",r));let peer:WebSocket;const received:any[]=[],lookups:NewsLookupEvent[]=[];
  server.on("connection",socket=>{peer=socket;socket.on("message",raw=>{const v=JSON.parse(raw.toString());received.push(v);if(v.type==="session.start")socket.send(JSON.stringify({type:"session.started"}))})});
  const agent=new OpenAILiveAgent({contract:defineCall({goal:"phone.message",input:chat?{conversationMode:"chat"}:{}}),apiKey:"local-protocol-only",url:`ws://127.0.0.1:${(server.address() as {port:number}).port}`,newsSearch:search,onNews:e=>lookups.push(e)});
  try{await agent.connect({sendAudio:()=>{},clearAudio:()=>{},emit:()=>{},now:()=>0});await fn({agent,send:v=>peer!.send(JSON.stringify(v)),received,lookups})}
  finally{agent.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(r=>server.close(()=>r()))}
}
const tools=(c:{received:any[]})=>c.received[0].session.delegation.responses.tools as any[];
const tool=(id:string,args:object={topic:"science"})=>({type:"response.event",event:{type:"response.output_item.done",item:{type:"function_call",name:"lookup_news",call_id:id,arguments:JSON.stringify(args)}}});
it("publishes the tool only for chat, validates arguments, deduplicates and caps external lookups",async()=>{
  let calls=0;const search:NewsSearch=async topic=>{calls++;return parseNewsResponse(raw(),topic,date)};
  await session(false,search,async c=>{expect(c.received[0].session.delegation.responses.parallel_tool_calls).toBe(false);expect(tools(c).some(t=>t.name==="lookup_news")).toBe(false);expect(tools(c).some(t=>t.type==="web_search")).toBe(false);c.send(tool("unauthorized"));await flush();expect(calls).toBe(0)});
  await session(true,search,async c=>{
    expect(tools(c).some(t=>t.name==="lookup_news")).toBe(true);expect(tools(c).some(t=>t.type==="web_search")).toBe(false);
    // Several lookups may be requested at once only where lookups exist at all.
    expect(c.received[0].session.delegation.responses.parallel_tool_calls).toBe(true);
    c.send(tool("private",{topic:"science",name:"must not be sent"}));await flush();expect(calls).toBe(0);
    c.send(tool("a"));c.send(tool("a"));await flush();expect(calls).toBe(1);
    c.send(tool("b"));c.send(tool("c",{topic:"weather"}));c.send(tool("d",{topic:"tokyo_events"}));await flush();expect(calls).toBe(4);
    for(const id of ["e","f","g","h"])c.send(tool(id));await flush();expect(calls).toBe(8);
    c.send(tool("i"));await flush();expect(calls).toBe(8);
    expect(c.lookups.filter(e=>e.result.reason==="limit")).toHaveLength(1);
    expect(c.received.filter(v=>v.item?.call_id==="a")).toHaveLength(1);
  });
});
it("returns the result as the tool output before asking Live to continue",async()=>{
  await session(true,async topic=>parseNewsResponse(raw(),topic,date),async c=>{
    c.send(tool("a"));await flush();
    const output=c.received.findIndex(v=>v.type==="response.item.create"&&v.item?.type==="function_call_output"&&v.item.call_id==="a");
    const next=c.received.findIndex(v=>v.type==="response.create"&&v.event_id==="continue_a");
    expect(output).toBeGreaterThan(0);expect(next).toBe(output+1);
    expect(JSON.parse(c.received[output].item.output).status).toBe("verified");expect(c.lookups[0]?.result.status).toBe("verified");
    expect(c.lookups[0]?.tookMs).toBeGreaterThanOrEqual(0);expect(JSON.parse(c.received[output].item.output).tookMs).toBeUndefined();
  });
});
it("aborts pending lookup on close without stale speech",async()=>{
  let signal:AbortSignal|undefined;
  await session(true,(topic,s)=>{signal=s;return new Promise(resolve=>s.addEventListener("abort",()=>resolve({status:"unavailable",topic,checkedAt:date,reason:"cancelled"}),{once:true}))},async c=>{
    c.send(tool("a"));await flush();
    c.agent.close();await flush();
    expect(signal?.aborted).toBe(true);expect(c.received.filter(v=>v.type==="response.create")).toHaveLength(0);
    expect(c.lookups[0]?.result.reason).toBe("cancelled");
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
  expect(body.max_tool_calls).toBe(3);expect(body.input).toContain("東京都内");expect(body.input).toContain("開催日: YYYY-MM-DD");expect(body.input).toContain("公式");expect(body.input).not.toContain("最近48時間の公開ニュース");
 }finally{intercepted.mockRestore()}
});

it("weather is its own fixed category, so a typhoon question is not answered with an unrelated headline",async()=>{
 const intercepted=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("",{status:429}));
 try{
  await createNewsSearch({apiKey:"local-unused"})("weather",new AbortController().signal);
  const body=JSON.parse(String(intercepted.mock.calls[0]![1]!.body));
  expect(body.input).toContain("台風");expect(body.input).toContain("気象庁");expect(body.input).toContain("報道日: YYYY-MM-DD");expect(body.input).not.toContain("分類 weather");
 }finally{intercepted.mockRestore()}
 const data:any=raw();data.output[1].content[0].text="報道日: 2026-09-20、発表元: 気象庁。現在、日本に接近している台風は確認できない。";
 expect(parseNewsResponse(data,"weather",date)).toMatchObject({status:"verified",topic:"weather"});
});

it("public words may be searched; the people on the call, numbers, addresses and links may not",()=>{
 expect(publicQuery("任天堂　株価")).toBe("任天堂 株価");expect(publicQuery(" 生成AI 最新動向 ")).toBe("生成AI 最新動向");expect(publicQuery("ＡＩ規制 ２０２６")).toBe("AI規制 2026");
 for(const bad of [undefined,42,"","a","x".repeat(61),"090-1234-5678 だれ","０９０１２３４５６７８","foo@example.com","https://example.com/x","www.example.com","〒100-0001 の店","150-0001 近くのカフェ"])expect(publicQuery(bad)).toBeNull();
 // Whoever is on this call is never a search term, however the name is spaced or cased.
 expect(publicQuery("山田 太郎 評判",["山田太郎"])).toBeNull();expect(publicQuery("やまだ商店 営業時間",["やまだ商店"])).toBeNull();expect(publicQuery("任天堂 株価",["山田太郎",""])).toBe("任天堂 株価");
});
it("topic=search carries only an accepted query to the search, and refuses private or malformed ones without searching",async()=>{
 const seen:(string|undefined)[]=[];const search:NewsSearch=async(topic,_s,query)=>{seen.push(query);return {status:"verified",topic,checkedAt:date,publishedOn:"2026-09-19",text:"確認日: 2026-09-19",sources:[],...(query?{query}:{})}};
 await session(true,search,async c=>{
  c.send(tool("ok",{topic:"search",query:"任天堂 株価"}));await flush();expect(seen).toEqual(["任天堂 株価"]);expect(c.lookups[0]?.result).toMatchObject({status:"verified",query:"任天堂 株価"});
  for(const [id,args] of [["phone",{topic:"search",query:"090-1234-5678 だれの番号"}],["none",{topic:"search"}],["extra",{topic:"search",query:"任天堂 株価",note:"x"}]] as const){c.send(tool(id,args));}
  await flush();expect(seen).toEqual(["任天堂 株価"]);expect(c.lookups.slice(1).every(e=>e.result.status==="unavailable"&&e.result.reason==="unverified")).toBe(true);
  // Seen on the real API: the model attaches a query to a category lookup too. The category still works; the words are not used.
  c.send(tool("category",{topic:"weather",query:"台風 最新"}));await flush();expect(seen).toEqual(["任天堂 株価",undefined]);expect(c.lookups.at(-1)?.result.status).toBe("verified");
 });
});
it("a public search asks for a source and the date the answer is good for, and is rejected without them",async()=>{
 const intercepted=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("",{status:429}));
 try{
  await createNewsSearch({apiKey:"local-unused"})("search",new AbortController().signal,"任天堂 株価");
  const body=JSON.parse(String(intercepted.mock.calls[0]![1]!.body));
  expect(body.input).toContain("「任天堂 株価」");expect(body.input).toContain("確認日: YYYY-MM-DD");expect(body.input).toContain("売買の助言はしない");expect(body.max_tool_calls).toBe(3);
  await expect(createNewsSearch({apiKey:"local-unused"})("search",new AbortController().signal,"090-1234-5678")).rejects.toThrow(/invalid_public_query/);
  expect(intercepted).toHaveBeenCalledTimes(1);
 }finally{intercepted.mockRestore()}
 const data:any=raw();data.output[1].content[0].annotations[0].url="https://example.invalid/q/7974";
 data.output[1].content[0].text="確認日: 2026-09-18、出典: 表示確認用。終値は境界確認用の値です。";expect(parseNewsResponse(data,"search",date)).toMatchObject({status:"verified",publishedOn:"2026-09-18"});
 for(const text of ["終値は境界確認用の値です。","確認日: 2027-01-01 未来の日付","確認日: 2026-02-30"]){data.output[1].content[0].text=text;expect(parseNewsResponse(data,"search",date).status).toBe("unavailable")}
});

it("lookups asked for together continue once, after the last of them, and never while an output is missing",async()=>{
 const release:(()=>void)[]=[];const search:NewsSearch=(topic)=>new Promise(resolve=>release.push(()=>resolve({status:"verified",topic,checkedAt:date,publishedOn:"2026-09-19",text:"報道日: 2026-09-19",sources:[]})));
 await session(true,search,async c=>{
  c.send(tool("events",{topic:"tokyo_events"}));c.send(tool("typhoon",{topic:"weather"}));c.send(tool("refused",{topic:"search",query:"090-1234-5678"}));await flush();
  const outputs=()=>c.received.filter(v=>v.type==="response.item.create").map(v=>v.item.call_id),continues=()=>c.received.filter(v=>v.type==="response.create");
  expect(outputs()).toEqual(["refused"]);expect(continues()).toHaveLength(0);
  release[0]!();await flush();expect(outputs()).toEqual(["refused","events"]);expect(continues()).toHaveLength(0);
  release[1]!();await flush();expect(outputs()).toEqual(["refused","events","typhoon"]);expect(continues()).toHaveLength(1);
 });
});
