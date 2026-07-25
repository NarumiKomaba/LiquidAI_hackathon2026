import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const validSource = {
  GOOGLE_CLOUD_PROJECT: 'test-project',
  GOOGLE_APPLICATION_CREDENTIALS: '/path/to/key.json'
};

test('loadConfig fills in Vertex AI defaults', () => {
  const config = loadConfig(validSource);

  assert.equal(config.GOOGLE_CLOUD_LOCATION, 'asia-northeast1');
  assert.equal(config.GEMINI_MODEL, 'gemini-2.5-flash');
  assert.equal(config.PORT, 3000);
});

// 既定で全インターフェースに bind すると、同一ネットワークの誰でも
// 認証なしで Gemini を呼べてしまう（課金はこちら持ち）
test('loadConfig binds to loopback unless told otherwise', () => {
  assert.equal(loadConfig(validSource).HOST, '127.0.0.1');
  assert.equal(loadConfig({ ...validSource, HOST: '0.0.0.0' }).HOST, '0.0.0.0');
});

test('loadConfig keeps explicit overrides', () => {
  const config = loadConfig({ ...validSource, GEMINI_MODEL: 'gemini-2.5-pro', PORT: '8080' });

  assert.equal(config.GEMINI_MODEL, 'gemini-2.5-pro');
  assert.equal(config.PORT, 8080);
});

test('loadConfig reports every missing credential at once', () => {
  assert.throws(
    () => loadConfig({}),
    (error) => {
      assert.match(error.message, /GOOGLE_CLOUD_PROJECT/);
      assert.match(error.message, /GOOGLE_APPLICATION_CREDENTIALS/);
      return true;
    }
  );
});

test('loadConfig rejects an out-of-range port', () => {
  assert.throws(() => loadConfig({ ...validSource, PORT: '70000' }), /PORT/);
});
