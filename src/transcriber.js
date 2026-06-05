import { DEFAULT_TRANSCRIPTION_API_URL, TRANSCRIPTION_MODEL } from './models.js';
import { assertTokenIfNeeded, buildInferenceHeaders, resolveInferenceAdapter } from './inferenceAdapters.js';

export async function transcribeAudio({ audioBase64, mimeType = 'audio/webm' }) {
  const token = process.env.HF_TOKEN || process.env.TRANSCRIPTION_API_KEY;
  const endpoint = process.env.TRANSCRIPTION_API_URL || DEFAULT_TRANSCRIPTION_API_URL;
  const model = process.env.TRANSCRIPTION_MODEL || TRANSCRIPTION_MODEL;
  const adapter = resolveInferenceAdapter({
    provider: process.env.TRANSCRIPTION_PROVIDER || process.env.INFERENCE_PROVIDER,
    url: endpoint
  });

  if (!audioBase64) {
    throw new Error('audioBase64 is required');
  }

  assertTokenIfNeeded({ adapter, token, label: 'TRANSCRIPTION' });

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildInferenceHeaders({
      adapter,
      token,
      contentType: mimeType,
      waitForModel: true,
      model
    }),
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
    adapter,
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
