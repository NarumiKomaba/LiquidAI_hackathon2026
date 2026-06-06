import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscription } from '../src/transcriber.js';
import {
  DETECTION_MODEL,
  LOCAL_DETECTION_API_URL,
  LOCAL_TRANSCRIPTION_API_URL,
  TRANSCRIPTION_MODEL
} from '../src/models.js';

test('LFM model constants are fixed to hackathon models', () => {
  assert.equal(TRANSCRIPTION_MODEL, 'LiquidAI/LFM2.5-Audio-1.5B-JP');
  assert.equal(DETECTION_MODEL, TRANSCRIPTION_MODEL);
});

test('local inference URLs default to the downloaded model server', () => {
  assert.equal(LOCAL_TRANSCRIPTION_API_URL, 'http://localhost:8088/transcribe');
  assert.equal(LOCAL_DETECTION_API_URL, 'http://localhost:8088/v1/chat/completions');
});

test('normalizeTranscription accepts common API response shapes', () => {
  assert.equal(normalizeTranscription({ text: '  テストです  ' }), 'テストです');
  assert.equal(normalizeTranscription({ generated_text: '音声結果' }), '音声結果');
  assert.equal(normalizeTranscription([{ text: '配列結果' }]), '配列結果');
});
