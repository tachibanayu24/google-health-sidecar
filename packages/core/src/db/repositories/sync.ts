import type { SyncEntityType, SyncStatus } from '../../domain/enums';
import { GhSyncState, SyncRun } from '../../domain/models';
import { nowSec } from '../../util/date';
import { stmt, upsertStmt } from '../batch-helpers';
import type { Db } from '../client';

// ---------- sync_runs(GH dataType 単位の pull 状態, §12.2) ----------
export async function getSyncRun(db: Db, dataType: string): Promise<SyncRun | null> {
  return db.one(SyncRun, 'SELECT * FROM sync_runs WHERE data_type = ?', dataType);
}

/** 全 sync_runs(UI の同期ヘルス表示用)。 */
export async function getAllSyncRuns(db: Db): Promise<SyncRun[]> {
  return db.all(SyncRun, 'SELECT * FROM sync_runs ORDER BY data_type');
}

export async function markSyncOk(
  db: Db,
  dataType: string,
  syncedAt: number,
  cursor: string | null,
): Promise<void> {
  await db.run(
    `INSERT INTO sync_runs (data_type, last_synced_at, last_cursor, last_status, last_error, consecutive_failures, updated_at)
     VALUES (?, ?, ?, 'ok', NULL, 0, ?)
     ON CONFLICT (data_type) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       last_cursor = excluded.last_cursor,
       last_status = 'ok', last_error = NULL, consecutive_failures = 0,
       updated_at = excluded.updated_at`,
    dataType,
    syncedAt,
    cursor,
    nowSec(),
  );
}

export async function markSyncError(db: Db, dataType: string, error: string): Promise<void> {
  await db.run(
    `INSERT INTO sync_runs (data_type, last_status, last_error, consecutive_failures, updated_at)
     VALUES (?, 'error', ?, 1, ?)
     ON CONFLICT (data_type) DO UPDATE SET
       last_status = 'error', last_error = excluded.last_error,
       consecutive_failures = sync_runs.consecutive_failures + 1,
       updated_at = excluded.updated_at`,
    dataType,
    error.slice(0, 500),
    nowSec(),
  );
}

// ---------- gh_sync_state(D1→GH push 台帳, §7) ----------
/** push の最大再試行回数。これを超えると dead_letter に隔離(無限リトライ防止, §12.2)。 */
export const PUSH_MAX_RETRIES = 8;

/** 再試行バックオフ秒(指数, 上限6h)。30分 cron で拾うので分〜時間オーダー。 */
export function pushBackoffSec(retryCount: number): number {
  return Math.min(2 ** retryCount * 300, 6 * 3600);
}

/** push 台帳の状態別件数(UI の同期ヘルス表示用)。dead_letter は手動対応が必要。 */
export async function getPushQueueStats(
  db: Db,
): Promise<{ pending: number; failed: number; deadLetter: number }> {
  const rows = await db.raw<{ sync_status: string; n: number }>(
    `SELECT sync_status, count(*) AS n FROM gh_sync_state
       WHERE sync_status IN ('pending','failed','dead_letter') GROUP BY sync_status`,
  );
  const by = (s: string) => rows.find((r) => r.sync_status === s)?.n ?? 0;
  return { pending: by('pending'), failed: by('failed'), deadLetter: by('dead_letter') };
}

export async function getPendingPushes(db: Db, limit = 20): Promise<GhSyncState[]> {
  // dead_letter は対象外。next_retry_at が未到来のものはバックオフ中なのでスキップ。
  return db.all(
    GhSyncState,
    `SELECT * FROM gh_sync_state
       WHERE sync_status IN ('pending','failed')
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY updated_at LIMIT ?`,
    nowSec(),
    limit,
  );
}

/** push 対象を pending で登録(services が D1 batch 後に呼ぶ)。 */
export function pendingPushStmt(entityType: SyncEntityType, entityId: string) {
  // 再 push 時(conflict)も pending に戻し、retry_count/next_retry_at をリセットして即時対象に。
  return upsertStmt(
    'gh_sync_state',
    {
      entity_type: entityType,
      entity_id: entityId,
      sync_status: 'pending' as SyncStatus,
      retry_count: 0,
      next_retry_at: null,
      updated_at: nowSec(),
    },
    ['entity_type', 'entity_id'],
    ['sync_status', 'retry_count', 'next_retry_at', 'updated_at'],
  );
}

