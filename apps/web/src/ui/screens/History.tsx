import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Search, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../components/Card';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { api, type Exercise, type RecentSession } from '../lib/api';
import { epochToJstMonthDay } from '../lib/datetime';
import { ErrorBox, Loading } from './Home';

const INK = '#19160f';
const ACCENT = '#df4a26';
const CARB = '#1d6f6f';
const LINE = '#e6e1d5';
const FAINT = '#a8a294';

const mmdd = (d: string) => d.slice(5).replace('-', '/');

export function HistoryScreen({ onEditWorkout }: { onEditWorkout: (id: string) => void }) {
  const q = useQuery({ queryKey: ['trends', 90], queryFn: () => api.trends(90) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const t = q.data!;
  const hasWeight = t.body.some((b) => b.weight_kg != null);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card title="体重トレンド" right={<span className="text-[11px] text-faint">90日</span>}>
        {hasWeight ? (
          <ChartFrame>
            <LineChart data={t.body} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis
                tick={axisTick}
                stroke={LINE}
                domain={['dataMin - 1', 'dataMax + 1']}
                width={40}
              />
              <Tooltip content={<TT unit="kg" />} />
              <Line
                type="monotone"
                dataKey="weight_kg"
                stroke={INK}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="体重は Google Health 同期で表示(トークン接続後)。" />
        )}
      </Card>

      <Card title="週間ボリューム(日次)" right={<span className="text-[11px] text-faint">kg</span>}>
        {t.volumeDaily.length ? (
          <ChartFrame>
            <BarChart data={t.volumeDaily} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis tick={axisTick} stroke={LINE} width={48} />
              <Tooltip content={<TT unit="kg" />} cursor={{ fill: 'rgba(223,74,38,0.08)' }} />
              <Bar dataKey="volume_kg" fill={ACCENT} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        ) : (
          <Empty note="ワークアウトを記録するとここに推移が出ます。" />
        )}
      </Card>

      <Card title="カロリー(日次)" right={<span className="text-[11px] text-faint">kcal</span>}>
        {t.pfcDaily.length ? (
          <ChartFrame>
            <LineChart data={t.pfcDaily} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis tick={axisTick} stroke={LINE} width={48} />
              <Tooltip content={<TT unit="kcal" />} />
              <Line type="monotone" dataKey="kcal" stroke={CARB} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="食事を記録するとここに推移が出ます。" />
        )}
      </Card>

      <ExerciseTrend />
      <PrList />
      <RecentWorkouts onEdit={onEditWorkout} />
    </div>
  );
}

// ============ 種目別 e1RM 推移(#4) ============
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
  // セッション日ごとに最良 e1RM を取り時系列化。
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
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis
                tick={axisTick}
                stroke={LINE}
                width={40}
                domain={['dataMin - 2', 'dataMax + 2']}
              />
              <Tooltip content={<TT unit="kg" />} />
              <Line type="monotone" dataKey="e1rm" stroke={ACCENT} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="2セッション以上記録すると推移が出ます。" />
        ))}
    </Card>
  );
}

// ============ PR タイムライン(#4) ============
function PrList() {
  const q = useQuery({ queryKey: ['prs'], queryFn: api.prs });
  const prs = q.data?.prs ?? [];
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
              <span className="text-[11px] text-faint">{tsToMd(p.achieved_at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ============ 最近のワークアウト(一覧 + 展開で読み取り + 削除確認) ============
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

/** セッション1行: タップで展開 → getWorkout を遅延フェッチして種目×セットを読み取り表示。 */
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

function tsToMd(sec: number): string {
  return epochToJstMonthDay(sec);
}

const axisTick = { fill: FAINT, fontSize: 10 };

function ChartFrame({ children }: { children: React.ReactElement }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ note }: { note: string }) {
  return <p className="py-8 text-center text-sm text-faint">{note}</p>;
}

function TT({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-faint">{label}</div>
      <div className="tnum font-bold">
        {Math.round(payload[0]!.value)} {unit}
      </div>
    </div>
  );
}
