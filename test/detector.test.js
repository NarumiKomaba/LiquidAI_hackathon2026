import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis, scoreConversation, getRiskLevel } from '../src/detector.js';

test('normalizeAnalysis returns the requested JSON shape for fraud signals', () => {
  const result = normalizeAnalysis({
    is_authority: { status: true, text: '〇〇警察の生活安全課です' },
    has_secrecy: { status: true, text: '誰にも言わないで' },
    demand_action: { status: true, text: '今すぐATMに行ってください' }
  });

  assert.equal(result.is_authority.status, true);
  assert.equal(result.has_secrecy.status, true);
  assert.equal(result.demand_action.status, true);
  assert.equal(result.ask_financial.status, false);
});

test('scoreConversation escalates combined risks from analyzed utterances', () => {
  const analyzedUtterances = [
    {
      text: 'こんにちは',
      analysis: normalizeAnalysis({})
    },
    {
      text: '〇〇警察の生活安全課です',
      analysis: normalizeAnalysis({ is_authority: { status: true, text: '〇〇警察の生活安全課です' } })
    },
    {
      text: 'あなたも疑われています',
      analysis: normalizeAnalysis({ has_threat: { status: true, text: 'あなたも疑われています' } })
    },
    {
      text: '捜査は秘密なので誰にも言わないで',
      analysis: normalizeAnalysis({ has_secrecy: { status: true, text: '誰にも言わないで' } })
    },
    {
      text: '今の残高はいくらですか',
      analysis: normalizeAnalysis({ ask_financial: { status: true, text: '今の残高はいくらですか' } })
    },
    {
      text: '今すぐATMに行ってください',
      analysis: normalizeAnalysis({ demand_action: { status: true, text: '今すぐATMに行ってください' } })
    }
  ];
  const scored = scoreConversation(analyzedUtterances);

  assert.equal(scored.riskLevel.key, 'danger');
  assert.equal(scored.score, 100);
});

test('getRiskLevel maps scores to intuitive UI labels', () => {
  assert.equal(getRiskLevel(10).key, 'safe');
  assert.equal(getRiskLevel(35).key, 'caution');
  assert.equal(getRiskLevel(60).key, 'warning');
  assert.equal(getRiskLevel(90).key, 'danger');
});
