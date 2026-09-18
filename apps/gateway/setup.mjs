import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from './lib/security.mjs';
import { Store } from './lib/store.mjs';
import { Service } from './lib/service.mjs';
import { configuration } from './server.mjs';

const path=resolve(process.argv[2]??'.env.gateway');
if(existsSync(path))throw Error('Refusing to overwrite existing credentials. Choose a new path.');
const token=randomBytes(32).toString('base64url'),dataKey=randomBytes(32).toString('hex');
const env={OATHRA_MODE:'simulator',OATHRA_PUBLIC_URL:'http://localhost:4244',OATHRA_DATA_KEY:dataKey,OATHRA_DB:resolve('.oathra/gateway.sqlite'),
  OATHRA_USERS_JSON:JSON.stringify([{id:'operator',team:'workspace',role:'admin',tokenHash:hash(token)}])};
if(existsSync(env.OATHRA_DB))throw Error('Existing database detected. Keep its original encryption key; do not initialize over it.');
mkdirSync(resolve('.oathra'),{recursive:true,mode:0o700});
writeFileSync(path,Object.entries(env).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n',{mode:0o600,flag:'wx'});
const store=new Store(env.OATHRA_DB,dataKey),service=new Service(store,configuration(env)),u=service.user('operator');
service.product(u,{name:'デモ商品',facts:'これは台本による操作確認専用の商品です。実在の商品として説明しません。',reviewed:true});
service.contact(u,{name:'デモ担当者',phone:'+15005550006',relationship:'consented',basis:'模擬専用の番号。実電話では使用しない。',simulationOnly:true});
store.put('account',{...service.account(u),verifiedPhone:'+15005550006',phoneVerificationProvider:'simulator'});store.close();
const tokenFile=resolve('.oathra/operator-token.txt');writeFileSync(tokenFile,token+'\n',{mode:0o600,flag:'wx'});
console.log(`Simulator initialized. No provider call was made.\nEnvironment: ${path}\nGateway token: ${tokenFile}\nRun: node --env-file=${path} apps/gateway/server.mjs\nRead the privacy notice in Settings before approving a simulation.\nBefore live mode: remove demo contacts/products, verify a real operator number, and configure providers.`);
