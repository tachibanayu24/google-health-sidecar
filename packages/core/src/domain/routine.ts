/**
 * トレーニングルーティン(計画)の部位集計 — 純関数(DB/IO非依存)。
 * 各日の種目(exercise_id + 計画セット数)を exercise_muscles の role/contribution で集計し、
 * 人体図(react-body-highlighter)用の部位別 intensity(0..1)を出す。
 * aggregateSessionMuscles(実績セッション)の計画版: 実測セットの代わりに計画セット数で重み付け。
 */

export interface RoutineMuscle {
  muscle: string;
  sets: number; // primary mover として割り当てられた計画セット数(部位ラベル用)
  intensity: number; // 0..1 正規化(人体図シェーディング用)
}

type MuscleLink = { muscle_group_id: string; role: string; contribution: number };

/** exercises: 各種目の exercise_id と代表計画セット数(sets_max ?? sets_min ?? 1 を呼び出し側で算出)。 */
export function aggregateRoutineMuscles(
  exercises: Array<{ exercise_id: string; sets: number }>,
  linksByExercise: Map<string, MuscleLink[]>,
): RoutineMuscle[] {
  const acc = new Map<string, { sets: number; intensity: number }>();
  for (const ex of exercises) {
    const planned = ex.sets > 0 ? ex.sets : 1;
    for (const link of linksByExercise.get(ex.exercise_id) ?? []) {
      const a = acc.get(link.muscle_group_id) ?? { sets: 0, intensity: 0 };
      if (link.role === 'primary') a.sets += planned;
      a.intensity += link.contribution * planned;
      acc.set(link.muscle_group_id, a);
    }
  }
  const maxIntensity = Math.max(1, ...[...acc.values()].map((v) => v.intensity));
  return [...acc]
    .map(([muscle, a]) => ({
      muscle,
      sets: a.sets,
      intensity: Math.round((a.intensity / maxIntensity) * 1000) / 1000,
    }))
    .filter((m) => m.intensity > 0)
    .sort((a, b) => b.intensity - a.intensity);
}

/** routine_exercises の sets_min/sets_max から人体図集計用の代表セット数を出す。 */
export function representativeSets(setsMin: number | null, setsMax: number | null): number {
  return setsMax ?? setsMin ?? 1;
}
