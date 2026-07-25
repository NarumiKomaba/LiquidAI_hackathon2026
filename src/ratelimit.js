/**
 * 単純なトークンバケット風のレート制限。
 *
 * /api/analyze は1リクエストごとに Vertex AI の課金が発生するため、認証の無い
 * デモ環境でも「誰かが回し続けたら青天井」にならないようにする。
 * IP 単位と全体の2段で止める。
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_IP = 30;
const DEFAULT_MAX_GLOBAL = 200;

/**
 * @param {{ windowMs?: number, maxPerIp?: number, maxGlobal?: number, now?: () => number }} [options]
 * @returns {(ip: string) => boolean} 通してよければ true
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    maxPerIp = DEFAULT_MAX_PER_IP,
    maxGlobal = DEFAULT_MAX_GLOBAL,
    now = () => Date.now()
  } = options;

  let hits = new Map();
  let globalCount = 0;
  let windowStart = now();

  return function allowRequest(ip) {
    const current = now();
    if (current - windowStart > windowMs) {
      hits = new Map();
      globalCount = 0;
      windowStart = current;
    }

    globalCount += 1;
    if (globalCount > maxGlobal) return false;

    const count = (hits.get(ip) ?? 0) + 1;
    hits.set(ip, count);
    return count <= maxPerIp;
  };
}
