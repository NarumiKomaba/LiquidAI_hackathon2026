import { DEFAULT_DETECTION_API_URL, DETECTION_MODEL } from './models.js';

export const SIGNALS = {
  is_authority: {
    label: '公的機関・権威の名乗り',
    weight: 18,
    keywords: ['警察', '生活安全課', '検察', '裁判所', '金融庁', '市役所', '役所', '銀行協会', '税務署']
  },
  has_threat: {
    label: '脅し・不安喚起',
    weight: 24,
    keywords: ['疑われ', '逮捕', '犯罪', '容疑', '凍結', '差し押さえ', '危険', '被害届', '訴訟']
  },
  has_secrecy: {
    label: '口止め・秘密指示',
    weight: 22,
    keywords: ['誰にも言わない', '秘密', '内密', '家族に言わ', '口外', '他の人に話さ', '捜査上']
  },
  ask_financial: {
    label: '資産・口座情報の確認',
    weight: 18,
    keywords: ['残高', '口座番号', '暗証番号', 'キャッシュカード', '預金', '資産', '通帳', 'カード番号']
  },
  demand_action: {
    label: '即時行動の要求',
    weight: 18,
    keywords: ['今すぐ', 'ATM', '振り込', '送金', 'コンビニ', '電子マネー', 'ギフトカード', '受け取りに行', '手続きして']
  }
};

const EMPTY_ANALYSIS = Object.fromEntries(
  Object.keys(SIGNALS).map((key) => [key, { status: false, text: '' }])
);

export async function analyzeUtterance(text, options = {}) {
  const token = process.env.DETECTOR_API_KEY || process.env.OPENAI_API_KEY;
  if (!options.forceLocal && token) {
    try {
      return normalizeAnalysis(await analyzeWithOpenAI(text, token));
    } catch (error) {
      console.warn(`LLM detector failed; falling back to local rules: ${error.message}`);
    }
  }

  return localAnalyze(text);
}

async function analyzeWithOpenAI(text, token) {
  const schemaInstruction = `あなたは電話特殊詐欺のリアルタイム検知器です。入力発話を評価し、必ず次のJSONだけを返してください。該当しない項目はstatusをfalse、textを空文字にしてください。キーは is_authority, has_threat, has_secrecy, ask_financial, demand_action です。形式例: {"is_authority":{"status":true,"text":"〇〇警察の生活安全課です"},"has_threat":{"status":true,"text":"あなたも疑われています"},"has_secrecy":{"status":true,"text":"捜査は秘密なので誰にも言わないで"},"ask_financial":{"status":true,"text":"今の残高はいくらですか"},"demand_action":{"status":true,"text":"今すぐATMにいけ"}}`;

  const response = await fetch(process.env.DETECTOR_API_URL || DEFAULT_DETECTION_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.DETECTOR_MODEL || DETECTION_MODEL,
      messages: [
        { role: 'system', content: schemaInstruction },
        { role: 'user', content: text }
      ],
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'fraud_signal_analysis',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['is_authority', 'has_threat', 'has_secrecy', 'ask_financial', 'demand_action'],
            properties: Object.fromEntries(
              Object.keys(SIGNALS).map((key) => [key, {
                type: 'object',
                additionalProperties: false,
                required: ['status', 'text'],
                properties: {
                  status: { type: 'boolean' },
                  text: { type: 'string' }
                }
              }])
            )
          }
        }
      }
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OpenAI detector API responded with ${response.status}${details ? `: ${details.slice(0, 240)}` : ''}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content ?? payload.output_text ?? JSON.stringify(payload);
  return typeof content === 'string' ? JSON.parse(content) : content;
}

export function localAnalyze(text) {
  const normalized = String(text ?? '').replace(/\s+/g, '');
  const result = structuredClone(EMPTY_ANALYSIS);

  for (const [key, signal] of Object.entries(SIGNALS)) {
    const found = signal.keywords.find((keyword) => normalized.includes(keyword.replace(/\s+/g, '')));
    if (found) {
      result[key] = { status: true, text: extractEvidence(text, found) };
    }
  }

  return result;
}

function extractEvidence(text, keyword) {
  const source = String(text ?? '');
  const index = source.indexOf(keyword);
  if (index < 0) return source.slice(0, 80);
  return source.slice(Math.max(0, index - 18), Math.min(source.length, index + keyword.length + 36));
}

export function normalizeAnalysis(analysis) {
  const normalized = structuredClone(EMPTY_ANALYSIS);

  for (const key of Object.keys(SIGNALS)) {
    const item = analysis?.[key];
    normalized[key] = {
      status: Boolean(item?.status),
      text: item?.status ? String(item?.text ?? '').slice(0, 180) : ''
    };
  }

  return normalized;
}

export function scoreConversation(items) {
  const recentItems = items.slice(-5);
  const signalScores = Object.fromEntries(Object.keys(SIGNALS).map((key) => [key, 0]));
  const evidence = Object.fromEntries(Object.keys(SIGNALS).map((key) => [key, []]));

  recentItems.forEach((item, index) => {
    const recencyMultiplier = 0.72 + ((index + 1) / recentItems.length) * 0.28;
    const analysis = item.analysis;

    for (const [key, signal] of Object.entries(SIGNALS)) {
      if (analysis?.[key]?.status) {
        signalScores[key] = Math.max(signalScores[key], Math.round(signal.weight * recencyMultiplier));
        evidence[key].push({ text: analysis[key].text || item.text, utterance: item.text });
      }
    }
  });

  const rawScore = Object.values(signalScores).reduce((sum, value) => sum + value, 0);
  const synergy = calculateSynergy(signalScores);
  const score = Math.min(100, rawScore + synergy);

  return {
    score,
    riskLevel: getRiskLevel(score),
    signalScores,
    evidence,
    recommendations: getRecommendations(score)
  };
}

function calculateSynergy(signalScores) {
  const activeCount = Object.values(signalScores).filter((score) => score > 0).length;
  let synergy = activeCount >= 3 ? 10 : activeCount >= 2 ? 5 : 0;

  if (signalScores.has_secrecy > 0 && signalScores.demand_action > 0) synergy += 8;
  if (signalScores.has_threat > 0 && signalScores.ask_financial > 0) synergy += 7;

  return synergy;
}

export function getRiskLevel(score) {
  if (score >= 75) return { key: 'danger', label: '危険', message: '特殊詐欺の疑いが非常に高いです。通話を切り、家族や警察相談専用電話 #9110 に相談してください。' };
  if (score >= 50) return { key: 'warning', label: '警戒', message: '詐欺でよく使われる表現が複数あります。個人情報やお金の話は止めて第三者に確認してください。' };
  if (score >= 25) return { key: 'caution', label: '注意', message: '不審な要素があります。相手の所属・氏名・折り返し先を確認してください。' };
  return { key: 'safe', label: '低リスク', message: '現時点の発話だけでは強い詐欺兆候はありません。継続して確認します。' };
}

function getRecommendations(score) {
  if (score >= 75) {
    return ['すぐに通話を終了する', 'お金・暗証番号・カード情報を伝えない', '警察相談専用電話 #9110 または家族に相談する'];
  }
  if (score >= 50) {
    return ['相手の指示に従わず一度電話を切る', '公式番号に自分でかけ直して確認する', '家族や信頼できる人に共有する'];
  }
  return ['会話内容を記録する', '急かされたら電話を切る', '不安なら第三者に相談する'];
}
