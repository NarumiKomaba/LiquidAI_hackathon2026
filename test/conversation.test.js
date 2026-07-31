import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRIED_UTTERANCE_LABEL, createConversationStore } from '../src/conversation.js';
import { normalizeAnalysis } from '../src/analysis.js';

const utterance = (text, signals = {}) => ({ text, analysis: normalizeAnalysis(signals) });

test('append accumulates utterances per session', () => {
  const store = createConversationStore();

  store.append('call-a', utterance('もしもし'));
  const items = store.append('call-a', utterance('警察です'));

  assert.deepEqual(items.map((item) => item.text), ['もしもし', '警察です']);
});

test('sessions are isolated from each other', () => {
  const store = createConversationStore();

  store.append('call-a', utterance('Aの発話'));
  store.append('call-b', utterance('Bの発話'));

  assert.deepEqual(store.get('call-a').map((item) => item.text), ['Aの発話']);
  assert.deepEqual(store.get('call-b').map((item) => item.text), ['Bの発話']);
});

test('reset clears a single call without touching the others', () => {
  const store = createConversationStore();

  store.append('call-a', utterance('Aの発話'));
  store.append('call-b', utterance('Bの発話'));
  store.reset('call-a');

  assert.deepEqual(store.get('call-a'), []);
  assert.equal(store.get('call-b').length, 1);
});

test('a session keeps only the most recent utterances', () => {
  const store = createConversationStore({ maxUtterances: 3 });

  ['1', '2', '3', '4'].forEach((text) => store.append('call-a', utterance(text)));

  assert.deepEqual(store.get('call-a').map((item) => item.text), ['2', '3', '4']);
});

// latch の要。上限を超えて発話が捨てられても、そこで立ったシグナルが消えると
// スコアが下がってしまい「一度上がったら下がらない」という設計が壊れる。
test('a signal from an evicted utterance survives as a carried entry', () => {
  const store = createConversationStore({ maxUtterances: 2 });

  store.append('call-a', utterance('〇〇警察です', { is_authority: { status: true, text: '〇〇警察です' } }));
  store.append('call-a', utterance('世間話1'));
  store.append('call-a', utterance('世間話2'));
  const items = store.append('call-a', utterance('世間話3'));

  const carried = items.find((item) => item.text === CARRIED_UTTERANCE_LABEL);
  assert.ok(carried, '捨てた発話のシグナルは擬似発話として残る');
  assert.equal(carried.analysis.is_authority.status, true);
  assert.equal(carried.analysis.has_threat.status, false);
});

test('eviction of harmless utterances does not add a carried entry', () => {
  const store = createConversationStore({ maxUtterances: 2 });

  ['1', '2', '3', '4'].forEach((text) => store.append('call-a', utterance(text)));

  assert.deepEqual(store.get('call-a').map((item) => item.text), ['3', '4']);
});

test('the oldest session is evicted once the session cap is reached', () => {
  const store = createConversationStore({ maxSessions: 2 });

  store.append('call-a', utterance('A'));
  store.append('call-b', utterance('B'));
  store.append('call-c', utterance('C'));

  assert.equal(store.size, 2);
  assert.deepEqual(store.get('call-a'), []);
  assert.equal(store.get('call-c').length, 1);
});

test('an active session is not evicted by newer ones', () => {
  const store = createConversationStore({ maxSessions: 2 });

  store.append('call-a', utterance('A1'));
  store.append('call-b', utterance('B1'));
  store.append('call-a', utterance('A2')); // call-a を最新に押し上げる
  store.append('call-c', utterance('C1'));

  assert.equal(store.get('call-a').length, 2, '通話中のセッションは追い出されない');
  assert.deepEqual(store.get('call-b'), []);
});

test('finalize returns the call and clears the session', () => {
  const store = createConversationStore({ now: () => 1000 });

  store.append('call-a', utterance('もしもし'), { userId: 'u_1', displayName: '山田' });
  store.append('call-a', utterance('警察です'));
  const finalized = store.finalize('call-a');

  assert.equal(finalized.userId, 'u_1');
  assert.equal(finalized.displayName, '山田');
  assert.equal(finalized.startedAt, 1000);
  assert.deepEqual(finalized.utterances, ['もしもし', '警察です']);
  assert.deepEqual(store.get('call-a'), [], 'finalize したセッションは消える');
});

// 利用者情報は最初の発話のものを保つ。途中のリクエストで差し替えられると、
// 通話の途中から別人の履歴に化けてしまう。
test('finalize keeps the caller from the first utterance', () => {
  const store = createConversationStore();

  store.append('call-a', utterance('1'), { userId: 'u_1' });
  store.append('call-a', utterance('2'), { userId: 'u_attacker' });

  assert.equal(store.finalize('call-a').userId, 'u_1');
});

test('finalize returns null for a call with nothing said', () => {
  const store = createConversationStore();

  assert.equal(store.finalize('never-started'), null);
});

test('finalize excludes the carried placeholder from the text used for summarising', () => {
  const store = createConversationStore({ maxUtterances: 2 });

  store.append('call-a', utterance('〇〇警察です', { is_authority: { status: true, text: '〇〇警察です' } }));
  store.append('call-a', utterance('世間話1'));
  store.append('call-a', utterance('世間話2'));

  const finalized = store.finalize('call-a');

  assert.deepEqual(finalized.utterances, ['世間話1', '世間話2'], '要約には擬似発話を混ぜない');
  assert.equal(
    finalized.items.some((item) => item.analysis.is_authority?.status),
    true,
    'スコアリング用にはシグナルが残る'
  );
});

test('sessions expire after the TTL', () => {
  let clock = 0;
  const store = createConversationStore({ ttlMs: 1000, now: () => clock });

  store.append('call-a', utterance('A'));
  clock += 1500;

  assert.deepEqual(store.get('call-a'), []);
  assert.equal(store.size, 0);
});

test('append returns a fresh array so callers cannot corrupt the store', () => {
  const store = createConversationStore();

  const items = store.append('call-a', utterance('A'));
  items.push(utterance('偽の発話'));

  assert.equal(store.get('call-a').length, 1);
});
