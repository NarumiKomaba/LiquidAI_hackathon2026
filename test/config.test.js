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

// Cloud Run ではメタデータサーバーが認証情報を供給するので鍵ファイルは要らない。
// K_SERVICE は Cloud Run が自動で入れる。
test('the credentials file is not required on Cloud Run', () => {
  const config = loadConfig({ GOOGLE_CLOUD_PROJECT: 'test-project', K_SERVICE: 'safi' });

  assert.equal(config.onCloudRun, true);
  assert.equal(config.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});

// 0.0.0.0 で待たないと Cloud Run のリクエストがコンテナに届かない
test('Cloud Run binds all interfaces while local runs stay on loopback', () => {
  assert.equal(loadConfig({ GOOGLE_CLOUD_PROJECT: 'p', K_SERVICE: 'safi' }).HOST, '0.0.0.0');
  assert.equal(loadConfig(validSource).HOST, '127.0.0.1');
  assert.equal(loadConfig({ ...validSource, HOST: '10.0.0.1' }).HOST, '10.0.0.1', '明示指定が最優先');
});

test('rate limit settings fall back to demo-safe defaults', () => {
  const config = loadConfig(validSource);

  assert.equal(config.RATE_LIMIT_PER_IP, 20);
  assert.equal(config.RATE_LIMIT_GLOBAL, 60);
  assert.equal(config.DAILY_REQUEST_LIMIT, 2000);
});

test('rate limits can be tightened from the environment', () => {
  const config = loadConfig({ ...validSource, RATE_LIMIT_PER_IP: '5', DAILY_REQUEST_LIMIT: '100' });

  assert.equal(config.RATE_LIMIT_PER_IP, 5);
  assert.equal(config.DAILY_REQUEST_LIMIT, 100);
});

test('loadConfig rejects an out-of-range port', () => {
  assert.throws(() => loadConfig({ ...validSource, PORT: '70000' }), /PORT/);
});
