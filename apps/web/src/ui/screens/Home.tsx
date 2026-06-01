import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Moon,
  Pencil,
  Scale,
  Trash2,
  Utensils,
  Wind,
} from 'lucide-react';
import { useState } from 'react';
import { Card, Stat } from '../components/Card';
import {
  api,
  type BodyReading,
  type NutritionTarget,
  type SleepSummary,
  type TodayMeal,
} from '../lib/api';
import { round } from '../lib/units';

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function shiftDate(date: string, delta: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
const hhmm = (sec: number) => new Date(sec * 1000 + 9 * 3600_000).toISOString().slice(11, 16);

export function HomeScreen({
  onGoRecord,
  onEditMeal,
}: {
  onGoRecord: () => void;
  onEditMeal: (id: string) => void;
}) {
  const [date, setDate] = useState(todayJst());
  const isToday = date === todayJst();
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data!;
  const target = settings.data?.nutritionTarget;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <SyncHealthBanner />
      <DateNav
        date={date}
        isToday={isToday}
        onPrev={() => setDate((d) => shiftDate(d, -1))}
        onNext={() => setDate((d) => shiftDate(d, 1))}
        onToday={() => setDate(todayJst())}
      />

      <BodyCard body={t.body} />

      {t.inProgress && isToday && (
        <Card accent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4 text-accent" strokeWidth={2.4} />
              <span className="text-sm font-semibold">
                記録中 · {t.inProgress.title ?? 'ワークアウト'}
              </span>
            </div>
            <button
              type="button"
              onClick={onGoRecord}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-card"
            >
              再開
            </button>
          </div>
        </Card>
      )}

      <NutritionCard pfc={t.pfc} target={target ?? null} />
      <MealsCard meals={t.meals} date={date} onEdit={onEditMeal} />
      <SleepCard sleep={t.sleep} />
      <SensingCard daily={t.daily} />
    </div>
  );
}

