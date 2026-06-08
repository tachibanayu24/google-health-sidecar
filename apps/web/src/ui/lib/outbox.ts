/**
 * PWA オフライン送信キュー(IndexedDB アウトボックス, §9.8)。
 *
 * ジムは電波が弱く、食事/ワークアウトは authoring 元なので取りこぼすと「真実」が消える。
 * ネット不通時は冪等キー(client_request_id)付きの書込みをここに貯め、オンライン復帰時に再送する。
 * サーバは client_request_id で冪等なので、送信成功後に応答だけ失った再送でも二重登録にならない。
 */

const DB_NAME = 'logbook-outbox';
const DB_VERSION = 1;
const STORE = 'queue';
const MAX_ATTEMPTS = 5; // 5xx 等の一時障害でこの回数を超えたら破棄(無限ループ防止)

export interface OutboxItem {
  id: string; // = client_request_id(主キー)
  kind: 'meal' | 'workout';
  path: string; // '/meals' | '/workouts'
  body: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
  failed?: boolean; // 恒久失敗(4xx/上限超)。自動再送の対象外。手動で再送/削除する(§9.8)。
}

const hasIdb = typeof indexedDB !== 'undefined';
let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---- 件数変化の購読(未送信バッジ用) ----
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeOutbox(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function emit(): void {
  for (const l of listeners) l();
}

export async function enqueue(item: OutboxItem): Promise<void> {
  if (!hasIdb) throw new Error('IndexedDB 非対応');
  await tx('readwrite', (s) => s.put(item));
  emit();
}

export async function listOutbox(): Promise<OutboxItem[]> {
  if (!hasIdb) return [];
  const all = await tx<OutboxItem[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt); // 古い順
}

export async function pendingCount(): Promise<number> {
  if (!hasIdb) return 0;
  return tx<number>('readonly', (s) => s.count());
}

async function remove(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

let flushing = false;

/** flush 時の HTTP 応答→アクション分類(純関数=テスト対象)。恒久失敗は破棄せず failed として保持する。 */
export type FlushAction = 'sent' | 'retry' | 'failed';
export function classifyFlush(status: number, nextAttempts: number): FlushAction {
  if (status >= 200 && status < 300) return 'sent';
  if (status >= 400 && status < 500) return 'failed'; // 恒久(不正入力/認証切れ)。authoring の真実を捨てない。
  return nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'retry'; // 5xx 等の一時障害。上限超で failed に固定。
}

/**
 * キューを古い順に再送。オンライン時のみ動作。
 * - 2xx: 成功 → 削除
 * - 4xx / 5xx 上限超: 恒久失敗 → 破棄せず failed:true で保持(バナーから手動 再送/削除)
 * - 5xx 上限内: 一時障害 → attempts++ で次回再送
 * - ネット例外: まだオフライン → 順序維持のため中断(残りは次回)
 * failed:true のアイテムは自動再送の対象外(retryFailed で明示的に戻す)。
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  if (!hasIdb || flushing) return { sent: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const it of await listOutbox()) {
      if (it.failed) continue; // 恒久失敗は自動再送しない(手動 retry/削除待ち)
      try {
        const res = await fetch(`/api${it.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(it.body),
        });
        const next = it.attempts + 1;
        const action = classifyFlush(res.status, next);
        if (action === 'sent') {
          await remove(it.id);
          sent++;
        } else if (action === 'failed') {
          await tx('readwrite', (s) =>
            s.put({ ...it, attempts: next, failed: true, lastError: `HTTP ${res.status}` }),
          );
          failed++;
        } else {
          await tx('readwrite', (s) =>
            s.put({ ...it, attempts: next, lastError: `HTTP ${res.status}` }),
          );
        }
      } catch {
        break; // ネット不通: まだオフライン
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return { sent, failed };
}

/** pending(自動再送待ち)/ failed(恒久失敗・手動対応)の件数。バナー表示用。 */
export async function countsByState(): Promise<{ pending: number; failed: number }> {
  let pending = 0;
  let failed = 0;
  for (const it of await listOutbox()) {
    if (it.failed) failed++;
    else pending++;
  }
  return { pending, failed };
}

/** 恒久失敗を再送可能へ戻す(手動再送)。failed を外し attempts をリセット。呼び出し側で flushOutbox する。 */
export async function retryFailed(): Promise<void> {
  for (const it of await listOutbox()) {
    if (it.failed) await tx('readwrite', (s) => s.put({ ...it, failed: false, attempts: 0 }));
  }
  emit();
}

/** 恒久失敗を破棄(ユーザーが諦める)。authoring の真実が消えるため確認の上で。 */
export async function clearFailed(): Promise<void> {
  for (const it of await listOutbox()) {
    if (it.failed) await remove(it.id);
  }
  emit();
}
