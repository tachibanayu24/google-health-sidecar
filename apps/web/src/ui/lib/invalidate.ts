import type { QueryClient } from '@tanstack/react-query';

/**
 * クエリ無効化の集中管理(§: 書込後の再取得は1箇所で定義し各画面で複製しない)。
 * 「何を書いたら何が古くなるか」をここに集約 → 画面側は意図で呼ぶだけ。
 */

/** 食事の作成/削除後。今日の集計 + 栄養トレンドが古くなる。 */
export function invalidateMeals(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['today'] });
  qc.invalidateQueries({ queryKey: ['trends'] });
}

/** ワークアウトの作成/削除後。一覧・トレンド・部位量・当日・詳細キャッシュが古くなる。 */
export function invalidateWorkouts(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['recent-workouts'] });
  qc.invalidateQueries({ queryKey: ['trends'] });
  qc.invalidateQueries({ queryKey: ['muscle-volume'] });
  qc.invalidateQueries({ queryKey: ['today'] });
  qc.removeQueries({ queryKey: ['workout'] }); // 読取詳細(編集前)を破棄
  qc.invalidateQueries({ queryKey: ['prs'] });
}

/** 体重/体組成の手入力後。今日 + トレンドが古くなる。 */
export function invalidateBody(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['today'] });
  qc.invalidateQueries({ queryKey: ['trends'] });
}

/** 栄養目標/設定の変更後。 */
export function invalidateSettings(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['settings'] });
  qc.invalidateQueries({ queryKey: ['today'] });
}

/** オフライン送信キューのフラッシュ後。authoring 全般が更新されうる。 */
export function invalidateAfterFlush(qc: QueryClient): void {
  for (const key of ['today', 'trends', 'recent-workouts', 'muscle-volume', 'prs']) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}
