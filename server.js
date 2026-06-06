import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeUtterance, scoreConversation } from './src/detector.js';
import { DETECTION_MODEL, TRANSCRIPTION_MODEL } from './src/models.js';
import { transcribeAudio } from './src/transcriber.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const port = process.env.PORT || 3000;

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav']
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'SAFi', models: { transcription: TRANSCRIPTION_MODEL, detection: DETECTION_MODEL } });
    }

    if (req.method === 'POST' && url.pathname === '/api/transcribe') {
      return handleTranscribe(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      return handleAnalyze(req, res);
    }

    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'internal_error', message: error.message });
  }
});

server.listen(port, () => {
  console.log(`SAFi is running at http://localhost:${port}`);
});

async function handleAnalyze(req, res) {
  try {
    const body = await readJsonBody(req);
    const utterances = Array.isArray(body?.utterances) ? body.utterances : [];
    // latch スコアリングのため会話全体を渡す（過去に立ったシグナルも保持される）
    const cleanUtterances = utterances
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);

    if (cleanUtterances.length === 0) {
      return sendJson(res, 400, { error: 'utterances must contain at least one text item' });
    }

    const analyzedUtterances = await Promise.all(
      cleanUtterances.map(async (text) => ({ text, analysis: await analyzeUtterance(text) }))
    );
    const latest = analyzedUtterances.at(-1);
    const scored = scoreConversation(analyzedUtterances);

    sendJson(res, 200, {
      app: 'SAFi',
      windowSize: cleanUtterances.length,
      latest: {
        text: latest.text,
        analysis: latest.analysis
      },
      ...scored
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'analysis_failed', message: error.message });
  }
}

async function handleTranscribe(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await transcribeAudio({
      audioBase64: body?.audioBase64,
      mimeType: body?.mimeType
    });

    sendJson(res, 200, {
      app: 'SAFi',
      model: result.model,
      text: result.text
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'transcription_failed', message: error.message });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 12_000_000) {
        req.destroy();
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const decodedPath = decodeURIComponent(normalizedPath);
  const candidatePath = path.normalize(path.join(publicDir, decodedPath));

  const relativePath = path.relative(publicDir, candidatePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }

  try {
    const content = await fs.readFile(candidatePath);
    const contentType = mimeTypes.get(path.extname(candidatePath)) ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'not_found' });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
