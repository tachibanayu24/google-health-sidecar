import { useQuery } from '@tanstack/react-query';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { api, type RecentSession } from '../lib/api';
import { formatDateLong } from '../lib/datetime';
import { MUSCLE_JA, MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';
import { ReportStat, ShareImageModal } from './ShareImageModal';

// 人体図グラデーションは theme の単一ソース(Training の Heatmap と共有)。
const RAMP = HEATMAP_RAMP;
// シェア画像の人体ベース色。カード背景(ウォームクリーム)に埋もれないよう本体より濃いめ。
const BASE_BODY = '#c2b8a6';

function bucket(i: number): number {
  if (i <= 0.02) return 0;
  return Math.min(5, Math.max(1, Math.ceil(i * 5)));
}

/**
 * ワークアウトのシェアレポート(画像エクスポート)。
 * 人体図で効かせた部位を可視化 + 種目ごとの重量×レップを chip 表示。共通台紙 ShareImageModal に乗せる。
 */
export function WorkoutReport({
  session,
  onClose,
}: {
  session: RecentSession;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ['workout', session.id],
    queryFn: () => api.getWorkout(session.id),
    staleTime: 5 * 60_000,
  });

  const muscles = detail.data?.muscles ?? [];
  const exercises = detail.data?.exercises ?? [];

  // 人体図データ: intensity を 5 段にバケットし slug 単位で最大値を採用。
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
    const b = bucket(m.intensity);
    for (const slug of MUSCLE_TO_SLUGS[m.muscle] ?? []) {
      if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
    }
  }
  const bodyData: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));
  // 「効かせた主働部位」: primary セットがある部位を多い順に。
  const primary = muscles.filter((m) => m.sets > 0).slice(0, 6);

  return (
    <ShareImageModal
      heading="ワークアウト"
      filename={`logbook-${session.date}.png`}
      headerRight={
        <span className="tnum whitespace-nowrap text-[12px] font-semibold text-muted">
          {formatDateLong(session.date)}
        </span>
      }
      onClose={onClose}
      disabled={detail.isLoading}
    >
      {/* タイトル */}
      <div className="mt-4">
        <div className="font-display text-[26px] font-extrabold leading-tight tracking-tight">
          {session.title || 'ワークアウト'}
        </div>
      </div>

      {/* スタッツ */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <ReportStat
          label="総ボリューム"
          value={Math.round(session.total_volume_kg).toLocaleString()}
          unit="kg"
        />
        <ReportStat label="セット" value={String(session.sets)} unit="set" />
        <ReportStat label="種目" value={String(session.exercises)} />
      </div>

      {/* 人体図 + 効かせた部位 */}
      {detail.isLoading ? (
        <div className="mt-4 h-44 animate-pulse rounded-2xl bg-line/40" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-1 [&_svg]:h-auto [&_svg]:max-h-[30vh] [&_svg]:w-full">
            <Model type="anterior" data={bodyData} highlightedColors={RAMP} bodyColor={BASE_BODY} />
            <Model
              type="posterior"
              data={bodyData}
              highlightedColors={RAMP}
              bodyColor={BASE_BODY}
            />
          </div>
          {primary.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {primary.map((m) => {
                const c = RAMP[bucket(m.intensity) - 1] ?? RAMP[4];
                return (
                  <span
                    key={m.muscle}
                    className="inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1 text-[11px] font-bold ring-1 ring-line/70"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
                    {MUSCLE_JA[m.muscle] ?? m.muscle}
                    <span className="tnum text-faint">{m.sets}</span>
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 種目内訳(重量 × レップを chip 表示。ウォームアップ含む全セットを均一表示) */}
      {exercises.length > 0 && (
        <div className="mt-5 space-y-3">
          {exercises.map((ex) =>
            ex.sets.length === 0 ? null : (
              <div key={ex.exerciseId}>
                <div className="text-[13px] font-bold text-ink">{ex.name_ja ?? ex.name_en}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {ex.sets.map((s, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト
                      key={i}
                      className="tnum inline-flex items-baseline gap-0.5 rounded-md bg-card/80 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-muted ring-1 ring-line/60"
                    >
                      <span>
                        {s.entryValue ?? 'BW'}
                        {s.entryUnit}
                      </span>
                      <span className="text-faint">×</span>
                      <span>{s.reps ?? '—'}</span>
                    </span>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </ShareImageModal>
  );
}
