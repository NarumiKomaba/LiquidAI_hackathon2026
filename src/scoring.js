import { SIGNALS, SIGNAL_KEYS } from './signals.js';

/** danger mode とカナリア音を鳴らす閾値。UI 側はこの判定結果(riskLevel.key)を使うこと。 */
export const DANGER_SCORE = 75;

/**
 * 会話全体のシグナルからスコアと危険度を組み立てる。
 *
 * 一度検知したシグナルはフル加点で保持し続ける(latch)。会話が進むほどスコアは
 * 上がり、下がらない。詐欺は世間話から入って後から本題に移るため、直近の発話だけを
 * 見ると危険度が下がってしまうのを防ぐ狙い。
 *
 * @param {Array<{ text: string, analysis: Record<string, { status: boolean, text: string }> }>} items
 */
export function scoreConversation(items) {
  const signalScores = Object.fromEntries(SIGNAL_KEYS.map((key) => [key, 0]));
  const evidence = Object.fromEntries(SIGNAL_KEYS.map((key) => [key, []]));

  items.forEach((item) => {
    for (const [key, signal] of Object.entries(SIGNALS)) {
      if (!item.analysis?.[key]?.status) continue;
      signalScores[key] = signal.weight;
      evidence[key].push({ text: item.analysis[key].text || item.text, utterance: item.text });
    }
  });

  const rawScore = Object.values(signalScores).reduce((sum, value) => sum + value, 0);
  const score = Math.min(100, rawScore + calculateSynergy(signalScores));

  return {
    score,
    riskLevel: getRiskLevel(score),
    signalScores,
    evidence,
    recommendations: getRecommendations(score)
  };
}

/**
 * 単体では弱くても組み合わさると危険な手口に追加点を与える。
 * 「口止め + 即時行動」「脅し + 資産確認」は典型的な詐欺の型。
 */
export function calculateSynergy(signalScores) {
  const activeCount = Object.values(signalScores).filter((score) => score > 0).length;
  let synergy = activeCount >= 3 ? 10 : activeCount >= 2 ? 5 : 0;

  if (signalScores.has_secrecy > 0 && signalScores.demand_action > 0) synergy += 8;
  if (signalScores.has_threat > 0 && signalScores.ask_financial > 0) synergy += 7;

  return synergy;
}

export function getRiskLevel(score) {
  if (score >= DANGER_SCORE) return { key: 'danger', label: '危険', message: '特殊詐欺の疑いが非常に高いです。通話を切り、家族や警察相談専用電話 #9110 に相談してください。' };
  if (score >= 50) return { key: 'warning', label: '警戒', message: '詐欺でよく使われる表現が複数あります。個人情報やお金の話は止めて第三者に確認してください。' };
  if (score >= 25) return { key: 'caution', label: '注意', message: '不審な要素があります。相手の所属・氏名・折り返し先を確認してください。' };
  return { key: 'safe', label: '低リスク', message: '現時点の発話だけでは強い詐欺兆候はありません。継続して確認します。' };
}

function getRecommendations(score) {
  if (score >= DANGER_SCORE) {
    return ['すぐに通話を終了する', 'お金・暗証番号・カード情報を伝えない', '警察相談専用電話 #9110 または家族に相談する'];
  }
  if (score >= 50) {
    return ['相手の指示に従わず一度電話を切る', '公式番号に自分でかけ直して確認する', '家族や信頼できる人に共有する'];
  }
  return ['会話内容を記録する', '急かされたら電話を切る', '不安なら第三者に相談する'];
}
