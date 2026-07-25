import { z } from 'zod';

/**
 * アプリの環境変数スキーマ。
 *
 * loadConfig は純粋関数で、process.env を直接触らず引数の source だけを見る。
 * テストから任意のオブジェクトを渡せるようにするためで、参照実装と同じ方針。
 */
const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1, 'GOOGLE_CLOUD_PROJECT is required'),
  GOOGLE_APPLICATION_CREDENTIALS: z
    .string()
    .min(1, 'GOOGLE_APPLICATION_CREDENTIALS is required'),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default('asia-northeast1'),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // 既定はループバック。同一ネットワークの他端末から Gemini 課金を叩かれないようにする。
  // 別端末から見せたい場合だけ 0.0.0.0 を明示する。
  HOST: z.string().min(1).default('127.0.0.1')
});

/** @typedef {z.infer<typeof configSchema>} AppConfig */

/**
 * 環境変数を検証して設定オブジェクトを返す。
 *
 * 必須項目が欠けている場合は、どの変数が足りないかを列挙したエラーを投げる。
 * 起動時に一度だけ呼び、以降は戻り値を使い回す。
 *
 * @param {Record<string, string | undefined>} source - process.env 相当のオブジェクト
 * @returns {AppConfig}
 */
export function loadConfig(source) {
  const result = configSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    [
      'SAFi の環境変数が不正です。.env.local を確認してください:',
      ...issues,
      '',
      'ヒント: .env.example をコピーして .env.local を作成し、`npm start` で読み込まれます。'
    ].join('\n')
  );
}
