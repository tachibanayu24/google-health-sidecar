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

/**
 * キューを古い順に再送。オンライン時のみ動作。
 * - 2xx: 成功 → 削除
 * - 4xx: 恒久的な不正入力 → 再送しても無駄なので破棄(dropped)
 * - 5xx: 一時障害 → attempts++、上限超過で破棄
 * - ネット例外: まだオフライン → 順序維持のため中断(残りは次回)
 */
export async function flushOutbox(): Promise<{ sent: number; dropped: number }> {
  if (!hasIdb || flushing) return { sent: 0, dropped: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return { sent: 0, dropped: 0 };
  flushing = true;
  let sent = 0;
  let dropped = 0;
  try {
    for (const it of await listOutbox()) {
      try {
        const res = await fetch(`/api${it.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(it.body),
        });
        if (res.ok) {
          await remove(it.id);
          sent++;
        } else if (res.status >= 400 && res.status < 500) {
          await remove(it.id); // 恒久失敗(不正入力/権限) → 破棄
          dropped++;
        } else {
          const next: OutboxItem = {
            ...it,
            attempts: it.attempts + 1,
            lastError: `HTTP ${res.status}`,
          };
          if (next.attempts >= MAX_ATTEMPTS) {
            await remove(it.id);
            dropped++;
          } else {
            await tx('readwrite', (s) => s.put(next));
          }
        }
      } catch {
        break; // ネット不通: まだオフライン
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return { sent, dropped };
}
