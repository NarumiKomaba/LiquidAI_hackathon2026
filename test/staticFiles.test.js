import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { contentTypeFor, resolveStaticPath } from '../src/staticFiles.js';

const publicDir = path.resolve('/srv/app/public');

test('the site root resolves to index.html', () => {
  const result = resolveStaticPath(publicDir, '/');

  assert.equal(result.ok, true);
  assert.equal(path.basename(result.filePath), 'index.html');
});

// これはクラッシュ回帰テスト。以前は decodeURIComponent の URIError がハンドラの外へ抜け、
// `curl http://host:3000/%` の一発でプロセスが落ちていた。
test('malformed percent-encoding is rejected instead of throwing', () => {
  for (const requestPath of ['/%', '/%zz', '/assets/%E0%A4%A']) {
    const result = resolveStaticPath(publicDir, requestPath);

    assert.equal(result.ok, false, `${requestPath} は拒否されるべき`);
    assert.equal(result.status, 400);
  }
});

test('path traversal is refused in every encoding', () => {
  for (const requestPath of ['/../server.js', '/../../etc/passwd', '/..%2f..%2fserver.js', '/assets/../../server.js']) {
    const result = resolveStaticPath(publicDir, requestPath);

    assert.equal(result.ok, false, `${requestPath} は拒否されるべき`);
    assert.equal(result.status, 403);
  }
});

test('a null byte is refused before it reaches the filesystem', () => {
  const result = resolveStaticPath(publicDir, '/index.html%00.png');

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('double encoding does not become a traversal', () => {
  const result = resolveStaticPath(publicDir, '/%252e%252e/server.js');

  // 1回だけデコードするので "%2e%2e" という普通のファイル名になり、外へは出ない
  assert.equal(result.ok, true);
  assert.equal(result.filePath.startsWith(publicDir), true);
});

test('legitimate asset paths resolve inside the public directory', () => {
  const result = resolveStaticPath(publicDir, '/assets/canary.mp3');

  assert.equal(result.ok, true);
  assert.equal(result.filePath.startsWith(publicDir), true);
});

test('contentTypeFor maps known extensions and falls back safely', () => {
  assert.equal(contentTypeFor('/x/app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('/x/canary.mp3'), 'audio/mpeg');
  assert.equal(contentTypeFor('/x/unknown.bin'), 'application/octet-stream');
});
