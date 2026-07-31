import { SIGNAL_KEYS } from './signals.js';

/** 根拠テキストの最大長。UI のシグナルカードに収まる長さに合わせている。 */
export const MAX_EVIDENCE_TEXT_LENGTH = 180;

/**
 * Gemini が返した生の判定結果を、アプリ内で扱う正規形に揃える。
 *
 * 未知のキーは捨て、status が false の項目は text を空にする。
 * モデル出力を信用せずここで必ず形を整えるので、後段は欠損キーを気にしなくてよい。
 *
 * @param {unknown} analysis
 * @returns {Record<string, { status: boolean, text: string }>}
 */
export function normalizeAnalysis(analysis) {
  return Object.fromEntries(
    SIGNAL_KEYS.map((key) => {
      const item = analysis?.[key];
      const status = Boolean(item?.status);
      return [key, { status, text: status ? String(item?.text ?? '').slice(0, MAX_EVIDENCE_TEXT_LENGTH) : '' }];
    })
  );
}
