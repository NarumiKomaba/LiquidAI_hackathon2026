import { DEFAULT_TRANSCRIPTION_API_URL, TRANSCRIPTION_MODEL } from './models.js';

export async function transcribeAudio({ audioBase64, mimeType = 'audio/webm' }) {
  const token = process.env.TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY;

  if (!audioBase64) {
    throw new Error('audioBase64 is required');
  }

  if (!token) {
    throw new Error('OPENAI_API_KEY or TRANSCRIPTION_API_KEY is required for OpenAI audio transcription');
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const formData = new FormData();
  formData.append('model', process.env.TRANSCRIPTION_MODEL || TRANSCRIPTION_MODEL);
  formData.append('language', 'ja');
  formData.append('response_format', 'json');
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), `recording.${extensionForMimeType(mimeType)}`);

  const response = await fetch(process.env.TRANSCRIPTION_API_URL || DEFAULT_TRANSCRIPTION_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OpenAI transcription API responded with ${response.status}${details ? `: ${details.slice(0, 240)}` : ''}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  const text = normalizeTranscription(payload);

  return {
    model: process.env.TRANSCRIPTION_MODEL || TRANSCRIPTION_MODEL,
    text,
    raw: payload
  };
}

export function normalizeTranscription(payload) {
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload?.text === 'string') return payload.text.trim();
  if (typeof payload?.transcription === 'string') return payload.transcription.trim();
  if (Array.isArray(payload) && typeof payload[0]?.text === 'string') return payload[0].text.trim();
  if (typeof payload?.generated_text === 'string') return payload.generated_text.trim();
  return '';
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}
