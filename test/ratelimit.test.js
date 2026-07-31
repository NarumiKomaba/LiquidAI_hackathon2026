import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/ratelimit.js';

const generous = { maxPerIp: 1000, maxGlobal: 1000, dailyLimit: 1_000_000 };

test('requests are allowed up to the per-IP limit and refused after', () => {
  const allow = createRateLimiter({ ...generous, maxPerIp: 3, now: () => 0 });

  assert.deepEqual([allow('1.1.1.1'), allow('1.1.1.1'), allow('1.1.1.1')].map((v) => v.allowed), [true, true, true]);
  assert.deepEqual(allow('1.1.1.1'), { allowed: false, reason: 'per_ip' });
});

test('one noisy client does not consume another client’s quota', () => {
  const allow = createRateLimiter({ ...generous, maxPerIp: 2, now: () => 0 });

  allow('1.1.1.1');
  allow('1.1.1.1');

  assert.equal(allow('1.1.1.1').allowed, false);
  assert.equal(allow('2.2.2.2').allowed, true);
});

// 個別IPが上限内でも、全体の呼び出し量は Vertex AI の課金に直結するので別枠で止める
test('the global cap stops a distributed flood', () => {
  const allow = createRateLimiter({ ...generous, maxGlobal: 3, now: () => 0 });

  assert.deepEqual([allow('a'), allow('b'), allow('c')].map((v) => v.allowed), [true, true, true]);
  assert.deepEqual(allow('d'), { allowed: false, reason: 'global' });
});

test('counters reset once the window elapses', () => {
  let clock = 0;
  const allow = createRateLimiter({ ...generous, windowMs: 1000, maxPerIp: 1, now: () => clock });

  assert.equal(allow('1.1.1.1').allowed, true);
  assert.equal(allow('1.1.1.1').allowed, false);

  clock += 1001;
  assert.equal(allow('1.1.1.1').allowed, true);
});

// 分単位の制限は速度しか抑えない。総額を止めるのは日次の上限。
test('the daily cap holds even when every per-minute window resets', () => {
  let clock = 0;
  const allow = createRateLimiter({ windowMs: 1000, maxPerIp: 10, maxGlobal: 10, dailyLimit: 5, now: () => clock });

  for (let i = 0; i < 5; i += 1) {
    assert.equal(allow('1.1.1.1').allowed, true, `${i + 1}回目は通る`);
    clock += 1001; // 毎回ウィンドウを跨がせ、分単位の制限を無効化する
  }

  assert.deepEqual(allow('1.1.1.1'), { allowed: false, reason: 'daily' });
});

test('the daily counter rolls over after 24 hours', () => {
  let clock = 0;
  const allow = createRateLimiter({ ...generous, dailyLimit: 1, now: () => clock });

  assert.equal(allow('1.1.1.1').allowed, true);
  assert.equal(allow('1.1.1.1').allowed, false);

  clock += 24 * 60 * 60 * 1000 + 1;
  assert.equal(allow('1.1.1.1').allowed, true);
});
