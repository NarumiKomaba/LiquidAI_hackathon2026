import path from 'node:path';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav']
]);

export function contentTypeFor(filePath) {
  return MIME_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream';
}

/**
 * リクエストパスを public 配下の実ファイルパスに解決する。
 *
 * I/O を含まない純粋関数にしてあるのは、パストラバーサルと壊れたエンコーディングの
 * 扱いがサーバーを起動しなくてもテストできるようにするため。
 *
 * @param {string} publicDir 配信ルート（絶対パス）
 * @param {string} requestPath URL のパス部分
 * @returns {{ ok: true, filePath: string } | { ok: false, status: number, error: string }}
 */
export function resolveStaticPath(publicDir, requestPath) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;

  // 壊れたパーセントエンコーディング（例: "/%"）は decodeURIComponent が URIError を投げる。
  // ここで捕まえないとリクエストハンドラの外まで例外が飛び、プロセスごと落ちる。
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(normalizedPath);
  } catch {
    return { ok: false, status: 400, error: 'bad_request' };
  }

  // ヌルバイトはファイル API に渡す前に弾く
  if (decodedPath.includes('\0')) {
    return { ok: false, status: 400, error: 'bad_request' };
  }

  const filePath = path.normalize(path.join(publicDir, decodedPath));
  const relativePath = path.relative(publicDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  return { ok: true, filePath };
}
