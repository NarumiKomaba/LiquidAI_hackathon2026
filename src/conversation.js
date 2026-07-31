import { SIGNAL_KEYS } from './signals.js';

/**
 * 通話セッションごとの会話履歴を保持するインメモリストア。
 *
 * latch 方式のスコアリングには「過去に立ったシグナル」が必要だが、音声チャンクは
 * 使い捨てなので過去分を再解析できない。そこで解析済みの結果だけをサーバー側に
 * 積んでおく。クライアントから履歴を送り返させる方式にしないのは、スコアの根拠を
 * 改ざんできてしまうため。
 *
 * ハッカソン用途なのでプロセスメモリのみ。再起動で消えるが通話単位の一時データなので問題ない。
 */

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAX_UTTERANCES = 200;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** 上限を超えて捨てた発話をまとめた擬似発話に付けるラベル。 */
export const CARRIED_UTTERANCE_LABEL = '（表示上限を超えた過去の発話）';

/**
 * 2つの解析結果を「立ったシグナルは立ったまま」で統合する。
 * 発話を捨てても latch したスコアが落ちないようにするためのもの。
 */
function mergeAnalyses(base, addition) {
  return Object.fromEntries(
    SIGNAL_KEYS.map((key) => {
      const kept = base?.[key]?.status ? base[key] : null;
      const added = addition?.[key]?.status ? addition[key] : null;
      return [key, kept ?? added ?? { status: false, text: '' }];
    })
  );
}

/**
 * @param {{ maxSessions?: number, maxUtterances?: number, ttlMs?: number, now?: () => number }} [options]
 */
export function createConversationStore(options = {}) {
  const {
    maxSessions = DEFAULT_MAX_SESSIONS,
    maxUtterances = DEFAULT_MAX_UTTERANCES,
    ttlMs = DEFAULT_TTL_MS,
    now = () => Date.now()
  } = options;

  /**
   * carried は上限からあふれた発話のシグナルを畳み込んだもの。
   * 本文は捨てても、一度立ったシグナルだけは会話の先頭に残し続ける。
   * @type {Map<string, { updatedAt: number, carried: object | null, items: Array<{ text: string, analysis: object }> }>}
   */
  const sessions = new Map();

  const dropExpired = () => {
    const threshold = now() - ttlMs;
    for (const [id, session] of sessions) {
      if (session.updatedAt < threshold) sessions.delete(id);
    }
  };

  /** 最も古いセッションから捨てて上限を守る（Map は挿入順を保つ）。 */
  const enforceSessionLimit = () => {
    while (sessions.size > maxSessions) {
      sessions.delete(sessions.keys().next().value);
    }
  };

  /** carried を先頭に付けた、スコアリングに渡せる形の配列を作る。 */
  const toScorableItems = (session) => {
    if (!session) return [];
    const items = [...session.items];
    return session.carried ? [{ text: CARRIED_UTTERANCE_LABEL, analysis: session.carried }, ...items] : items;
  };

  return {
    /**
     * 発話とその解析結果を追加し、そのセッションのスコアリング対象を返す。
     * 返す配列は毎回新しく作るので、呼び出し側が触ってもストアは壊れない。
     *
     * @param {string} sessionId
     * @param {{ text: string, analysis: object }} item
     * @param {{ userId?: string, displayName?: string }} [caller] 履歴保存に使う利用者情報
     */
    append(sessionId, item, caller = {}) {
      dropExpired();

      const previous = sessions.get(sessionId);
      const appended = [...(previous?.items ?? []), item];
      const overflow = appended.slice(0, Math.max(0, appended.length - maxUtterances));
      const items = appended.slice(-maxUtterances);

      // あふれた発話は本文を捨てるが、立っていたシグナルは carried に畳み込んで保持する。
      // 何も立っていなければ null のままにして、擬似発話をログに混ぜない。
      const merged = overflow.reduce(
        (accumulated, dropped) => mergeAnalyses(accumulated, dropped.analysis),
        previous?.carried ?? null
      );
      const carried = SIGNAL_KEYS.some((key) => merged?.[key]?.status) ? merged : null;

      // 一度削除してから入れ直し、アクセスの新しいものが Map の末尾に来るようにする
      sessions.delete(sessionId);
      const session = {
        updatedAt: now(),
        // 通話の開始時刻と利用者は最初の発話のものを保つ。以降の指定では上書きしない。
        startedAt: previous?.startedAt ?? now(),
        userId: previous?.userId ?? caller.userId,
        displayName: previous?.displayName ?? caller.displayName,
        carried,
        items
      };
      sessions.set(sessionId, session);
      enforceSessionLimit();

      return toScorableItems(session);
    },

    /** @param {string} sessionId */
    get(sessionId) {
      dropExpired();
      return toScorableItems(sessions.get(sessionId));
    },

    /**
     * 通話を終了し、履歴保存に必要な情報を取り出してセッションを破棄する。
     * 発話が1件も無いセッションは null を返す（保存する価値が無いため）。
     *
     * @param {string} sessionId
     */
    finalize(sessionId) {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);

      if (!session || session.items.length === 0) return null;

      return {
        startedAt: session.startedAt,
        userId: session.userId,
        displayName: session.displayName,
        items: toScorableItems(session),
        // 要約は実際に話された内容から作る。あふれた分を示す擬似発話は含めない。
        utterances: session.items.map((item) => item.text)
      };
    },

    /** @param {string} sessionId */
    reset(sessionId) {
      sessions.delete(sessionId);
    },

    get size() {
      return sessions.size;
    }
  };
}
