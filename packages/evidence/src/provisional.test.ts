import { expect, it } from 'vitest';
import { EvidenceEngine } from './engine.js';

// 25 provisional phrasings × 20 numeric conditions. Synthetic Japanese
// utterances, not 500 real calls or 500 independent language phenomena.
const provisional = [
  '仮押さえとして', '仮予約として', '仮受付として', '仮確保として',
  '一応、仮の予約として', 'まだ未確定ですが', '正式な確定ではありませんが',
  '本予約ではありませんが', '本予約ではないのですが', '承認待ちですが',
  '確認が必要ですが', '社内確認待ちですが', '確約はできませんが',
  '確約できないのですが', '保留扱いですが', '調整中ですが',
  '可能か確認中ですが', '空き状況を確認してからですが', 'キャンセル待ちとして',
  '確定前の受付として', 'たぶん', 'おそらく', '恐らく',
  '確認してみますが', '予約できる見込みとして',
];
const cases = provisional.flatMap((qualifier, i) => Array.from({length:20},(_,n) => ({
  id: `${i+1}-${n+1}`,
  offer: `9月${n+1}日の19時、${n%5+1}名様で空いております。`,
  text: `${qualifier}、9月${n+1}日の19時、${n%5+1}名様でご予約を承りました。`,
})));

it.each(cases)('does not complete a provisional commitment $id', ({text,offer}) => {
  const engine = new EvidenceEngine({language:'ja',now:new Date('2026-09-01T10:00:00+09:00')});
  engine.ingest({id:'offer',source:'callee',text:offer,t:1});
  engine.ingest({id:'accept',source:'caller',text:'それでお願いします。',t:2});
  engine.ingest({id:'provisional',source:'callee',text,t:3});
  expect(engine.values().confirmed, text).not.toBe(true);
  // A later unambiguous commitment must still be able to settle the call.
  engine.ingest({id:'final',source:'callee',text:'それでは、ご予約を承りました。',t:4});
  expect(engine.values().confirmed).toBe(true);
});