// ============ 体組成(体重+体脂肪を1枚に統合・kg単体・前日比) ============
function BodyCard({ body }: { body: BodyReading }) {
  const { weightKg, bodyFatPct, source, prevWeightKg } = body;
  const diff =
    weightKg != null && prevWeightKg != null
      ? Math.round((weightKg - prevWeightKg) * 10) / 10
      : null;
  return (
    <Card>
      <div className="grid grid-cols-2 divide-x divide-line">
        <div className="pr-4">
          <div className="mb-1 flex items-center gap-1.5 text-faint">
            <Scale className="h-3.5 w-3.5" strokeWidth={2.4} />
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">
              体重
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="stat text-3xl leading-none">
              {weightKg != null ? round(weightKg, 1) : '—'}
            </span>
            {weightKg != null && <span className="text-sm text-muted">kg</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {diff != null && diff !== 0 && (
              <span
                className={`tnum text-[11px] font-semibold ${diff < 0 ? 'text-carb' : 'text-accent-ink'}`}
              >
                前日比 {diff > 0 ? '+' : ''}
                {diff}kg
              </span>
            )}
            {source && (
              <span className="rounded-full bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-faint">
                {source === 'google_health' ? 'GH' : '手入力'}
              </span>
            )}
          </div>
        </div>
        <div className="pl-4">
          <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
            体脂肪
          </div>
          <div className="flex items-baseline gap-1">
            <span className="stat text-3xl leading-none">
              {bodyFatPct != null ? round(bodyFatPct, 1) : '—'}
            </span>
            {bodyFatPct != null && <span className="text-sm text-muted">%</span>}
          </div>
          {weightKg != null && bodyFatPct != null && (
            <div className="mt-1.5 text-[11px] text-faint">
              除脂肪 {round(weightKg * (1 - bodyFatPct / 100), 1)}kg
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============ 栄養(kcal残/超過 + P/F/C + 食塩 を同リズムのバーで) ============
function NutritionCard({
  pfc,
  target,
}: {
  pfc: { kcal: number; p: number; f: number; c: number; salt_g: number };
  target: NutritionTarget | null;
}) {
  const kcal = Math.round(pfc.kcal);
  const remain = target ? Math.round(target.target_kcal - kcal) : null;
  return (
    <Card title="栄養" right={<Flame className="h-4 w-4 text-accent" strokeWidth={2.2} />}>
      <div className="flex items-baseline justify-between">
        <Stat value={kcal} unit="kcal" />
        {target ? (
          <span
            className={`text-sm font-semibold ${remain != null && remain < 0 ? 'text-accent-ink' : 'text-muted'}`}
          >
            {remain != null && remain >= 0 ? `残り ${remain}` : `${Math.abs(remain!)} 超過`} kcal
          </span>
        ) : (
          <span className="text-xs text-faint">目標未設定 → 設定</span>
        )}
      </div>
      <div className="mt-4 space-y-2.5">
        <Bar label="Protein" v={pfc.p} t={target?.target_protein_g} varName="--color-protein" />
        <Bar label="Fat" v={pfc.f} t={target?.target_fat_g} varName="--color-fat" />
        <Bar label="Carbs" v={pfc.c} t={target?.target_carbs_g} varName="--color-carb" />
        <Bar
          label="食塩"
          v={pfc.salt_g}
          t={target?.target_salt_g ?? 6}
          varName="--color-muted"
          overWarn
          unit="g"
        />
      </div>
    </Card>
  );
}

// ============ 今日の食事(独立カード。種目名つき) ============
function MealsCard({
  meals,
  date,
  onEdit,
}: {
  meals: TodayMeal[];
  date: string;
  onEdit: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: api.deleteMeal,
    onSuccess: () => {
      setConfirmId(null);
      qc.invalidateQueries({ queryKey: ['today', date] });
      qc.invalidateQueries({ queryKey: ['trends'] });
    },
  });
  return (
    <Card title="今日の食事" right={<Utensils className="h-4 w-4 text-faint" strokeWidth={2.2} />}>
      {meals.length === 0 ? (
        <p className="py-2 text-sm text-faint">まだ記録がありません。＋から食事を記録できます。</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {meals.map((m) => {
            const kcal = Math.round(m.items.reduce((a, i) => a + i.calories_kcal, 0));
            const name = m.items[0]?.food_name ?? mealTypeJa(m.meal_type);
            const isGh = m.source === 'google_health';
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5 last:border-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{name}</span>
                  <span className="text-[11px] text-faint">{mealTypeJa(m.meal_type)}</span>
                </span>
                {isGh ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="tnum text-muted">{kcal} kcal</span>
                    <span className="rounded-full bg-paper px-1.5 py-0.5 text-[9px] font-semibold text-faint">
                      GH
                    </span>
                  </span>
                ) : confirmId === m.id ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => del.mutate(m.id)}
                      disabled={del.isPending}
                      className="rounded-md bg-accent px-2 py-1 text-xs font-bold text-card disabled:opacity-50"
                    >
                      削除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="text-xs font-semibold text-muted"
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="tnum text-muted">{kcal} kcal</span>
                    <button
                      type="button"
                      aria-label="編集"
                      onClick={() => onEdit(m.id)}
                      className="p-1 text-faint active:text-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                    <button
                      type="button"
                      aria-label="削除"
                      onClick={() => setConfirmId(m.id)}
                      className="p-1 text-faint active:text-accent"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ============ 睡眠(積層バー + 凡例 + 就寝→起床) ============
const SLEEP_STAGES: Array<{ key: keyof SleepSummary; label: string; color: string }> = [
  { key: 'deep_min', label: 'Deep', color: '#155e63' },
  { key: 'rem_min', label: 'REM', color: '#6b63c9' },
  { key: 'light_min', label: 'Light', color: '#4c9aa0' },
  { key: 'awake_min', label: 'Awake', color: '#cbb89a' },
];
function SleepCard({ sleep }: { sleep: SleepSummary | null }) {
  return (
    <Card title="睡眠" right={<Moon className="h-4 w-4 text-carb" strokeWidth={2.2} />}>
      {sleep ? (
        <div>
          <div className="flex items-baseline gap-3">
            <Stat value={Math.floor(sleep.total_min / 60)} unit="h" />
            <Stat value={sleep.total_min % 60} unit="m" />
            <div className="ml-auto text-right">
              {sleep.end_at > sleep.start_at && (
                <div className="tnum text-xs font-semibold text-muted">
                  {hhmm(sleep.start_at)} → {hhmm(sleep.end_at)}
                </div>
              )}
              {sleep.efficiency != null && (
                <div className="text-[11px] text-faint">効率 {sleep.efficiency}%</div>
              )}
            </div>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-line">
            {SLEEP_STAGES.map((s) => {
              const min = (sleep[s.key] as number | null) ?? 0;
              if (min <= 0) return null;
              return (
                <div
                  key={s.label}
                  style={{ flexGrow: min, backgroundColor: s.color }}
                  title={`${s.label} ${min}m`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {SLEEP_STAGES.map((s) => {
              const min = (sleep[s.key] as number | null) ?? null;
              if (min == null) return null;
              return (
                <span key={s.label} className="flex items-center gap-1 text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label} {Math.floor(min / 60)}h{min % 60}m
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="py-2 text-sm text-faint">睡眠データなし(Google Health 同期待ち)。</p>
      )}
    </Card>
  );
}

// ============ センシング(日次) ============
const METRIC_META: Record<string, { label: string; Icon: typeof HeartPulse; unit?: string }> = {
  resting_hr: { label: '安静時心拍', Icon: HeartPulse, unit: 'bpm' },
  hrv_rmssd: { label: 'HRV', Icon: Activity, unit: 'ms' },
  spo2_avg: { label: 'SpO₂', Icon: Activity, unit: '%' },
  resp_rate: { label: '呼吸数', Icon: Wind, unit: '/min' },
  vo2max: { label: 'VO₂max', Icon: Activity },
  steps: { label: '歩数', Icon: Footprints, unit: '歩' },
};
function SensingCard({ daily }: { daily: Array<{ metric: string; value: number; unit: string }> }) {
  const shown = daily.filter((d) => METRIC_META[d.metric]);
  if (shown.length === 0) return null;
  return (
    <Card
      title="センシング"
      right={<HeartPulse className="h-4 w-4 text-accent" strokeWidth={2.2} />}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {shown.map((d) => {
          const meta = METRIC_META[d.metric]!;
          const Icon = meta.Icon;
          const val =
            d.metric === 'steps' ? Math.round(d.value).toLocaleString() : round(d.value, 1);
          return (
            <div key={d.metric} className="flex items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.2} />
              <div className="min-w-0">
                <div className="text-[11px] text-faint">{meta.label}</div>
                <div className="tnum text-sm font-semibold">
                  {val}
                  <span className="ml-0.5 text-[11px] font-normal text-muted">
                    {meta.unit ?? d.unit}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ============ 共通: 目標バー(P/F/C/食塩) ============
function Bar({
  label,
  v,
  t,
  varName,
  unit = 'g',
  overWarn = false,
}: {
  label: string;
  v: number;
  t?: number;
  varName: string;
  unit?: string;
  overWarn?: boolean;
}) {
  const pct = t && t > 0 ? Math.min(100, (v / t) * 100) : 0;
  const over = t != null && v > t;
  const barColor = overWarn && over ? 'var(--color-accent)' : `var(${varName})`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold" style={{ color: barColor }}>
          {label}
        </span>
        <span
          className={`tnum ${overWarn && over ? 'font-semibold text-accent-ink' : 'text-muted'}`}
        >
          {Math.round(v * 10) / 10}
          {t ? ` / ${Math.round(t)}${unit}` : unit}
          {over && !overWarn ? ` (+${Math.round(v - t)})` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

// GH 同期ヘルス: 再認証要 or 同期エラーがあれば警告(黙殺防止)。
function SyncHealthBanner() {
  const q = useQuery({ queryKey: ['sync-status'], queryFn: api.syncStatus, staleTime: 60_000 });
  if (!q.data) return null;
  const { authError, runs, pushQueue } = q.data;
  const failing = runs.filter((r) => r.consecutive_failures > 0 && r.last_error);
  const dead = pushQueue?.deadLetter ?? 0;
  if (!authError && failing.length === 0 && dead === 0) return null;
  const msg = authError
    ? 'GH 再認証が必要です。tools/oauth-bootstrap を再実行してください。'
    : dead > 0
      ? `GH への反映に${dead}件失敗(要対応)。権限/スコープを確認してください。`
      : `GH 同期エラー: ${failing
          .slice(0, 2)
          .map((r) => r.data_type)
          .join(', ')}${failing.length > 2 ? ` 他${failing.length - 2}` : ''}`;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2.5 text-sm text-accent-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
      <div className="min-w-0">
        <div className="font-semibold">{msg}</div>
        {!authError && failing[0]?.last_error && (
          <div className="mt-0.5 truncate text-[11px] text-muted">{failing[0].last_error}</div>
        )}
      </div>
    </div>
  );
}

function DateNav({
  date,
  isToday,
  onPrev,
  onNext,
  onToday,
}: {
  date: string;
  isToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const d = new Date(`${date}T00:00:00+09:00`);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        aria-label="前日"
        onClick={onPrev}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
      </button>
      <button type="button" onClick={onToday} className="flex items-baseline gap-2">
        <span className="stat text-2xl">{isToday ? '今日' : date.slice(5).replace('-', '/')}</span>
        <span className="text-sm font-semibold text-muted">({wd})</span>
      </button>
      <button
        type="button"
        aria-label="翌日"
        onClick={onNext}
        disabled={isToday}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60 disabled:opacity-25"
      >
        <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
      </button>
    </div>
  );
}

function mealTypeJa(t: string): string {
  return (
    {
      Breakfast: '朝食',
      MorningSnack: '午前間食',
      Lunch: '昼食',
      AfternoonSnack: '午後間食',
      Dinner: '夕食',
      Anytime: '間食',
    }[t] ?? t
  );
}

export function Loading() {
  return <div className="py-24 text-center text-sm text-faint">読み込み中…</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm text-accent-ink">
      エラー: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
