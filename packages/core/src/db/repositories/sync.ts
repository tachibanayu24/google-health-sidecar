import type { SyncEntityType, SyncStatus } from '../../domain/enums';
import { GhSyncState, SyncRun } from '../../domain/models';
import { nowSec } from '../../util/date';
import { stmt, upsertStmt } from '../batch-helpers';
import type { Db } from '../client';

// ---------- sync_runs(GH dataType 単位の pull 状態, §12.2) ----------
export async function getSyncRun(db: Db, dataType: string): Promise<SyncRun | null> {
  return db.one(SyncRun, 'SELECT * FROM sync_runs WHERE data_type = ?', dataType);
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
export async function getPendingPushes(db: Db, limit = 20): Promise<GhSyncState[]> {
  return db.all(
    GhSyncState,
    `SELECT * FROM gh_sync_state WHERE sync_status IN ('pending','failed') ORDER BY updated_at LIMIT ?`,
    limit,
  );
}

/** push 対象を pending で登録(services が D1 batch 後に呼ぶ)。 */
export function pendingPushStmt(entityType: SyncEntityType, entityId: string) {
  return upsertStmt(
    'gh_sync_state',
    {
      entity_type: entityType,
      entity_id: entityId,
      sync_status: 'pending' as SyncStatus,
      retry_count: 0,
      updated_at: nowSec(),
    },
    ['entity_type', 'entity_id'],
    ['sync_status', 'updated_at'],
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

export async function markPushFailed(
  db: Db,
  entityType: SyncEntityType,
  entityId: string,
  error: string,
): Promise<void> {
  await db.run(
    `UPDATE gh_sync_state SET sync_status='failed', last_error=?, retry_count=retry_count+1, updated_at=?
     WHERE entity_type=? AND entity_id=?`,
    error.slice(0, 500),
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

/** 自分の書込みか(reconcile own-write 判定, §5.4)。gh_data_origin / datapoint_id 一致。 */
export async function isKnownOwnWrite(
  db: Db,
  datapointId: string | undefined,
  dataOrigin: string | undefined,
): Promise<boolean> {
  if (!datapointId && !dataOrigin) return false;
  const row = await db.raw<{ n: number }>(
    `SELECT count(*) AS n FROM gh_sync_state
       WHERE (gh_datapoint_id IS NOT NULL AND gh_datapoint_id = ?)
          OR (? IS NOT NULL AND gh_data_origin = ?)`,
    datapointId ?? null,
    dataOrigin ?? null,
    dataOrigin ?? null,
  );
  return (row[0]?.n ?? 0) > 0;
}
