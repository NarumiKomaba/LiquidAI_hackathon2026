import { z } from 'zod';

/**
 * HTTP リクエストボディの検証スキーマ。
 *
 * ここを緩めると、音声以外のデータを Gemini に投げる汎用プロキシとして
 * 悪用できてしまうため（課金はこちら持ち）、型・形式・種別まで絞る。
 */

/** Gemini の inlineData に渡してよい音声形式。ブラウザの MediaRecorder が出す範囲に限定する。 */
const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

/** base64 は元データの約4/3。ボディ上限(12MB)に収まる範囲で切る。 */
const MAX_AUDIO_BASE64_CHARS = 10_000_000;

/**
 * セッションIDは UUID 限定。
 * セッションの分離は「他人のIDを推測できないこと」に依存しているので、
 * 短いIDや連番を受け付けてしまうとその前提が崩れる。
 */
const sessionIdSchema = z.uuid();

export const analyzeSchema = z.object({
  sessionId: sessionIdSchema,
  audioBase64: z
    .string()
    .min(1)
    .max(MAX_AUDIO_BASE64_CHARS)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'audioBase64 must be base64'),
  mimeType: z
    .string()
    .max(100)
    .optional()
    // MediaRecorder が付ける `;codecs=opus` を落としてから種別を照合する
    .transform((value) => String(value ?? 'audio/webm').split(';')[0].trim().toLowerCase())
    .refine((value) => ALLOWED_AUDIO_MIME.includes(value), 'unsupported audio type')
});

export const resetSchema = z.object({
  sessionId: sessionIdSchema
});

/** zod のエラーを利用者向けの1行メッセージにする。値そのものは載せない。 */
export function describeValidationError(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join(', ');
  }
  return 'リクエスト形式が不正です。';
}
