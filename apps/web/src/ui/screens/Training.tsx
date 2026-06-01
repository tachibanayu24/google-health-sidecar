import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Search, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../components/Card';
import { axisTick, CHART, ChartFrame, mmdd, TT } from '../components/chart';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { Empty, ErrorBox, Loading } from '../components/state';
import { api, type Exercise, type MuscleVolume, type RecentSession } from '../lib/api';
import { epochToJstMonthDay } from '../lib/datetime';

const NAME_JA: Record<string, string> = {
  chest: '胸',
  lats: '広背筋',
  traps: '僧帽筋',
  front_delts: '前部三角筋',
  side_delts: '中部三角筋',
  rear_delts: '後部三角筋',
  biceps: '上腕二頭筋',
  triceps: '上腕三頭筋',
  forearms: '前腕',
  abs: '腹直筋',
  obliques: '腹斜筋',
  quads: '大腿四頭筋',
  hamstrings: 'ハムストリング',
  glutes: '臀筋',
  calves: 'ふくらはぎ',
  lower_back: '脊柱起立筋',
};
const TO_SLUG: Record<string, Muscle> = {
  chest: 'chest',
  lats: 'upper-back',
  traps: 'trapezius',
  front_delts: 'front-deltoids',
  side_delts: 'front-deltoids',
  rear_delts: 'back-deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm',
  abs: 'abs',
  obliques: 'obliques',
  quads: 'quadriceps',
  hamstrings: 'hamstring',
  glutes: 'gluteal',
  calves: 'calves',
  lower_back: 'lower-back',
};
const RAMP = ['#f6e7b0', '#f3c97a', '#ef9f53', '#e96f38', '#df4a26'];
const BASE_BODY = '#e6e1d5';
function bucket(s: number): number {
  if (s <= 0.02) return 0;
  return Math.min(5, Math.max(1, Math.ceil(s * 5)));
}

type Tab = 'workouts' | 'volume' | 'exercises';

/** トレーニング(分析ハブ・読み取り専用)。旧 推移 + 部位 を統合。記録は中央＋から。 */
export function TrainingScreen({ onEditWorkout }: { onEditWorkout: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('workouts');
  const mv = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  const tr = useQuery({ queryKey: ['trends', 90], queryFn: () => api.trends(90) });
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
      <Heatmap muscles={muscles} worked={worked} />

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
      {tab === 'volume' && <VolumeTab volumeDaily={tr.data?.volumeDaily ?? []} muscles={muscles} />}
      {tab === 'exercises' && <ExerciseTrend />}
    </div>
  );
}

// ============ Performance スナップショット ============
function Performance({
  volumeDaily,
  prs,
  worked,
}: {
  volumeDaily: Array<{ date: string; volume_kg: number }>;
  prs: Array<{ name_ja: string | null; name_en: string; value: number; achieved_at: number }>;
  worked: number;
}) {
  // 直近7日 vs その前7日の総ボリューム比較。
  const last7 = volumeDaily.slice(-7).reduce((a, d) => a + d.volume_kg, 0);
  const prev7 = volumeDaily.slice(-14, -7).reduce((a, d) => a + d.volume_kg, 0);
  const pct = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null;
  const latestPr = [...prs].sort((a, b) => b.achieved_at - a.achieved_at)[0];
  return (
    <Card>
      <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
        Performance · 直近7日
      </div>
      <div className="flex items-end gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="stat text-2xl leading-none">{Math.round(last7).toLocaleString()}</span>
            <span className="text-sm text-muted">kg</span>
          </div>
          <div className="text-[11px] text-faint">
            総ボリューム
            {pct != null && (
              <span className={`ml-1 font-semibold ${pct >= 0 ? 'text-carb' : 'text-accent-ink'}`}>
                {pct >= 0 ? '↗' : '↘'}
                {Math.abs(pct)}%
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="tnum text-sm font-semibold">{worked}/16 部位</div>
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
    const slug = TO_SLUG[m.muscle];
    if (!slug) continue;
    const b = bucket(m.stimulus);
    if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
  }
  const data: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));
  return (
    <Card
      title="筋ヒートマップ"
      right={<span className="text-[11px] text-faint">7日 · {worked}/16</span>}
    >
      <div className="grid grid-cols-2 gap-2 [&_svg]:h-auto [&_svg]:max-h-[36vh] [&_svg]:w-full">
        <Figure label="前面" type="anterior" data={data} />
        <Figure label="背面" type="posterior" data={data} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span>刺激 少</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: `linear-gradient(90deg, ${BASE_BODY}, ${RAMP.join(',')})` }}
        />
        <span>多</span>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-faint">
        ※
        図は概略表示。中部三角筋は前部と同じ位置に、脊柱起立筋は背面下部に近似して塗っています。正確な部位別数値は「ボリューム」タブを参照。
      </p>
    </Card>
  );
}
function Figure({
  label,
  type,
  data,
}: {
  label: string;
  type: 'anterior' | 'posterior';
  data: IExerciseData[];
}) {
  return (
    <div className="flex flex-col items-center">
      <Model type={type} data={data} highlightedColors={RAMP} bodyColor={BASE_BODY} />
      <span className="mt-1 text-[11px] font-semibold text-faint">{label}</span>
    </div>
  );
}

