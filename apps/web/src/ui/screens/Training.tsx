import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../components/Card';
import { axisTick, CHART, ChartFrame, TT } from '../components/chart';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { Empty, ErrorBox, Loading } from '../components/state';
import { WorkoutReport } from '../components/WorkoutReport';
import {
  api,
  type Exercise,
  type LandmarkZone,
  type MuscleVolume,
  type RecentSession,
} from '../lib/api';
import {
  DOW_JA,
  epochToJstMonthDay,
  formatDateForDisplay,
  shiftDate,
  todayJst,
} from '../lib/datetime';
import { invalidateWorkouts } from '../lib/invalidate';
import { MUSCLE_JA, MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';

// 部位ラベル(MUSCLE_JA)・slug(MUSCLE_TO_SLUG)・ヒートマップランプ(HEATMAP_RAMP)は単一ソースを import。
const RAMP = HEATMAP_RAMP;
const BASE_BODY = '#e6e1d5';

/** カレンダー表示用の部位グルーピング(16筋群 → 6行)。トレーニング分割の粒度で「何の日か」を示す。 */
const REGION_GROUPS: Array<{ key: string; label: string; color: string; muscles: string[] }> = [
  { key: 'chest', label: '胸', color: '#df4a26', muscles: ['chest'] },
  { key: 'back', label: '背', color: '#1d6f6f', muscles: ['lats', 'traps'] },
  {
    key: 'shoulders',
    label: '肩',
    color: '#b7791f',
    muscles: ['front_delts', 'side_delts', 'rear_delts'],
  },
  { key: 'arms', label: '腕', color: '#7c5cad', muscles: ['biceps', 'triceps', 'forearms'] },
  {
    key: 'legs',
    label: '脚',
    color: '#3f7d52',
    muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
  },
  { key: 'core', label: '体幹', color: '#9c6b4a', muscles: ['abs', 'obliques', 'lower_back'] },
];
function bucket(s: number): number {
  if (s <= 0.02) return 0;
  return Math.min(5, Math.max(1, Math.ceil(s * 5)));
}

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

// ============ トレーニング・カレンダー(週グリッド: 日付×部位文字で「いつ・何の日」を読む) ============
const WEEK_LABELS = ['今週', '先週', '2週前', '3週前'];

/** ISO日付の曜日。日=0 … 土=6(週は日曜始まり)。 */
function isoDow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

function TrainingCalendar() {
  const WEEKS = 4;
  const days = WEEKS * 7;
  const cal = useQuery({
    queryKey: ['training-calendar', days],
    queryFn: () => api.muscleCalendar(days),
  });
  const today = todayJst();

  // muscle(16筋群) → 表示グループ(6区分)、date → (region → セット数) を集計。
  const muscleToRegion = new Map<string, string>();
  for (const g of REGION_GROUPS) for (const m of g.muscles) muscleToRegion.set(m, g.key);
  const byDate = new Map<string, Map<string, number>>();
  for (const cell of cal.data?.cells ?? []) {
    const region = muscleToRegion.get(cell.muscle);
    if (!region) continue;
    let row = byDate.get(cell.date);
    if (!row) {
      row = new Map();
      byDate.set(cell.date, row);
    }
    row.set(region, (row.get(region) ?? 0) + cell.sets);
  }
  const sessionDates = new Set(cal.data?.sessionDates ?? []);

  // 今週の日曜から過去 WEEKS 週(各週 日→土, weeks[0]=今週)。
  const weekStart = shiftDate(today, -isoDow(today));
  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => shiftDate(shiftDate(weekStart, -7 * w), i)),
  );

  const oldest = weeks[WEEKS - 1]![0]!;
  const trainedDays = [...sessionDates].filter((d) => d >= oldest && d <= today).length;

  return (
    <Card
      title="部位カレンダー"
      right={
        <span className="text-[11px] text-faint">
          直近{WEEKS}週 · <span className="font-semibold text-muted">{trainedDays}</span>日実施
        </span>
      }
    >
      {cal.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-line/40" />
      ) : trainedDays === 0 ? (
        <Empty note="この期間のワークアウト記録がありません。" />
      ) : (
        <>
          {/* 曜日ヘッダ */}
          <div className="flex items-center gap-1">
            <span className="w-9 shrink-0" />
            <div className="grid flex-1 grid-cols-7 gap-1 text-center text-[10px] font-semibold text-faint">
              {DOW_JA.map((d, i) => (
                <span
                  key={d}
                  className={i === 0 ? 'text-accent' : i === 6 ? 'text-fiber' : undefined}
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
          {/* 週グリッド(上=今週) */}
          <div className="mt-1 space-y-1">
            {weeks.map((week, wi) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 固定長の週行(並べ替えなし)
              <div key={wi} className="flex items-center gap-1">
                <span className="w-9 shrink-0 text-[10px] font-semibold text-faint">
                  {WEEK_LABELS[wi]}
                </span>
                <div className="grid flex-1 grid-cols-7 gap-1">
                  {week.map((date) => (
                    <DayCell
                      key={date}
                      date={date}
                      regions={REGION_GROUPS.filter((g) => (byDate.get(date)?.get(g.key) ?? 0) > 0)}
                      sets={byDate.get(date)}
                      isToday={date === today}
                      isFuture={date > today}
                      rested={sessionDates.has(date)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function DayCell({
  date,
  regions,
  sets,
  isToday,
  isFuture,
  rested,
}: {
  date: string;
  regions: Array<{ key: string; label: string; color: string }>;
  sets: Map<string, number> | undefined;
  isToday: boolean;
  isFuture: boolean;
  rested: boolean;
}) {
  const day = Number(date.slice(8, 10));
  // 日付色は曜日基準(日=朱 / 土=青 / 平日=ink)。トレ無し日・未来は透明度で弱める。
  const dow = isoDow(date);
  const dowColor = dow === 0 ? 'text-accent' : dow === 6 ? 'text-fiber' : 'text-ink';
  const trained = regions.length > 0;
  // 未来日: カレンダーとして日付だけ薄く置く(部位なし)。
  if (isFuture) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md">
        <span className={`stat text-lg italic leading-none ${dowColor} opacity-30`}>{day}</span>
      </div>
    );
  }
  const title = trained
    ? `${formatDateForDisplay(date)} ${regions.map((r) => `${r.label}${sets?.get(r.key) ?? 0}`).join(' ')}`
    : rested
      ? `${formatDateForDisplay(date)} 実施(補助のみ)`
      : `${formatDateForDisplay(date)} レスト`;
  const multi = regions.length > 1;
  return (
    <div
      title={title}
      className={`relative flex aspect-square items-center justify-center rounded-md border ${
        isToday ? 'ring-2 ring-ink/30' : ''
      } ${trained ? 'border-line/50 bg-card' : 'border-line/40 bg-line/15'}`}
    >
      {/* 日付は薄地で背面に置き、トレ日は部位ラベルを上に重ねる。 */}
      <span
        className={`stat text-lg italic leading-none ${dowColor} ${trained ? 'opacity-25' : 'opacity-40'}`}
      >
        {day}
      </span>
      {trained && (
        <div
          className={`absolute inset-0 flex items-center justify-center font-bold leading-none ${multi ? 'gap-0 text-[9px]' : 'text-[11px]'}`}
        >
          {regions.map((r) => (
            <span key={r.key} style={{ color: r.color }}>
              {r.label === '体幹' ? '幹' : r.label}
            </span>
          ))}
        </div>
      )}
      {!trained && rested && (
        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-faint/50" />
      )}
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
                tickFormatter={formatDateForDisplay}
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
        <p className="mb-2 text-[11px] leading-snug text-faint">
          帯=週間セット数の目安(緑=MAV域 最も伸びやすい / 縦線=MEV最低ライン)。
          研究ベースのガイドライン(RP)で個人差あり・出発点。間接関与も1セットと計上。部位をタップ→種目。
        </p>
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
    </>
  );
}
// ボリュームランドマーク帯のゾーン表示(§8.9)。色=信号、ラベル=帯の位置。
const ZONE_META: Record<LandmarkZone, { label: string; color: string }> = {
  under: { label: '不足', color: '#6b86c9' },
  building: { label: '育成', color: '#4c9aa0' },
  optimal: { label: '最適', color: '#2f9e6e' },
  high: { label: '多め', color: '#c98a2b' },
  over: { label: '超過', color: '#e0521f' },
};

function MuscleRow({
  m,
  selected,
  onSelect,
}: {
  m: MuscleVolume;
  selected: boolean;
  onSelect: () => void;
}) {
  const zoneMeta = m.landmark_zone ? ZONE_META[m.landmark_zone] : null;
  const hasLandmarks = m.landmarks.mrv != null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 py-1 text-left [-webkit-tap-highlight-color:transparent]"
      >
        <span className="flex w-24 shrink-0 items-center gap-1 text-sm">
          <ChevronRight
            className={`h-3 w-3 text-faint transition-transform ${selected ? 'rotate-90' : ''}`}
          />
          {MUSCLE_JA[m.muscle] ?? m.muscle}
        </span>
        {hasLandmarks ? (
          <LandmarkBar sets={m.actual_sets} l={m.landmarks} color={zoneMeta?.color ?? BASE_BODY} />
        ) : (
          <StimulusBar stimulus={m.stimulus} />
        )}
        <span className="flex w-[4.5rem] shrink-0 items-center justify-end gap-1 text-xs">
          <span className="tnum text-muted">{m.actual_sets}</span>
          {zoneMeta ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
              style={{ color: zoneMeta.color, backgroundColor: `${zoneMeta.color}1f` }}
            >
              {zoneMeta.label}
            </span>
          ) : (
            <span className="text-faint">set</span>
          )}
        </span>
      </button>
      {/* 行の直下にアコーディオンで「にゅっと」展開(grid-rows 0fr→1fr)。別カードにしない。 */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${selected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <MuscleExercisesInline muscle={m.muscle} open={selected} />
        </div>
      </div>
    </li>
  );
}

function StimulusBar({ stimulus }: { stimulus: number }) {
  const b = bucket(stimulus);
  const color = b === 0 ? BASE_BODY : RAMP[b - 1];
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.round(stimulus * 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

/** 週間セット数を MEV〜MAV(sweet spot)〜MRV の帯に位置づける。塗り=現在量、緑帯=最も伸びやすいMAV域。 */
function LandmarkBar({
  sets,
  l,
  color,
}: {
  sets: number;
  l: MuscleVolume['landmarks'];
  color: string;
}) {
  const scaleMax = Math.max((l.mrv ?? 1) * 1.1, sets * 1.05, 1);
  const pos = (v: number | null) => (v == null ? 0 : Math.min(100, (v / scaleMax) * 100));
  const sweetL = pos(l.mav_low);
  const sweetW = Math.max(0, pos(l.mav_high) - sweetL);
  return (
    <div
      className="relative h-2 flex-1 overflow-hidden rounded-full bg-line"
      title={`MEV ${l.mev} / MAV ${l.mav_low}–${l.mav_high} / MRV ${l.mrv}(週間セット, 目安)`}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${pos(sets)}%`, backgroundColor: color, opacity: 0.82 }}
      />
      {/* MAV sweet spot 帯(最も伸びやすい量) */}
      <div
        className="absolute inset-y-0 border-x border-carb/50 bg-carb/10"
        style={{ left: `${sweetL}%`, width: `${sweetW}%` }}
      />
      {/* MEV 目盛 */}
      <div className="absolute inset-y-0 w-px bg-faint/70" style={{ left: `${pos(l.mev)}%` }} />
    </div>
  );
}
/** 選択部位の種目をインライン展開(別カードにせず行の下に従属表示)。open のときだけ取得。 */
function MuscleExercisesInline({ muscle, open }: { muscle: string; open: boolean }) {
  const q = useQuery({
    queryKey: ['ex-by-muscle', muscle],
    queryFn: () => api.searchExercises('', muscle),
    enabled: open,
  });
  return (
    <div className="mb-1 ml-7 border-l border-line/70 pl-3">
      {q.isLoading && <p className="py-1.5 text-xs text-faint">読み込み中…</p>}
      {q.error && (
        <button
          type="button"
          onClick={() => q.refetch()}
          className="py-1.5 text-xs font-semibold text-accent-ink underline"
        >
          読み込みに失敗。タップで再試行
        </button>
      )}
      {q.data?.exercises.length === 0 && <p className="py-1.5 text-xs text-faint">該当なし</p>}
      <ul>
        {q.data?.exercises.map((ex) => (
          <li key={ex.id} className="flex items-center justify-between gap-2 py-1 text-xs">
            <span className="min-w-0 truncate">
              <span className="font-medium">{ex.name_ja}</span>
              <span className="ml-1.5 text-[10px] text-faint">{ex.name_en}</span>
            </span>
            <span className="shrink-0 rounded-full bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-faint">
              {ex.equipment}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
          {ex.name_ja} <span className="text-xs text-faint">× 変更</span>
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
                {e.name_ja} <span className="ml-1 text-[10px] text-faint">{e.name_en}</span>
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
                tickFormatter={formatDateForDisplay}
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
      invalidateWorkouts(qc);
    },
  });
  const sessions = q.data?.sessions ?? [];
  return (
    <div className="space-y-3">
      <h2 className="px-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
        最近のワークアウト
      </h2>
      {sessions.length === 0 ? (
        <Card>
          <Empty note="ワークアウトを記録するとここに一覧が出ます。" />
        </Card>
      ) : (
        sessions.map((s, i) => (
          <WorkoutSessionRow
            key={s.id}
            session={s}
            initiallyOpen={i === 0}
            onEdit={onEdit}
            onAskDelete={(sess) =>
              setConfirm({
                id: sess.id,
                label: `${formatDateForDisplay(sess.date)} ${sess.title || 'ワークアウト'}(${sess.exercises}種目 ${sess.sets}set)`,
              })
            }
          />
        ))
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
    </div>
  );
}

/** 種目のセット列を表示用に圧縮: main は重量ごとに reps をまとめ(80kg ×8,8,7)、warmup は別。top=最大重量。 */
function summarizeSets(
  sets: Array<{
    setType: string;
    entryValue: number | null;
    entryUnit: string;
    reps: number | null;
    rpe: number | null;
  }>,
) {
  const main = sets.filter((s) => s.setType !== 'warmup');
  const warm = sets.filter((s) => s.setType === 'warmup');
  const groups: Array<{ value: number | null; unit: string; reps: Array<number | null> }> = [];
  for (const s of main) {
    const last = groups[groups.length - 1];
    if (last && last.value === s.entryValue && last.unit === s.entryUnit) last.reps.push(s.reps);
    else groups.push({ value: s.entryValue, unit: s.entryUnit, reps: [s.reps] });
  }
  const top = main.reduce((m, s) => Math.max(m, s.entryValue ?? 0), 0);
  return { groups, warm, top };
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
  const [report, setReport] = useState(false);
  const detail = useQuery({
    queryKey: ['workout', s.id],
    queryFn: () => api.getWorkout(s.id),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="font-display font-bold tracking-tight">{s.title || 'ワークアウト'}</span>
          <span className="mt-0.5 block text-[11px] text-faint">
            {formatDateForDisplay(s.date)} · {s.exercises}種目 {s.sets}set ·{' '}
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
          {detail.data?.exercises.map((ex) => {
            const { groups, warm, top } = summarizeSets(ex.sets);
            return (
              <div key={ex.exerciseId} className="mt-2.5 first:mt-0">
                <div className="text-sm font-semibold text-ink">{ex.name_ja ?? ex.name_en}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {groups.flatMap((g, gi) => {
                    const isTop = g.value != null && g.value === top;
                    return g.reps.map((r, ri) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト(並べ替えなし)
                        key={`${gi}-${ri}`}
                        className={`tnum inline-flex items-baseline gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] leading-none ${
                          isTop
                            ? 'bg-accent-soft font-bold text-ink'
                            : 'bg-paper font-semibold text-muted'
                        }`}
                      >
                        <span>
                          {g.value ?? 'BW'}
                          {g.unit}
                        </span>
                        <span className="text-faint">×</span>
                        <span>{r ?? '—'}</span>
                      </span>
                    ));
                  })}
                </div>
                {warm.length > 0 && (
                  <div className="tnum mt-0.5 text-[11px] text-faint">
                    <span className="mr-1 rounded bg-paper px-1 text-[9px] font-bold">W</span>
                    {warm
                      .map((w) => `${w.entryValue ?? 'BW'}${w.entryUnit}×${w.reps ?? '—'}`)
                      .join('  ')}
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-2.5 flex items-center gap-1">
            <button
              type="button"
              aria-label="シェア画像"
              onClick={() => setReport(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted active:text-accent"
            >
              <Share2 className="h-3.5 w-3.5" strokeWidth={2.2} /> シェア
            </button>
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
      {report && <WorkoutReport session={s} onClose={() => setReport(false)} />}
    </Card>
  );
}
