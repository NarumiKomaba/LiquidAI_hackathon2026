import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis } from '../src/analysis.js';
import { calculateSynergy, getRiskLevel, scoreConversation } from '../src/scoring.js';
import { SIGNALS, SIGNAL_KEYS } from '../src/signals.js';

const utterance = (text, signals) => ({ text, analysis: normalizeAnalysis(signals) });
const hit = (text) => ({ status: true, text });

test('normalizeAnalysis returns the requested JSON shape for fraud signals', () => {
  const result = normalizeAnalysis({
    is_authority: hit('〇〇警察の生活安全課です'),
    has_secrecy: hit('誰にも言わないで'),
    demand_action: hit('今すぐATMに行ってください')
  });

  assert.deepEqual(Object.keys(result), SIGNAL_KEYS);
  assert.equal(result.is_authority.status, true);
  assert.equal(result.ask_financial.status, false);
});

test('normalizeAnalysis drops evidence text for signals that did not fire', () => {
  const result = normalizeAnalysis({ has_threat: { status: false, text: '残ってはいけない値' } });

  assert.equal(result.has_threat.text, '');
});

test('normalizeAnalysis truncates overlong evidence to fit the UI card', () => {
  const result = normalizeAnalysis({ is_authority: hit('あ'.repeat(500)) });

  assert.equal(result.is_authority.text.length, 180);
});

test('scoreConversation escalates combined risks from analyzed utterances', () => {
  const scored = scoreConversation([
    utterance('こんにちは', {}),
    utterance('〇〇警察の生活安全課です', { is_authority: hit('〇〇警察の生活安全課です') }),
    utterance('あなたも疑われています', { has_threat: hit('あなたも疑われています') }),
    utterance('捜査は秘密なので誰にも言わないで', { has_secrecy: hit('誰にも言わないで') }),
    utterance('今の残高はいくらですか', { ask_financial: hit('今の残高はいくらですか') }),
    utterance('今すぐATMに行ってください', { demand_action: hit('今すぐATMに行ってください') })
  ]);

  assert.equal(scored.riskLevel.key, 'danger');
  assert.equal(scored.score, 100);
});

test('an empty conversation scores zero rather than throwing', () => {
  const scored = scoreConversation([]);

  assert.equal(scored.score, 0);
  assert.equal(scored.riskLevel.key, 'safe');
  assert.deepEqual(scored.evidence.is_authority, []);
});

// 以下は上限100で飽和しない組み合わせを選んでいる。
// 全シグナル成立のケースは重みの合計だけで100に達するため synergy を検証できない。
test('secrecy combined with an urgent demand earns the pair bonus', () => {
  const scored = scoreConversation([
    utterance('誰にも言わないで', { has_secrecy: hit('誰にも言わないで') }),
    utterance('今すぐATMへ', { demand_action: hit('今すぐATMへ') })
  ]);

  // 22 + 18 = 40、2種類成立で +5、口止め×即時行動で +8
  assert.equal(scored.score, 53);
});

test('a threat combined with a balance question earns the pair bonus', () => {
  const scored = scoreConversation([
    utterance('逮捕されます', { has_threat: hit('逮捕されます') }),
    utterance('残高はいくらですか', { ask_financial: hit('残高はいくらですか') })
  ]);

  // 24 + 18 = 42、2種類成立で +5、脅し×資産確認で +7
  assert.equal(scored.score, 54);
});

test('calculateSynergy rewards breadth of signals', () => {
  const none = Object.fromEntries(SIGNAL_KEYS.map((key) => [key, 0]));

  assert.equal(calculateSynergy(none), 0);
  assert.equal(calculateSynergy({ ...none, is_authority: 18 }), 0);
  assert.equal(calculateSynergy({ ...none, is_authority: 18, has_threat: 24 }), 5);
  assert.equal(calculateSynergy({ ...none, is_authority: 18, has_threat: 24, demand_action: 18 }), 10);
});

test('a latched signal is never lowered by later harmless utterances', () => {
  const suspicious = [utterance('〇〇警察です', { is_authority: hit('〇〇警察です') })];
  const before = scoreConversation(suspicious).score;
  const after = scoreConversation([...suspicious, utterance('今日はいい天気ですね', {})]).score;

  assert.equal(after, before, 'latch したシグナルは後続の無害な発話で下がってはいけない');
  assert.ok(before > 0);
});

test('the same signal firing twice does not double-count its weight', () => {
  const once = scoreConversation([utterance('〇〇警察です', { is_authority: hit('〇〇警察です') })]);
  const twice = scoreConversation([
    utterance('〇〇警察です', { is_authority: hit('〇〇警察です') }),
    utterance('警察の者です', { is_authority: hit('警察の者です') })
  ]);

  assert.equal(twice.score, once.score);
  assert.equal(twice.evidence.is_authority.length, 2, '加点はしないが根拠は蓄積する');
});

test('signal weights are what the README documents', () => {
  assert.deepEqual(
    Object.fromEntries(SIGNAL_KEYS.map((key) => [key, SIGNALS[key].weight])),
    { is_authority: 18, has_threat: 24, has_secrecy: 22, ask_financial: 18, demand_action: 18 }
  );
});

test('getRiskLevel maps scores to intuitive UI labels', () => {
  assert.equal(getRiskLevel(0).key, 'safe');
  assert.equal(getRiskLevel(24).key, 'safe');
  assert.equal(getRiskLevel(25).key, 'caution');
  assert.equal(getRiskLevel(49).key, 'caution');
  assert.equal(getRiskLevel(50).key, 'warning');
  assert.equal(getRiskLevel(74).key, 'warning');
  assert.equal(getRiskLevel(75).key, 'danger');
  assert.equal(getRiskLevel(100).key, 'danger');
});