export async function markPushSynced(
  db: Db,
  entityType: SyncEntityType,
  entityId: string,
  datapointId: string,
  dataOrigin: string,
  hash: string | null,
): Promise<void> {
  await db.run(
    `UPDATE gh_sync_state SET sync_status='synced', gh_datapoint_id=?, gh_data_origin=?,
       last_pushed_hash=?, last_pushed_at=?, last_error=NULL, updated_at=?
     WHERE entity_type=? AND entity_id=?`,
    datapointId,
    dataOrigin,
    hash,
    nowSec(),
    nowSec(),
    entityType,
    entityId,
  );
}

/**
 * push 失敗を記録(§12.2)。retry_count を加算し、恒久失敗(permanent=403等)または上限到達なら
 * dead_letter に隔離(以後 cron 自動再試行の対象外)。それ以外は指数バックオフで next_retry_at を設定。
 */
export async function markPushFailed(
  db: Db,
  entityType: SyncEntityType,
  entityId: string,
  error: string,
  opts: { permanent?: boolean } = {},
): Promise<void> {
  const rows = await db.raw<{ retry_count: number }>(
    'SELECT retry_count FROM gh_sync_state WHERE entity_type=? AND entity_id=?',
    entityType,
    entityId,
  );
  const nextCount = (rows[0]?.retry_count ?? 0) + 1;
  const dead = opts.permanent === true || nextCount >= PUSH_MAX_RETRIES;
  const now = nowSec();
  await db.run(
    `UPDATE gh_sync_state SET sync_status=?, last_error=?, retry_count=?, next_retry_at=?, updated_at=?
     WHERE entity_type=? AND entity_id=?`,
    dead ? 'dead_letter' : 'failed',
    error.slice(0, 500),
    nextCount,
    dead ? null : now + pushBackoffSec(nextCount),
    now,
    entityType,
    entityId,
  );
}

/**
 * レート制限など一時的事由による push 先送り(§12.2)。retry_count は加算せず
 * (dead_letter に近づけない)、next_retry_at だけ後ろにずらして次 cron に回す。
 */
export async function markPushDeferred(
  db: Db,
  entityType: SyncEntityType,
  entityId: string,
  retryAfterSec: number,
): Promise<void> {
  await db.run(
    `UPDATE gh_sync_state SET next_retry_at=?, updated_at=? WHERE entity_type=? AND entity_id=?`,
    nowSec() + Math.max(60, retryAfterSec),
    nowSec(),
    entityType,
    entityId,
  );
}

/** flag OFF 等で push しない場合。 */
export function skippedPushStmt(entityType: SyncEntityType, entityId: string) {
  return stmt(
    `INSERT INTO gh_sync_state (entity_type, entity_id, sync_status, retry_count, updated_at)
     VALUES (?, ?, 'skipped_flag_off', 0, ?)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET sync_status='skipped_flag_off', updated_at=excluded.updated_at`,
    entityType,
    entityId,
    nowSec(),
  );
}

/**
 * reconcile で取得した datapoint が自分の push か(echo ループ防止, §5.4)。
 *
 * 2つの突合を OR で使う(どちらか一致すれば own-write):
 *  1) gh_datapoint_id 完全一致 — 最も厳密。「この datapoint はまさに自分が作った」。
 *  2) gh_data_origin 一致 — create 応答と reconcile で datapoint id 形式が揃う保証が無い
 *     (mappers の parseCreateResponse に「要トークン検証」注記)ため、アプリ固有の
 *     dataOrigin(他デバイスと異なる application name)を信頼できる echo キーとして併用。
 *
 * ⚠ 空文字 origin は誤一致(''='') を生むため除外。両キーとも空なら own-write ではない。
 */
export async function isKnownOwnWrite(
  db: Db,
  datapointId: string | undefined,
  dataOrigin: string | undefined,
): Promise<boolean> {
  const dpId = datapointId && datapointId.length > 0 ? datapointId : null;
  const origin = dataOrigin && dataOrigin.length > 0 ? dataOrigin : null;
  if (!dpId && !origin) return false;
  const row = await db.raw<{ n: number }>(
    `SELECT count(*) AS n FROM gh_sync_state
       WHERE (? IS NOT NULL AND gh_datapoint_id = ?)
          OR (? IS NOT NULL AND gh_data_origin != '' AND gh_data_origin = ?)`,
    dpId,
    dpId,
    origin,
    origin,
  );
  return (row[0]?.n ?? 0) > 0;
}
