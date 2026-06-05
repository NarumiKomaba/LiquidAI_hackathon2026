import http from 'node:http';
import { localAnalyze } from '../src/detector.js';

const port = process.env.LOCAL_INFERENCE_PORT || 8088;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'SAFi local inference mock' });
    }

    if (req.method === 'POST' && url.pathname === '/transcribe') {
      await readBody(req);
      return sendJson(res, 200, {
        model: req.headers['x-safi-model'] ?? 'local-lfm2.5-audio-mock',
        text: process.env.MOCK_TRANSCRIPT || '〇〇警察の生活安全課です。捜査は秘密なので誰にも言わないでください。'
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readJson(req);
      const latestText = body?.messages?.filter((message) => message.role === 'user').at(-1)?.content ?? '';
      const analysis = localAnalyze(latestText);
      return sendJson(res, 200, {
        id: 'safi-local-mock',
        object: 'chat.completion',
        model: body?.model ?? 'local-lfm2.5-mock',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(analysis)
            },
            finish_reason: 'stop'
          }
        ]
      });
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'internal_error', message: error.message });
  }
});

server.listen(port, () => {
  console.log(`SAFi local inference mock is running at http://localhost:${port}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buffer = await readBody(req);
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString('utf8'));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
