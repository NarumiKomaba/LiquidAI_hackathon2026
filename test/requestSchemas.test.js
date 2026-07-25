import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSchema, describeValidationError, resetSchema } from '../src/requestSchemas.js';

const sessionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const validBody = { sessionId, audioBase64: 'AAAABBBB', mimeType: 'audio/webm;codecs=opus' };

test('a well-formed analyze request passes and the codec parameter is stripped', () => {
  const parsed = analyzeSchema.parse(validBody);

  assert.equal(parsed.sessionId, sessionId);
  assert.equal(parsed.mimeType, 'audio/webm');
});

test('mimeType defaults to webm when omitted', () => {
  const parsed = analyzeSchema.parse({ sessionId, audioBase64: 'AAAA' });

  assert.equal(parsed.mimeType, 'audio/webm');
});

// 音声以外を通すと、この API が「他人の課金で動く汎用マルチモーダル Gemini プロキシ」になる
test('non-audio media types are rejected', () => {
  for (const mimeType of ['application/pdf', 'image/png', 'text/plain', 'video/mp4']) {
    assert.throws(() => analyzeSchema.parse({ ...validBody, mimeType }), /unsupported audio type/, mimeType);
  }
});

test('audioBase64 must actually be base64', () => {
  assert.throws(() => analyzeSchema.parse({ ...validBody, audioBase64: 'not base64!!' }), /base64/);
});

test('an empty audio payload is rejected', () => {
  assert.throws(() => analyzeSchema.parse({ ...validBody, audioBase64: '' }));
});

// セッションの分離は「他人のIDを推測できないこと」に依存しているので、
// 短いIDや連番を受け付けるとその前提が崩れる
test('sessionId must be a UUID', () => {
  for (const bad of ['aaaaaaaa', '1', 'session-1', 'x'.repeat(64)]) {
    assert.throws(() => analyzeSchema.parse({ ...validBody, sessionId: bad }), undefined, bad);
    assert.throws(() => resetSchema.parse({ sessionId: bad }), undefined, bad);
  }
});

test('reset accepts a UUID and nothing else is required', () => {
  assert.deepEqual(resetSchema.parse({ sessionId }), { sessionId });
});

test('describeValidationError summarises zod issues without echoing values', () => {
  try {
    analyzeSchema.parse({ sessionId: 'nope', audioBase64: 'AAAA' });
    assert.fail('should have thrown');
  } catch (error) {
    const message = describeValidationError(error);
    assert.match(message, /sessionId/);
    assert.equal(message.includes('nope'), false, '入力値そのものは返さない');
  }
});

test('describeValidationError falls back for non-zod errors', () => {
  assert.equal(describeValidationError(new Error('boom')), 'リクエスト形式が不正です。');
});
