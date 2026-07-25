/**
 * 検知対象の詐欺シグナル定義。
 *
 * ここが唯一の定義元。Gemini のシステム指示 (prompt.js)、レスポンススキーマ、
 * スコアリング (scoring.js)、UI のカード見出しは、すべてこの表から生成する。
 * シグナルを増減させるときに触るのはこのファイルだけで済むようにしてある。
 *
 * - label: プロンプト中でモデルに示す正式名称
 * - shortLabel: 画面のカード見出し（幅が狭いので短く）
 * - criteria: モデルに渡す判定基準。具体例を含めて誤検知を抑える
 * - weight: latch スコアの配点
 */
export const SIGNALS = {
  is_authority: {
    label: '公的機関・権威の名乗り',
    shortLabel: '権威の名乗り',
    criteria: '警察・検察・金融庁・銀行・自治体・大手企業などを名乗る。',
    weight: 18
  },
  has_threat: {
    label: '脅し・不安喚起',
    shortLabel: '脅し',
    criteria: '逮捕・口座凍結・犯罪関与・訴訟などで相手を不安にさせる。',
    weight: 24
  },
  has_secrecy: {
    label: '口止め・秘密指示',
    shortLabel: '秘密指示',
    criteria: '家族や第三者に相談・他言しないよう求める。',
    weight: 22
  },
  ask_financial: {
    label: '資産・口座情報の確認',
    shortLabel: '資産確認',
    criteria: '残高・口座番号・暗証番号・カード情報などを尋ねる。',
    weight: 18
  },
  demand_action: {
    label: '即時行動の要求',
    shortLabel: '即時行動要求',
    criteria: 'ATM操作・送金・電子マネー購入などを急がせる。',
    weight: 18
  }
};

export const SIGNAL_KEYS = Object.keys(SIGNALS);

/** 画面がカードを描くのに必要な最小限の情報。API から配信する。 */
export const SIGNAL_DESCRIPTORS = SIGNAL_KEYS.map((key) => ({
  key,
  label: SIGNALS[key].shortLabel,
  weight: SIGNALS[key].weight
}));
