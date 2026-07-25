import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio, normalizeAudioMimeType, parseAnalysisResponse } from '../src/gemini.js';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT } from '../src/prompt.js';
import { SIGNAL_KEYS } from '../src/signals.js';

test('normalizeAudioMimeType strips MediaRecorder codec parameters', () => {
  assert.equal(normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeAudioMimeType('audio/mp4'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType(''), 'audio/webm');
  assert.equal(normalizeAudioMimeType(undefined), 'audio/webm');
});

test('parseAnalysisResponse splits transcript from the fraud signals', () => {
  const result = parseAnalysisResponse(
    JSON.stringify({
      transcript: '〇〇警察の生活安全課です',
      is_authority: { status: true, text: '〇〇警察の生活安全課です' },
      has_threat: { status: false, text: '無視されるべき値' }
    })
  );

  assert.equal(result.transcript, '〇〇警察の生活安全課です');
  assert.equal(result.analysis.is_authority.status, true);
  // status が false のシグナルは根拠テキストを持ち越さない
  assert.equal(result.analysis.has_threat.text, '');
  assert.deepEqual(Object.keys(result.analysis), SIGNAL_KEYS);
});

test('parseAnalysisResponse treats an empty response as an inaudible chunk', () => {
  const result = parseAnalysisResponse('');

  assert.equal(result.transcript, '');
  assert.equal(SIGNAL_KEYS.every((key) => result.analysis[key].status === false), true);
});

test('parseAnalysisResponse fails loudly on non-JSON output', () => {
  assert.throws(() => parseAnalysisResponse('申し訳ありませんが回答できません'), /JSON 以外/);
});

test('analyzeAudio sends the audio inline with a structured-output config', async () => {
  const calls = [];
  const fakeClient = {
    models: {
      generateContent: async (request) => {
        calls.push(request);
        return { text: JSON.stringify({ transcript: 'もしもし', is_authority: { status: false, text: '' } }) };
      }
    }
  };

  const result = await analyzeAudio(fakeClient, {
    model: 'gemini-2.5-flash',
    audioBase64: 'AAAA',
    mimeType: 'audio/webm;codecs=opus'
  });

  assert.equal(calls.length, 1, '文字起こしと判定は1回の呼び出しにまとめる');
  const [request] = calls;
  assert.equal(request.model, 'gemini-2.5-flash');
  assert.deepEqual(request.contents[0].parts[0].inlineData, { mimeType: 'audio/webm', data: 'AAAA' });
  assert.equal(request.config.systemInstruction, SYSTEM_PROMPT);
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.deepEqual(request.config.responseSchema, RESPONSE_SCHEMA);
  assert.equal(result.transcript, 'もしもし');
});

test('analyzeAudio rejects an empty audio payload before calling the API', async () => {
  const fakeClient = {
    models: {
      generateContent: async () => assert.fail('空の音声で API を呼んではいけない')
    }
  };

  await assert.rejects(
    () => analyzeAudio(fakeClient, { model: 'gemini-2.5-flash', audioBase64: '' }),
    /audioBase64 is required/
  );
});

test('analyzeAudio wraps SDK failures with an actionable message', async () => {
  const fakeClient = {
    models: {
      generateContent: async () => {
        throw new Error('403 Permission denied');
      }
    }
  };

  await assert.rejects(
    () => analyzeAudio(fakeClient, { model: 'gemini-2.5-flash', audioBase64: 'AAAA' }),
    /Gemini API の呼び出しに失敗しました: 403 Permission denied/
  );
});

test('RESPONSE_SCHEMA requires a transcript plus every signal', () => {
  assert.deepEqual(RESPONSE_SCHEMA.required, ['transcript', ...SIGNAL_KEYS]);
  for (const key of SIGNAL_KEYS) {
    assert.deepEqual(RESPONSE_SCHEMA.properties[key].required, ['status', 'text']);
  }
});
