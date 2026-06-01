import { Exercise, ExerciseMuscle, MuscleGroup } from '../../domain/models';
import { DomainError } from '../../util/errors';
import type { Db } from '../client';

export interface ExerciseSearchOpts {
  query?: string;
  equipment?: string;
  muscle?: string;
  favorite?: boolean;
  limit?: number;
}

/** search_exercises(§10.4)。name_en/name_ja 部分一致 + フィルタ。 */
export async function searchExercises(db: Db, opts: ExerciseSearchOpts = {}): Promise<Exercise[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.query) {
    where.push('(name_en LIKE ? OR name_ja LIKE ?)');
    binds.push(`%${opts.query}%`, `%${opts.query}%`);
  }
  if (opts.equipment) {
    where.push('equipment = ?');
    binds.push(opts.equipment);
  }
  if (opts.favorite) where.push('is_favorite = 1');
  if (opts.muscle) {
    where.push(
      'id IN (SELECT exercise_id FROM exercise_muscles WHERE muscle_group_id = ? AND role IN (?, ?))',
    );
    binds.push(opts.muscle, 'primary', 'secondary');
  }
  const sql =
    `SELECT * FROM exercises${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
    ` ORDER BY is_favorite DESC, name_en LIMIT ?`;
  binds.push(Math.min(opts.limit ?? 50, 200));
  return db.all(Exercise, sql, ...binds);
}

/** name(部分一致)から一意解決。複数候補/0件は曖昧エラーで候補を返す(§10.4 名前解決規約)。 */
export async function resolveExercise(db: Db, idOrName: string): Promise<Exercise> {
  const byId = await db.one(Exercise, 'SELECT * FROM exercises WHERE id = ?', idOrName);
  if (byId) return byId;
  const candidates = await searchExercises(db, { query: idOrName, limit: 6 });
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new DomainError(`種目が見つかりません: "${idOrName}"。search_exercises で確認を。`);
  }
  const names = candidates.map((c) => `${c.id}(${c.name_ja ?? c.name_en})`).join(', ');
  throw new DomainError(`種目名が曖昧です: "${idOrName}"。候補: ${names}。id で指定を。`);
}

/** 複数種目の部位リンクを1クエリで取得し exercise_id でグループ化(N+1 回避)。 */
export async function getExerciseMusclesForExercises(
  db: Db,
  exerciseIds: string[],
): Promise<Map<string, ExerciseMuscle[]>> {
  const grouped = new Map<string, ExerciseMuscle[]>(exerciseIds.map((id) => [id, []]));
  if (exerciseIds.length === 0) return grouped;
  const placeholders = exerciseIds.map(() => '?').join(',');
  const rows = await db.all(
    ExerciseMuscle,
    `SELECT * FROM exercise_muscles WHERE exercise_id IN (${placeholders})`,
    ...exerciseIds,
  );
  for (const r of rows) grouped.get(r.exercise_id)?.push(r);
  return grouped;
}

export async function listMuscleGroups(db: Db): Promise<MuscleGroup[]> {
  return db.all(MuscleGroup, 'SELECT * FROM muscle_groups ORDER BY region, id');
}
