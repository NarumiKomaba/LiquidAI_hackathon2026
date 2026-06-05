import test from 'node:test';
import assert from 'node:assert/strict';
import { localAnalyze, scoreConversation, getRiskLevel } from '../src/detector.js';

test('localAnalyze returns the requested JSON shape for fraud signals', () => {
  const result = localAnalyze('〇〇警察の生活安全課です。捜査は秘密なので誰にも言わないで、今すぐATMに行ってください。');

  assert.equal(result.is_authority.status, true);
  assert.equal(result.has_secrecy.status, true);
  assert.equal(result.demand_action.status, true);
  assert.equal(result.ask_financial.status, false);
});

test('scoreConversation uses a five utterance window and escalates combined risks', () => {
  const utterances = [
    'こんにちは',
    '〇〇警察の生活安全課です',
    'あなたも疑われています',
    '捜査は秘密なので誰にも言わないで',
    '今の残高はいくらですか',
    '今すぐATMに行ってください'
  ];
  const scored = scoreConversation(utterances.map((text) => ({ text, analysis: localAnalyze(text) })));

  assert.equal(scored.riskLevel.key, 'danger');
  assert.equal(scored.score, 100);
});

test('getRiskLevel maps scores to intuitive UI labels', () => {
  assert.equal(getRiskLevel(10).key, 'safe');
  assert.equal(getRiskLevel(35).key, 'caution');
  assert.equal(getRiskLevel(60).key, 'warning');
  assert.equal(getRiskLevel(90).key, 'danger');
});
