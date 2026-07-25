import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/ratelimit.js';

test('requests are allowed up to the per-IP limit and refused after', () => {
  const allow = createRateLimiter({ maxPerIp: 3, maxGlobal: 100, now: () => 0 });

  assert.deepEqual([allow('1.1.1.1'), allow('1.1.1.1'), allow('1.1.1.1')], [true, true, true]);
  assert.equal(allow('1.1.1.1'), false);
});

test('one noisy client does not consume another client’s quota', () => {
  const allow = createRateLimiter({ maxPerIp: 2, maxGlobal: 100, now: () => 0 });

  allow('1.1.1.1');
  allow('1.1.1.1');

  assert.equal(allow('1.1.1.1'), false);
  assert.equal(allow('2.2.2.2'), true);
});

// 個別IPが上限内でも、全体の呼び出し量は Vertex AI の課金に直結するので別枠で止める
test('the global cap stops a distributed flood', () => {
  const allow = createRateLimiter({ maxPerIp: 100, maxGlobal: 3, now: () => 0 });

  assert.deepEqual([allow('a'), allow('b'), allow('c')], [true, true, true]);
  assert.equal(allow('d'), false);
});

test('counters reset once the window elapses', () => {
  let clock = 0;
  const allow = createRateLimiter({ windowMs: 1000, maxPerIp: 1, maxGlobal: 10, now: () => clock });

  assert.equal(allow('1.1.1.1'), true);
  assert.equal(allow('1.1.1.1'), false);

  clock += 1001;
  assert.equal(allow('1.1.1.1'), true);
});
