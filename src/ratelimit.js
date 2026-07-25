/**
 * 単純なトークンバケット風のレート制限。
 *
 * /api/analyze は1リクエストごとに Vertex AI の課金が発生するため、認証の無い
 * デモ環境でも「誰かが回し続けたら青天井」にならないようにする。
 * IP 単位と全体の2段で止める。
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_IP = 20;
const DEFAULT_MAX_GLOBAL = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 2000;

/**
 * @param {{ windowMs?: number, maxPerIp?: number, maxGlobal?: number, dailyLimit?: number, now?: () => number }} [options]
 * @returns {(ip: string) => { allowed: boolean, reason?: 'per_ip' | 'global' | 'daily' }}
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    maxPerIp = DEFAULT_MAX_PER_IP,
    maxGlobal = DEFAULT_MAX_GLOBAL,
    dailyLimit = DEFAULT_DAILY_LIMIT,
    now = () => Date.now()
  } = options;

  let hits = new Map();
  let globalCount = 0;
  let windowStart = now();
  let dailyCount = 0;
  let dayStart = now();

  return function allowRequest(ip) {
    const current = now();

    if (current - dayStart > DAY_MS) {
      dailyCount = 0;
      dayStart = current;
    }
    if (current - windowStart > windowMs) {
      hits = new Map();
      globalCount = 0;
      windowStart = current;
    }

    // 1日の総量は Vertex AI の総額に直結する。分単位の制限とは別枠で先に見る。
    dailyCount += 1;
    if (dailyCount > dailyLimit) return { allowed: false, reason: 'daily' };

    globalCount += 1;
    if (globalCount > maxGlobal) return { allowed: false, reason: 'global' };

    const count = (hits.get(ip) ?? 0) + 1;
    hits.set(ip, count);
    if (count > maxPerIp) return { allowed: false, reason: 'per_ip' };

    return { allowed: true };
  };
}
