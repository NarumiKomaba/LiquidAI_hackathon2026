import { z } from 'zod';

/**
 * アプリの環境変数スキーマ。
 *
 * loadConfig は純粋関数で、process.env を直接触らず引数の source だけを見る。
 * テストから任意のオブジェクトを渡せるようにするためで、参照実装と同じ方針。
 */
const configSchema = z
  .object({
    GOOGLE_CLOUD_PROJECT: z.string().min(1, 'GOOGLE_CLOUD_PROJECT is required'),
    // Cloud Run 上ではメタデータサーバーが認証情報を供給するため不要。
    // ローカル実行のときだけ必須で、その判定は下の superRefine で行う。
    GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
    GOOGLE_CLOUD_LOCATION: z.string().min(1).default('asia-northeast1'),
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // 既定はループバック。同一ネットワークの他端末から Gemini 課金を叩かれないようにする。
    // Cloud Run では 0.0.0.0 でないとヘルスチェックが通らないので、下で既定を差し替える。
    HOST: z.string().min(1).optional(),

    // レート制限。公開URLで運用する場合は、この3つが Gemini 課金の唯一の歯止めになる。
    RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_GLOBAL: z.coerce.number().int().min(1).default(60),
    // 1日あたりの総リクエスト上限。レート制限は速度しか抑えないので、総額はこれで止める。
    // 4.5秒チャンクなので 2000 ≒ 通話150分ぶん。
    DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).default(2000),

    // Cloud Run が自動で入れる環境変数。存在すればマネージド環境だと判断する。
    K_SERVICE: z.string().optional()
  })
  .transform((value) => ({
    ...value,
    onCloudRun: Boolean(value.K_SERVICE),
    // Cloud Run のコンテナは 0.0.0.0 で待たないとリクエストが届かない。
    // コンテナのポートは Cloud Run のフロントエンド経由でしか到達できないため、
    // ローカルで 0.0.0.0 に開くのとは危険度が違う。
    HOST: value.HOST ?? (value.K_SERVICE ? '0.0.0.0' : '127.0.0.1')
  }));

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

  // 鍵ファイルの要否はスキーマ内の refine では判定しない。
  // zod は base の検証が失敗すると refine を飛ばすため、他の項目も欠けている場合に
  // この指摘だけ黙って消えてしまい「不足を一度に全部出す」という狙いが崩れる。
  const credentialIssues =
    !source?.GOOGLE_APPLICATION_CREDENTIALS && !source?.K_SERVICE
      ? ['  - GOOGLE_APPLICATION_CREDENTIALS: required outside Cloud Run']
      : [];

  if (result.success && credentialIssues.length === 0) {
    return result.data;
  }

  const schemaIssues = result.success
    ? []
    : result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  const issues = [...schemaIssues, ...credentialIssues];

  throw new Error(
    [
      'SAFi の環境変数が不正です。.env.local を確認してください:',
      ...issues,
      '',
      'ヒント: .env.example をコピーして .env.local を作成し、`npm start` で読み込まれます。'
    ].join('\n')
  );
}
