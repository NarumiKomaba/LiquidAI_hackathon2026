import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscription } from '../src/transcriber.js';
import { DETECTION_MODEL, TRANSCRIPTION_MODEL } from '../src/models.js';

test('OpenAI model constants are fixed to cloud-hosted models', () => {
  assert.equal(TRANSCRIPTION_MODEL, 'gpt-4o-mini-transcribe');
  assert.equal(DETECTION_MODEL, 'gpt-4.1-mini');
});

test('normalizeTranscription accepts common API response shapes', () => {
  assert.equal(normalizeTranscription({ text: '  テストです  ' }), 'テストです');
  assert.equal(normalizeTranscription({ generated_text: '音声結果' }), '音声結果');
  assert.equal(normalizeTranscription([{ text: '配列結果' }]), '配列結果');
});
