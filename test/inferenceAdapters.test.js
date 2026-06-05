import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInferenceHeaders, isLocalInferenceUrl, resolveInferenceAdapter } from '../src/inferenceAdapters.js';

test('resolveInferenceAdapter treats localhost endpoints as local inference', () => {
  assert.equal(resolveInferenceAdapter({ url: 'http://localhost:8088/transcribe' }), 'local');
  assert.equal(resolveInferenceAdapter({ url: 'https://router.huggingface.co/v1/chat/completions' }), 'huggingface');
  assert.equal(resolveInferenceAdapter({ provider: 'local', url: 'https://example.com' }), 'local');
});

test('isLocalInferenceUrl supports loopback hosts', () => {
  assert.equal(isLocalInferenceUrl('http://127.0.0.1:8088/transcribe'), true);
  assert.equal(isLocalInferenceUrl('http://[::1]:8088/transcribe'), true);
  assert.equal(isLocalInferenceUrl('https://huggingface.co'), false);
});

test('buildInferenceHeaders omits authorization for local adapters', () => {
  const headers = buildInferenceHeaders({
    adapter: 'local',
    token: 'secret',
    contentType: 'application/json',
    waitForModel: true,
    model: 'local-model'
  });

  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['X-Wait-For-Model'], undefined);
  assert.equal(headers['X-SAFi-Model'], 'local-model');
});
