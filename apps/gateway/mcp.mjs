import { createInterface } from 'node:readline';
/** Read/draft-only stdio MCP surface. Agents never approve calls or follow-up messages. */
const tools=[
 {name:'oathra_list',description:'List this account’s products, contacts and missions. Does not call anyone.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'oathra_draft',description:'Prepare one telephone mission for a human to review in Web/iOS/LINE. Does not grant approval or dial.',inputSchema:{type:'object',properties:{request:{type:'string'},productId:{type:'string'},contactId:{type:'string'},testOnMe:{type:'boolean'},goal:{type:'string',enum:['meeting','materials','introduce']}},required:['request'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
 {name:'oathra_status',description:'Read evidence and canonical status for an existing mission.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true}}
];
const base=(process.env.OATHRA_GATEWAY_URL??'').replace(/\/$/,''),token=process.env.OATHRA_GATEWAY_TOKEN??'';
const validURL=()=>{const u=new URL(base);if(u.protocol!=='https:'&&!['http://localhost:4244','http://127.0.0.1:4244'].includes(base))throw Error('Use HTTPS');if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Use an origin URL');};
async function call(name,args){
 validURL();if(!token)throw Error('Gateway token is required');
 let path='/bootstrap',method='GET',body;
 if(name==='oathra_draft'){path='/missions/draft';method='POST';body=JSON.stringify(args);}
 else if(name==='oathra_status'){if(!/^[a-f0-9-]{36}$/.test(args.id??''))throw Error('Invalid mission ID');path='/missions/'+args.id;}
 else if(name!=='oathra_list')throw Error('Unknown tool');
 const response=await fetch(base+'/v1'+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const value=await response.json();if(!response.ok)throw Error(value.error??'Gateway request failed');
 if(name==='oathra_list')return {products:value.products,contacts:value.contacts,missions:value.missions};return value;
}
async function handle(m){
 if(m.jsonrpc!=='2.0')throw Error('Invalid JSON-RPC');
 if(m.method==='initialize')return {protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'oathra-gateway',version:'0.2.0'}};
 if(m.method==='ping')return {};
 if(m.method==='tools/list')return {tools};
 if(m.method==='tools/call'){try{return {content:[{type:'text',text:JSON.stringify(await call(m.params?.name,m.params?.arguments??{}))}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}}
 throw Error('Method not found');
}
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of rl){let m;try{if(Buffer.byteLength(line)>65536)throw Error('Message too large');m=JSON.parse(line);if(m.id===undefined)continue;const result=await handle(m);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');}catch{if(m?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32600,message:'Invalid request'}})+'\n');}}
