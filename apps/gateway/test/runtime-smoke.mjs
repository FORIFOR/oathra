import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const [{CallRuntime},{PhoneTransport},{defineCall},{realtimeEngine},voice]=await Promise.all([
 import('../../../packages/runtime/dist/index.js'),import('../../../packages/phone/dist/index.js'),import('../../../packages/contract/dist/index.js'),
 import('../../../providers/openai-realtime/dist/index.js'),import('../../../packages/voice/dist/index.js')]);
assert.equal(typeof CallRuntime,'function');assert.equal(typeof PhoneTransport,'function');assert.equal(typeof voice.OutputQueue,'function');
const c=defineCall({goal:'sales.meeting',target:{phone:'+15005550006'},input:{reviewed_facts:'test'},permissions:{ask:true},require:{date:true,time:true,confirmed:true},budget:{maxDurationMs:30000,maxTurns:10,maxCostUsd:1}});
assert.equal(c.goal,'sales.meeting');assert(realtimeEngine({model:'explicit-test-model'}).speaksItself);
const require=createRequire(new URL('../../../providers/phone-twilio/package.json',import.meta.url));assert.equal(typeof require('ws').WebSocketServer,'function');
console.log('Existing runtime, voice, contract, phone and authenticated WebSocket imports verified. No network requests made.');
