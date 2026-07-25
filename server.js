import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { createConversationStore } from './src/conversation.js';
import { createRateLimiter } from './src/ratelimit.js';
import { scoreConversation } from './src/scoring.js';
import { SIGNAL_DESCRIPTORS } from './src/signals.js';
import { analyzeAudio, createGeminiClient } from './src/gemini.js';
import { analyzeSchema, describeValidationError, resetSchema } from './src/requestSchemas.js';
import { contentTypeFor, resolveStaticPath } from './src/staticFiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

// .env.local があれば process.env に流し込む。GOOGLE_APPLICATION_CREDENTIALS は
// Gemini クライアント生成前に環境変数へ入っている必要があるのでここで読む。
const envFile = path.join(__dirname, '.env.local');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    throw new Error(`.env.local を読み込めませんでした（書式を確認してください）: ${error.message}`, { cause: error });
  }
}

const config = loadConfig(process.env);
const gemini = createGeminiClient(config);
const conversations = createConversationStore();
const allowRequest = createRateLimiter({
  maxPerIp: config.RATE_LIMIT_PER_IP,
  maxGlobal: config.RATE_LIMIT_GLOBAL,
  dailyLimit: config.DAILY_REQUEST_LIMIT
});

// 1リクエストのハンドリングが漏らした例外でプロセスごと落ちないようにする最終防衛線
process.on('unhandledRejection', (error) => console.error('unhandledRejection:', error));

const MAX_BODY_BYTES = 12_000_000;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'SAFi' });
    }

    if (req.method === 'GET' && url.pathname === '/api/signals') {
      return sendJson(res, 200, { signals: SIGNAL_DESCRIPTORS });
    }

    // await を付けないと、ハンドラ内の非同期例外が下の catch に入らずプロセスを落とす
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      return await handleAnalyze(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      return await handleReset(req, res);
    }

    if (req.method === 'GET') {
      return await serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    console.error('unhandled request error:', error);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// 既定はループバックのみ。同一ネットワークの他端末から Gemini 課金を叩かれるのを防ぐ。
server.listen(config.PORT, config.HOST, () => {
  console.log(`SAFi is running at http://${config.HOST}:${config.PORT} (model: ${config.GEMINI_MODEL})`);
});

/**
 * 音声チャンクを1回の Gemini 呼び出しで文字起こし＋詐欺判定し、
 * セッションの会話全体を latch スコアリングして返す。
 */
async function handleAnalyze(req, res) {
  if (!enforceRequestGuards(req, res)) return;

  let input;
  try {
    input = analyzeSchema.parse(await readJsonBody(req));
  } catch (error) {
    return sendRequestError(res, error);
  }

  try {
    const { transcript, analysis } = await analyzeAudio(gemini, {
      model: config.GEMINI_MODEL,
      audioBase64: input.audioBase64,
      mimeType: input.mimeType
    });

    // 無音や聞き取れない断片は履歴に積まない。空行がログに並ぶのを防ぐ。
    // このときシグナルは全て false になる前提（prompt.js でそう指示している）。
    const silent = transcript === '';
    const items = silent
      ? conversations.get(input.sessionId)
      : conversations.append(input.sessionId, { text: transcript, analysis });

    sendJson(res, 200, {
      app: 'SAFi',
      utteranceCount: items.length,
      latest: silent ? null : { text: transcript, analysis },
      ...scoreConversation(items)
    });
  } catch (error) {
    console.error('analysis failed:', error);
    sendJson(res, 502, { error: 'analysis_failed', message: '音声の解析に失敗しました。時間をおいて再度お試しください。' });
  }
}

/** 通話終了時にセッションの履歴を破棄する。 */
async function handleReset(req, res) {
  if (!enforceRequestGuards(req, res)) return;

  try {
    const input = resetSchema.parse(await readJsonBody(req));
    conversations.reset(input.sessionId);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendRequestError(res, error);
  }
}

/**
 * JSON API 共通の入口チェック。
 *
 * Content-Type を application/json に限定すると、クロスオリジンからの呼び出しは
 * CORS プリフライトが必要になる。こちらは Access-Control-Allow-Origin を返さないので
 * プリフライトが失敗し、悪意あるページからの CSRF 的な呼び出しが通らなくなる。
 */
function enforceRequestGuards(req, res) {
  // Cloud Run ではクライアントIPが X-Forwarded-For の先頭に入る。
  // socket のアドレスはロードバランサのものなので、それだけ見ると全員が同一IP扱いになる。
  const ip = clientIpOf(req);
  const verdict = allowRequest(ip);
  if (!verdict.allowed) {
    console.warn(`rate limit exceeded (${verdict.reason}):`, ip);
    sendJson(res, 429, { error: 'too_many_requests', reason: verdict.reason });
    return false;
  }

  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendJson(res, 415, { error: 'unsupported_media_type' });
    return false;
  }

  if (!isSameOrigin(req)) {
    console.warn('cross-origin request rejected:', req.headers.origin);
    sendJson(res, 403, { error: 'forbidden' });
    return false;
  }

  return true;
}

/**
 * レート制限のキーに使うクライアントIP。
 *
 * Cloud Run の前段には常にロードバランサが入るため、X-Forwarded-For の先頭を採る。
 * ローカル実行時はこのヘッダが無いのでソケットのアドレスにフォールバックする。
 * ヘッダは詐称できるが、詐称されて困るのは IP 単位の制限だけで、全体・日次の上限は効く。
 */
function clientIpOf(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

/** 同一オリジンからの fetch は Origin を送らないことがあるので、無い場合は許可する。 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function sendRequestError(res, error) {
  if (error?.message === 'request body too large') {
    return sendJson(res, 413, { error: 'payload_too_large' });
  }
  sendJson(res, 400, { error: 'invalid_request', message: describeValidationError(error) });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;

    // setEncoding は付けない。文字数ではなく実バイト数で上限を測るため。
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('aborted', () => reject(new Error('request aborted')));
    req.on('error', reject);
  });
}

async function serveStatic(requestPath, res) {
  const resolved = resolveStaticPath(publicDir, requestPath);
  if (!resolved.ok) {
    return sendJson(res, resolved.status, { error: resolved.error });
  }

  try {
    const content = await fs.readFile(resolved.filePath);
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentTypeFor(resolved.filePath) });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'not_found' });
  }
}

/** 二重送信しても落ちないようにする。エラー処理中の再送で ERR_HTTP_HEADERS_SENT を出さないため。 */
function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