// ============ ボリュームタブ(90日 日次 bar + 部位別) ============
function VolumeTab({
  volumeDaily,
  muscles,
}: {
  volumeDaily: Array<{ date: string; volume_kg: number }>;
  muscles: MuscleVolume[];
}) {
  const [sel, setSel] = useState<string | null>(null);
  const sorted = [...muscles].sort((a, b) => b.stimulus - a.stimulus);
  return (
    <>
      <Card
        title="日次ボリューム"
        right={<span className="text-[11px] text-faint">90日 · kg</span>}
      >
        {volumeDaily.length ? (
          <ChartFrame>
            <BarChart data={volumeDaily} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={CHART.line} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={CHART.line}
                minTickGap={28}
              />
              <YAxis tick={axisTick} stroke={CHART.line} width={48} />
              <Tooltip content={<TT unit="kg" />} cursor={{ fill: 'rgba(223,74,38,0.08)' }} />
              <Bar dataKey="volume_kg" fill={CHART.accent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        ) : (
          <Empty note="ワークアウトを記録するとここに推移が出ます。" />
        )}
      </Card>
      <Card title="部位別ボリューム">
        <p className="mb-2 text-[11px] text-faint">部位をタップ → 種目を表示</p>
        <ul className="space-y-2">
          {sorted.map((m) => (
            <MuscleRow
              key={m.muscle}
              m={m}
              selected={sel === m.muscle}
              onSelect={() => setSel((c) => (c === m.muscle ? null : m.muscle))}
            />
          ))}
        </ul>
      </Card>
      {sel && <MuscleExercises muscle={sel} name={NAME_JA[sel] ?? sel} />}
    </>
  );
}
function MuscleRow({
  m,
  selected,
  onSelect,
}: {
  m: MuscleVolume;
  selected: boolean;
  onSelect: () => void;
}) {
  const b = bucket(m.stimulus);
  const color = b === 0 ? BASE_BODY : RAMP[b - 1];
  const pct = Math.round(m.stimulus * 100);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-lg py-1 text-left ${selected ? 'bg-accent-soft' : ''}`}
      >
        <span className="flex w-24 shrink-0 items-center gap-1 text-sm">
          <ChevronRight
            className={`h-3 w-3 text-faint transition-transform ${selected ? 'rotate-90' : ''}`}
          />
          {NAME_JA[m.muscle] ?? m.muscle}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="tnum w-16 shrink-0 text-right text-xs text-muted">
          {m.actual_sets}set{m.target_sets ? `/${m.target_sets}` : ''}
        </span>
      </button>
    </li>
  );
}
function MuscleExercises({ muscle, name }: { muscle: string; name: string }) {
  const q = useQuery({
    queryKey: ['ex-by-muscle', muscle],
    queryFn: () => api.searchExercises('', muscle),
  });
  return (
    <Card title={`「${name}」の種目`}>
      {q.isLoading && <p className="py-2 text-sm text-faint">読み込み中…</p>}
      {q.error && (
        <button
          type="button"
          onClick={() => q.refetch()}
          className="py-2 text-sm font-semibold text-accent-ink underline"
        >
          読み込みに失敗。タップで再試行
        </button>
      )}
      {q.data?.exercises.length === 0 && <p className="py-2 text-sm text-faint">該当なし</p>}
      <ul className="space-y-1">
        {q.data?.exercises.map((ex) => (
          <li
            key={ex.id}
            className="flex items-center justify-between rounded-lg px-1 py-2 text-sm"
          >
            <span className="font-medium">{ex.name_ja ?? ex.name_en}</span>
            <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-faint">
              {ex.equipment}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ============ 種目別 e1RM 推移 ============
function ExerciseTrend() {
  const [q, setQ] = useState('');
  const [ex, setEx] = useState<Exercise | null>(null);
  const found = useQuery({
    queryKey: ['ex-search', q],
    queryFn: () => api.searchExercises(q),
    enabled: q.trim().length > 0 && !ex,
  });
  const hist = useQuery({
    queryKey: ['ex-hist', ex?.id],
    queryFn: () => api.exerciseHistory(ex!.id, { limit: 200 }),
    enabled: !!ex,
  });
  const series = (() => {
    const m = new Map<string, number>();
    for (const s of hist.data?.sets ?? []) {
      if (s.e1rm_kg == null) continue;
      m.set(s.session_date, Math.max(m.get(s.session_date) ?? 0, s.e1rm_kg));
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e1rm]) => ({ date, e1rm: Math.round(e1rm * 10) / 10 }));
  })();
  return (
    <Card title="種目別 e1RM 推移">
      {ex ? (
        <button
          type="button"
          onClick={() => {
            setEx(null);
            setQ('');
          }}
          className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-accent"
        >
          {ex.name_ja ?? ex.name_en} <span className="text-xs text-faint">× 変更</span>
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="種目を検索(例: デッドリフト)"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
      )}
      {!ex && q.trim() && (
        <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
          {found.data?.exercises.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setEx(e)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"
              >
                {e.name_ja ?? e.name_en}
              </button>
            </li>
          ))}
        </ul>
      )}
      {ex &&
        (series.length >= 2 ? (
          <ChartFrame>
            <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={CHART.line} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={CHART.line}
                minTickGap={28}
              />
              <YAxis
                tick={axisTick}
                stroke={CHART.line}
                width={40}
                domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]}
              />
              <Tooltip content={<TT unit="kg" />} />
              <Line
                type="monotone"
                dataKey="e1rm"
                stroke={CHART.accent}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="2セッション以上記録すると推移が出ます。" />
        ))}
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

// ============ 最近のワークアウト(展開で種目×セット読取 + 削除確認) ============
function RecentWorkouts({ onEdit }: { onEdit: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['recent-workouts'], queryFn: api.recentWorkouts });
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const del = useMutation({
    mutationFn: api.deleteWorkout,
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      qc.invalidateQueries({ queryKey: ['trends'] });
      qc.invalidateQueries({ queryKey: ['muscle-volume'] });
      qc.invalidateQueries({ queryKey: ['today'] });
    },
  });
  const sessions = q.data?.sessions ?? [];
  return (
    <Card title="最近のワークアウト">
      {sessions.length === 0 ? (
        <Empty note="ワークアウトを記録するとここに一覧が出ます。" />
      ) : (
        <ul className="text-sm">
          {sessions.map((s, i) => (
            <WorkoutSessionRow
              key={s.id}
              session={s}
              initiallyOpen={i === 0}
              onEdit={onEdit}
              onAskDelete={(sess) =>
                setConfirm({
                  id: sess.id,
                  label: `${mmdd(sess.date)} ${sess.title || 'ワークアウト'}(${sess.exercises}種目 ${sess.sets}set)`,
                })
              }
            />
          ))}
        </ul>
      )}
      {confirm && (
        <DeleteConfirmModal
          kind="workout"
          targetLabel={confirm.label}
          isPending={del.isPending}
          onConfirm={() => del.mutate(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}

function WorkoutSessionRow({
  session: s,
  initiallyOpen,
  onEdit,
  onAskDelete,
}: {
  session: RecentSession;
  initiallyOpen: boolean;
  onEdit: (id: string) => void;
  onAskDelete: (s: RecentSession) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const detail = useQuery({
    queryKey: ['workout', s.id],
    queryFn: () => api.getWorkout(s.id),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  return (
    <li className="border-b border-line py-2 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="font-semibold">{s.title || 'ワークアウト'}</span>
          <span className="mt-0.5 block text-[11px] text-faint">
            {mmdd(s.date)} · {s.exercises}種目 {s.sets}set ·{' '}
            {Math.round(s.total_volume_kg).toLocaleString()}kg
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
        )}
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-line/50 pl-3">
          {detail.isLoading && <p className="text-[11px] text-faint">読み込み中…</p>}
          {detail.error && (
            <button
              type="button"
              onClick={() => detail.refetch()}
              className="text-[11px] font-semibold text-accent-ink underline"
            >
              読み込みに失敗。タップで再試行
            </button>
          )}
          {detail.data?.exercises.map((ex) => (
            <div key={ex.exerciseId} className="mt-2 first:mt-0">
              <div className="text-sm font-medium text-ink">{ex.name_ja ?? ex.name_en}</div>
              {ex.sets.map((set, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト(並べ替え/挿入なし)
                  key={`${ex.exerciseId}:${i}`}
                  className="tnum text-[11px] leading-relaxed text-faint"
                >
                  {set.setType === 'warmup' && (
                    <span className="mr-1 rounded bg-paper px-1 text-[9px] font-bold">W</span>
                  )}
                  {i + 1}: {set.entryValue ?? '—'}
                  {set.entryUnit} × {set.reps ?? '—'}reps
                  {set.rpe != null ? ` RPE${set.rpe}` : ''}
                </div>
              ))}
            </div>
          ))}
          <div className="mt-2.5 flex items-center gap-1">
            <button
              type="button"
              aria-label="編集"
              onClick={() => onEdit(s.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted active:text-accent"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} /> 編集
            </button>
            <button
              type="button"
              aria-label="削除"
              onClick={() => onAskDelete(s)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted active:text-accent"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} /> 削除
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
