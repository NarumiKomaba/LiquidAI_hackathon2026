import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscription } from '../src/transcriber.js';
import { DETECTION_MODEL, TRANSCRIPTION_MODEL } from '../src/models.js';

test('LFM model constants are fixed to hackathon models', () => {
  assert.equal(TRANSCRIPTION_MODEL, 'LiquidAI/LFM2.5-Audio-1.5B-JP');
  assert.equal(DETECTION_MODEL, 'LiquidAI/LFM2.5-8B-A1B');
});

test('normalizeTranscription accepts common API response shapes', () => {
  assert.equal(normalizeTranscription({ text: '  テストです  ' }), 'テストです');
  assert.equal(normalizeTranscription({ generated_text: '音声結果' }), '音声結果');
  assert.equal(normalizeTranscription([{ text: '配列結果' }]), '配列結果');
});
