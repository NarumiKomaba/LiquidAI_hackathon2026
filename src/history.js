/**
 * 通話履歴の永続化。
 *
 * 保存するのは「あとから見て、どの通話が実際に詐欺だったかを特定できる」ための
 * 最小限の情報に絞る。会話の全文は保存しない。電話相手を含む第三者の発言を
 * そのまま蓄積することになるためで、要約と根拠の抜粋があれば特定には足りる。
 *
 * Firestore クライアントは引数で受け取る。テストから差し替えられるようにするため。
 */

export const HISTORY_COLLECTION = 'callHistories';

/** 履歴の保持期間。Firestore の TTL ポリシーを expiresAt に張って自動削除する。 */
const DEFAULT_RETENTION_DAYS = 90;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * @param {{ firestore: FirebaseFirestore.Firestore, retentionDays?: number, now?: () => Date }} deps
 */
export function createHistoryStore({ firestore, retentionDays = DEFAULT_RETENTION_DAYS, now = () => new Date() }) {
  const collection = firestore.collection(HISTORY_COLLECTION);

  return {
    /**
     * 通話1件を記録する。
     *
     * @param {{
     *   userId: string,
     *   displayName?: string,
     *   sessionId: string,
     *   startedAt: Date,
     *   score: number,
     *   riskLevel: string,
     *   utteranceCount: number,
     *   signals: Array<{ key: string, label: string, evidence: string }>,
     *   summary: { summary: string, callerClaim: string, requestedAction: string }
     * }} call
     */
    async record(call) {
      const endedAt = now();
      const expiresAt = new Date(endedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);

      const document = {
        userId: call.userId,
        displayName: call.displayName ?? '',
        sessionId: call.sessionId,
        startedAt: call.startedAt,
        endedAt,
        expiresAt,
        score: call.score,
        riskLevel: call.riskLevel,
        utteranceCount: call.utteranceCount,
        signals: call.signals,
        summary: call.summary.summary,
        callerClaim: call.summary.callerClaim,
        requestedAction: call.summary.requestedAction
      };

      const reference = await collection.add(document);
      return { id: reference.id, ...document };
    },

    /**
     * ユーザーの通話履歴を新しい順に返す。
     *
     * @param {string} userId
     * @param {{ limit?: number }} [options]
     */
    async listByUser(userId, { limit = DEFAULT_LIST_LIMIT } = {}) {
      const snapshot = await collection
        .where('userId', '==', userId)
        .orderBy('endedAt', 'desc')
        .limit(Math.min(limit, MAX_LIST_LIMIT))
        .get();

      return snapshot.docs.map((doc) => toHistoryItem(doc.id, doc.data()));
    }
  };
}

/** Firestore の Timestamp を ISO 文字列に均し、内部専用のフィールドは返さない。 */
function toHistoryItem(id, data) {
  return {
    id,
    userId: data.userId,
    displayName: data.displayName,
    startedAt: toIso(data.startedAt),
    endedAt: toIso(data.endedAt),
    score: data.score,
    riskLevel: data.riskLevel,
    utteranceCount: data.utteranceCount,
    signals: data.signals ?? [],
    summary: data.summary ?? '',
    callerClaim: data.callerClaim ?? '',
    requestedAction: data.requestedAction ?? ''
  };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}
