import { GoogleGenAI } from '@google/genai';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT } from './prompt.js';
import { normalizeAnalysis } from './analysis.js';
import { applyKeywordFloor } from './keywords.js';

/**
 * Vertex AI 上の Gemini を叩くための薄いラッパー。
 *
 * 認証は Application Default Credentials 経由なので、クライアント生成前に
 * GOOGLE_APPLICATION_CREDENTIALS（サービスアカウント JSON のパス）が
 * 環境変数に入っている必要がある。鍵の中身はコードでは一切扱わない。
 */

/**
 * Gemini クライアントを生成する。リクエスト間で使い回して問題ない。
 *
 * @param {{ GOOGLE_CLOUD_PROJECT: string, GOOGLE_CLOUD_LOCATION: string }} config
 */
export function createGeminiClient(config) {
  return new GoogleGenAI({
    vertexai: true,
    project: config.GOOGLE_CLOUD_PROJECT,
    location: config.GOOGLE_CLOUD_LOCATION
  });
}

/**
 * MediaRecorder が付ける `;codecs=opus` などのパラメータを落とす。
 * Gemini の inlineData はベースの MIME タイプしか受け付けない。
 *
 * @param {string} mimeType
 */
export function normalizeAudioMimeType(mimeType) {
  const base = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  return base || 'audio/webm';
}

/**
 * 音声チャンクを1回の Gemini 呼び出しで「文字起こし + 詐欺シグナル判定」に変換する。
 *
 * 文字起こしと判定を分けて2回呼ぶより、レイテンシもコストも半分で済む。
 * 出力は responseSchema で構造を強制しているが、モデルが空を返す可能性は残るため
 * 呼び出し側で扱いやすいよう normalizeAnalysis を通してから返す。
 *
 * @param {GoogleGenAI} client
 * @param {{ model: string, audioBase64: string, mimeType?: string }} params
 * @returns {Promise<{ transcript: string, analysis: Record<string, { status: boolean, text: string }> }>}
 */
export async function analyzeAudio(client, { model, audioBase64, mimeType }) {
  if (!audioBase64) {
    throw new Error('audioBase64 is required');
  }

  let response;
  try {
    response = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: normalizeAudioMimeType(mimeType), data: audioBase64 } }]
        }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA
      }
    });
  } catch (error) {
    // cause で元のエラー（HTTPステータスやクォータ情報）を残す。診断に必要。
    throw new Error(`Gemini API の呼び出しに失敗しました: ${error.message}`, { cause: error });
  }

  return parseAnalysisResponse(response?.text);
}

/**
 * Gemini のレスポンス本文（JSON 文字列）を transcript と analysis に分解する。
 *
 * responseSchema があってもモデルが空文字を返すことはあるため、
 * その場合は「聞き取れなかった」扱いにして落とさない。
 *
 * @param {string | undefined} text
 */
export function parseAnalysisResponse(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { transcript: '', analysis: normalizeAnalysis({}) };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Gemini が JSON 以外を返しました: ${text.slice(0, 200)}`);
  }

  const transcript = String(payload?.transcript ?? '').trim();

  return {
    transcript,
    // モデルが判定を抑え込まれた場合の保険として、キーワードによるフロアを重ねる
    analysis: applyKeywordFloor(transcript, normalizeAnalysis(payload))
  };
}
