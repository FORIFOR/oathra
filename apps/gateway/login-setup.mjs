// Issue one private, expiring setup link for an existing owner; never create a public admin signup.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { configuration } from './server.mjs';
import { Store } from './lib/store.mjs';
import { PasswordAccounts } from './lib/password-accounts.mjs';

const [owner,output,...flags]=process.argv.slice(2);
if(!owner||!output||flags.some(v=>v!=='--reset'))throw Error('Usage: node --env-file=<env-file> apps/gateway/login-setup.mjs <existing-owner-id> <private-output-file> [--reset]');
const path=resolve(output);
if(existsSync(path))throw Error('Refusing to replace an existing file. Choose a new output path.');
const config=configuration(),store=new Store(config.dbPath,config.dataKey);
try {
  const accounts=new PasswordAccounts(store,config);
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const link=accounts.issue(owner,{reset:flags.includes('--reset')});
  writeFileSync(path,link.url+'\n',{mode:0o600,flag:'wx'});
  console.log(`Private login setup link saved: ${path}\nValid for one hour, one use. Existing contact, call and credit owner IDs are preserved.`);
}finally{store.close()}
