import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryStore, HISTORY_COLLECTION } from '../src/history.js';

/** Firestore の最小限のフェイク。add したものを where/orderBy/limit で引ける。 */
function fakeFirestore() {
  const added = [];

  const query = (filters) => ({
    where: (field, _op, value) => query([...filters, [field, value]]),
    orderBy: () => query(filters),
    limit: (n) => query([...filters, ['__limit', n]]),
    get: async () => {
      const limit = filters.find(([field]) => field === '__limit')?.[1] ?? Infinity;
      const conditions = filters.filter(([field]) => field !== '__limit');
      const docs = added
        .filter((entry) => conditions.every(([field, value]) => entry.data[field] === value))
        .slice(0, limit)
        .map((entry) => ({ id: entry.id, data: () => entry.data }));
      return { docs };
    }
  });

  return {
    added,
    collections: [],
    collection(name) {
      this.collections.push(name);
      return {
        add: async (data) => {
          const id = `doc-${added.length + 1}`;
          added.push({ id, data });
          return { id };
        },
        ...query([])
      };
    }
  };
}

const call = (overrides = {}) => ({
  userId: 'u_12345',
  displayName: '山田',
  sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  startedAt: new Date('2026-07-25T10:00:00Z'),
  score: 100,
  riskLevel: 'danger',
  utteranceCount: 6,
  signals: [{ key: 'is_authority', label: '公的機関・権威の名乗り', evidence: '中央警察署です' }],
  summary: { summary: '警察を名乗る相手から送金を求められた', callerClaim: '中央警察署', requestedAction: 'ATMからの送金' },
  ...overrides
});

test('record writes to the call history collection', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });

  await store.record(call());

  assert.equal(firestore.collections[0], HISTORY_COLLECTION);
  assert.equal(firestore.added.length, 1);
});

// 履歴の目的は「どの通話が実際に詐欺だったか」を後から特定できること。
// 要約・名乗り・要求された行動がその手がかりになる。
test('record keeps the summary fields that identify a fraudulent call', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });

  await store.record(call());
  const [{ data }] = firestore.added;

  assert.equal(data.summary, '警察を名乗る相手から送金を求められた');
  assert.equal(data.callerClaim, '中央警察署');
  assert.equal(data.requestedAction, 'ATMからの送金');
  assert.equal(data.riskLevel, 'danger');
});

// 電話相手を含む第三者の発言をそのまま溜め込まないための約束
test('record never stores the raw conversation', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });

  await store.record(call());
  const [{ data }] = firestore.added;

  assert.equal('utterances' in data, false);
  assert.equal('items' in data, false);
  assert.equal('transcript' in data, false);
});

test('record stamps an expiry so Firestore TTL can clean up', async () => {
  const firestore = fakeFirestore();
  const now = new Date('2026-07-25T10:05:00Z');
  const store = createHistoryStore({ firestore, retentionDays: 30, now: () => now });

  await store.record(call());
  const [{ data }] = firestore.added;

  assert.equal(data.endedAt.toISOString(), '2026-07-25T10:05:00.000Z');
  assert.equal(data.expiresAt.toISOString(), '2026-08-24T10:05:00.000Z');
});

test('listByUser returns only that user’s calls', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });

  await store.record(call({ userId: 'u_alice' }));
  await store.record(call({ userId: 'u_bob' }));

  const calls = await store.listByUser('u_alice');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, 'u_alice');
});

test('listByUser converts Firestore timestamps to ISO strings', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });
  await store.record(call());

  // Firestore から読むと Date ではなく Timestamp 形式で返る
  firestore.added[0].data.endedAt = { toDate: () => new Date('2026-07-25T10:05:00Z') };

  const [item] = await store.listByUser('u_12345');

  assert.equal(item.endedAt, '2026-07-25T10:05:00.000Z');
  assert.equal(item.startedAt, '2026-07-25T10:00:00.000Z');
});

test('listByUser does not leak the internal expiry field', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });
  await store.record(call());

  const [item] = await store.listByUser('u_12345');

  assert.equal('expiresAt' in item, false);
  assert.equal('sessionId' in item, false);
});

test('listByUser caps an oversized limit', async () => {
  const firestore = fakeFirestore();
  const store = createHistoryStore({ firestore });
  for (let i = 0; i < 5; i += 1) await store.record(call());

  const calls = await store.listByUser('u_12345', { limit: 1000 });

  assert.ok(calls.length <= 200);
});
