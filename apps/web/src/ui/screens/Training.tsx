import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { Card } from '../components/Card';
import { ErrorBox, Loading } from '../components/state';
import { api, type MuscleVolume } from '../lib/api';
import { epochToJstMonthDay, formatDateForDisplay, shiftDate, todayJst } from '../lib/datetime';
import { stimulusBucket as bucket, MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';
import { ExerciseTrend } from './training/ExerciseTrend';
import { RecentWorkouts } from './training/RecentWorkouts';
import { TrainingCalendar } from './training/TrainingCalendar';
import { VolumeTab } from './training/VolumeTab';

// 部位ラベル(MUSCLE_JA)・slug(MUSCLE_TO_SLUG)・ヒートマップランプ(HEATMAP_RAMP)は単一ソースを import。
const RAMP = HEATMAP_RAMP;
const BASE_BODY = '#e6e1d5';

type Tab = 'workouts' | 'volume' | 'exercises';

/** トレーニング(分析ハブ・読み取り専用)。旧 推移 + 部位 を統合。記録は中央＋から。 */
export function TrainingScreen({
  onEditWorkout,
  onOpenRoutines,
}: {
  onEditWorkout: (id: string) => void;
  onOpenRoutines: () => void;
}) {
  const [tab, setTab] = useState<Tab>('workouts');
  const mv = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  // 全期間カバー(getTrends は記録ある日のみ返すので大period でも軽量)。
  // Performance=全期間の累計、VolumeTab=直近90日に slice して使う。
  const tr = useQuery({ queryKey: ['trends', 3650], queryFn: () => api.trends(3650) });
  const pr = useQuery({ queryKey: ['prs'], queryFn: api.prs });

  if (mv.isLoading) return <Loading />;
  if (mv.error) return <ErrorBox error={mv.error} />;
  const muscles = mv.data?.muscles ?? [];
  const worked = muscles.filter((m) => m.actual_sets > 0).length;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Performance
        volumeDaily={tr.data?.volumeDaily ?? []}
        prs={pr.data?.prs ?? []}
        worked={worked}
      />
      <TrainingCalendar />
      <Heatmap muscles={muscles} worked={worked} />

      {/* AI作成ルーティン(計画)への導線。実体は /routines。 */}
      <button
        type="button"
        onClick={onOpenRoutines}
        className="block w-full text-left [-webkit-tap-highlight-color:transparent]"
      >
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink">ルーティン</div>
              <div className="text-[11px] text-muted">AIが組んだトレーニングメニューを見る</div>
            </div>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
          </div>
        </Card>
      </button>

      <div className="flex rounded-xl border border-line bg-paper p-0.5 text-sm font-semibold">
        {(
          [
            ['workouts', 'ワークアウト'],
            ['volume', 'ボリューム'],
            ['exercises', '種目'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-1.5 transition-colors ${tab === k ? 'bg-card text-ink shadow-sm' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'workouts' && (
        <>
          <RecentWorkouts onEdit={onEditWorkout} />
          <PrList prs={pr.data?.prs ?? []} />
        </>
      )}
      {tab === 'volume' && (
        <VolumeTab volumeDaily={(tr.data?.volumeDaily ?? []).slice(-90)} muscles={muscles} />
      )}
      {tab === 'exercises' && <ExerciseTrend />}
    </div>
  );
}

// ============ Performance スナップショット(全期間の累計で達成感を出す) ============
function Performance({
  volumeDaily,
  prs,
  worked,
}: {
  volumeDaily: Array<{ date: string; volume_kg: number }>;
  prs: Array<{ name_ja: string | null; name_en: string; value: number; achieved_at: number }>;
  worked: number;
}) {
  // 全期間の累計総ボリューム(これまで挙上した総重量)。達成感の指標。
  const allTime = volumeDaily.reduce((a, d) => a + d.volume_kg, 0);
  const tons = allTime / 1000;
  const latestPr = [...prs].sort((a, b) => b.achieved_at - a.achieved_at)[0];
  return (
    <Card>
      <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
        累計総ボリューム
      </div>
      <div className="flex items-end gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="stat text-3xl leading-none">
              {tons.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
            <span className="text-sm text-muted">t</span>
          </div>
          <div className="text-[11px] text-faint">これまでに挙上</div>
        </div>
        <div className="ml-auto text-right">
          <div className="tnum text-sm font-semibold">{worked}/16 部位</div>
          <div className="text-[10px] text-faint">直近7日</div>
          {latestPr && (
            <div className="mt-0.5 text-[11px] text-faint">
              最新PR {latestPr.name_ja ?? latestPr.name_en} {Math.round(latestPr.value * 10) / 10}kg
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============ 筋ヒートマップ(前面/背面) ============
function Heatmap({ muscles, worked }: { muscles: MuscleVolume[]; worked: number }) {
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
    const b = bucket(m.stimulus);
    for (const slug of MUSCLE_TO_SLUGS[m.muscle] ?? []) {
      if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
    }
  }
  const data: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));
  // 直近7日の刺激(get_muscle_volume の window=7 と一致)。
  const today = todayJst();
  const range = `${formatDateForDisplay(shiftDate(today, -6))}–${formatDateForDisplay(today)}`;
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
        <span className="tnum">{range} のトレーニング</span>
        <span>
          <span className="font-semibold text-muted">{worked}</span>/16 部位
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 [&_svg]:h-auto [&_svg]:max-h-[36vh] [&_svg]:w-full">
        <Model type="anterior" data={data} highlightedColors={RAMP} bodyColor={BASE_BODY} />
        <Model type="posterior" data={data} highlightedColors={RAMP} bodyColor={BASE_BODY} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span>刺激 少</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: `linear-gradient(90deg, ${BASE_BODY}, ${RAMP.join(',')})` }}
        />
        <span>多</span>
      </div>
    </Card>
  );
}

// ============ 自己ベスト(PR) ============
function PrList({
  prs,
}: {
  prs: Array<{
    exercise_id: string;
    name_ja: string | null;
    name_en: string;
    value: number;
    achieved_at: number;
  }>;
}) {
  if (prs.length === 0) return null;
  return (
    <Card
      title="自己ベスト(e1RM)"
      right={<Trophy className="h-4 w-4 text-accent" strokeWidth={2.2} />}
    >
      <ul className="space-y-1.5 text-sm">
        {prs.slice(0, 8).map((p) => (
          <li
            key={`${p.exercise_id}-${p.achieved_at}`}
            className="flex items-center justify-between"
          >
            <span className="truncate">{p.name_ja ?? p.name_en}</span>
            <span className="flex items-center gap-2">
              <span className="tnum font-semibold">{Math.round(p.value * 10) / 10} kg</span>
              <span className="text-[11px] text-faint">{epochToJstMonthDay(p.achieved_at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
