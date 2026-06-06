import { LOCAL_TRANSCRIPTION_API_URL, TRANSCRIPTION_MODEL } from './models.js';

export async function transcribeAudio({ audioBase64, mimeType = 'audio/webm' }) {
  const endpoint = process.env.TRANSCRIPTION_API_URL || LOCAL_TRANSCRIPTION_API_URL;
  const model = process.env.TRANSCRIPTION_MODEL || TRANSCRIPTION_MODEL;

  if (!audioBase64) {
    throw new Error('audioBase64 is required');
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      'X-SAFi-Model': model
    },
    body: audioBuffer
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`LFM2.5-Audio-JP transcription API responded with ${response.status}${details ? `: ${details.slice(0, 240)}` : ''}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  const text = normalizeTranscription(payload);

  return {
    model,
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
