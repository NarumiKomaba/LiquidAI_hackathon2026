import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalDigest, parseSummaryResponse, summarizeCall } from '../src/summary.js';
import { normalizeAnalysis } from '../src/analysis.js';
import { scoreConversation } from '../src/scoring.js';

const clientReturning = (text, calls = []) => ({
  models: {
    generateContent: async (request) => {
      calls.push(request);
      return { text };
    }
  }
});

test('summarizeCall asks Gemini once for the whole call', async () => {
  const calls = [];
  const client = clientReturning(
    JSON.stringify({ summary: '警察を名乗る相手から送金を求められた', callerClaim: '中央警察署', requestedAction: 'ATMからの送金' }),
    calls
  );

  const result = await summarizeCall(client, {
    model: 'gemini-2.5-flash',
    utterances: ['もしもし、中央警察署です', '今すぐATMへ行ってください']
  });

  assert.equal(calls.length, 1, '要約は通話終了時の1回だけ');
  assert.match(calls[0].contents[0].parts[0].text, /もしもし、中央警察署です/);
  assert.match(calls[0].contents[0].parts[0].text, /今すぐATMへ行ってください/);
  assert.equal(result.callerClaim, '中央警察署');
});

test('summarizeCall skips the API entirely when nothing was said', async () => {
  const client = {
    models: { generateContent: async () => assert.fail('発話が無ければ呼んではいけない') }
  };

  const result = await summarizeCall(client, { model: 'gemini-2.5-flash', utterances: [] });

  assert.deepEqual(result, { summary: '', callerClaim: '', requestedAction: '' });
});

// 要約が作れなくても、スコアとシグナルの履歴は残したい
test('summarizeCall degrades to an empty summary instead of throwing', async () => {
  const client = {
    models: {
      generateContent: async () => {
        throw new Error('429 Too Many Requests');
      }
    }
  };

  const result = await summarizeCall(client, { model: 'gemini-2.5-flash', utterances: ['もしもし'] });

  assert.deepEqual(result, { summary: '', callerClaim: '', requestedAction: '' });
});

test('parseSummaryResponse trims and caps overlong fields', () => {
  const result = parseSummaryResponse(
    JSON.stringify({ summary: `  ${'あ'.repeat(900)}  `, callerClaim: '  警察  ', requestedAction: 'い'.repeat(400) })
  );

  assert.equal(result.summary.length, 600);
  assert.equal(result.callerClaim, '警察');
  assert.equal(result.requestedAction.length, 200);
});

test('parseSummaryResponse tolerates junk output', () => {
  assert.deepEqual(parseSummaryResponse('not json'), { summary: '', callerClaim: '', requestedAction: '' });
  assert.deepEqual(parseSummaryResponse(''), { summary: '', callerClaim: '', requestedAction: '' });
  assert.deepEqual(parseSummaryResponse(undefined), { summary: '', callerClaim: '', requestedAction: '' });
});

test('buildSignalDigest lists only the signals that fired, with one evidence each', () => {
  const scored = scoreConversation([
    {
      text: '中央警察署の田中です',
      analysis: normalizeAnalysis({ is_authority: { status: true, text: '中央警察署の田中です' } })
    },
    {
      text: '警察の者です',
      analysis: normalizeAnalysis({ is_authority: { status: true, text: '警察の者です' } })
    },
    { text: '今日はいい天気ですね', analysis: normalizeAnalysis({}) }
  ]);

  const digest = buildSignalDigest(scored);

  assert.equal(digest.length, 1);
  assert.deepEqual(digest[0], {
    key: 'is_authority',
    label: '公的機関・権威の名乗り',
    evidence: '中央警察署の田中です'
  });
});

test('buildSignalDigest is empty for a harmless call', () => {
  const scored = scoreConversation([{ text: 'こんにちは', analysis: normalizeAnalysis({}) }]);

  assert.deepEqual(buildSignalDigest(scored), []);
});
