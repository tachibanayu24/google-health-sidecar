import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Moon,
  Scale,
  Utensils,
  Wind,
} from 'lucide-react';
import { useState } from 'react';
import { Card, Stat } from '../components/Card';
import { api } from '../lib/api';
import { fmtKg, round } from '../lib/units';

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function shiftDate(date: string, delta: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function HomeScreen({ onGoRecord }: { onGoRecord: () => void }) {
  const [date, setDate] = useState(todayJst());
  const isToday = date === todayJst();
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data!;
  const target = settings.data?.nutritionTarget;
  const deviceWeight = t.body.find((b) => b.source === 'google_health' && b.weight_kg != null);
  const appWeight = t.body.find((b) => b.source === 'app' && b.weight_kg != null);
  const weight = deviceWeight ?? appWeight;
  const hasMeals = t.meals.length > 0;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <DateNav
        date={date}
        isToday={isToday}
        onPrev={() => setDate((d) => shiftDate(d, -1))}
        onNext={() => setDate((d) => shiftDate(d, 1))}
        onToday={() => setDate(todayJst())}
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="mb-1 flex items-center gap-1.5 text-faint">
            <Scale className="h-3.5 w-3.5" strokeWidth={2.4} />
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">
              体重
            </span>
          </div>
          <div className="stat text-2xl leading-none">
            {weight?.weight_kg != null ? round(weight.weight_kg, 1) : '—'}
          </div>
          <div className="mt-1.5 text-[11px] text-muted">
            {weight?.weight_kg != null ? fmtKg(weight.weight_kg) : 'kg / lb'}
          </div>
          {(deviceWeight || appWeight) && <SourceBadge device={!!deviceWeight} />}
        </Card>
        <Card>
          <div className="mb-1 flex items-center gap-1.5 text-faint">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">
              体脂肪
            </span>
          </div>
          <div className="stat text-2xl leading-none">
            {weight?.body_fat_pct != null ? round(weight.body_fat_pct, 1) : '—'}
            {weight?.body_fat_pct != null && <span className="ml-0.5 text-base text-muted">%</span>}
          </div>
        </Card>
      </div>

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

      <Card title="栄養" right={<Flame className="h-4 w-4 text-accent" strokeWidth={2.2} />}>
        <div className="flex items-baseline justify-between">
          <Stat value={Math.round(t.pfc.kcal)} unit="kcal" />
          <span className="text-sm text-muted">
            目標 {target ? Math.round(target.target_kcal) : '—'}
          </span>
        </div>
        <div className="mt-4 space-y-2.5">
          <MacroBar
            label="Protein"
            v={t.pfc.p}
            t={target?.target_protein_g}
            varName="--color-protein"
          />
          <MacroBar label="Fat" v={t.pfc.f} t={target?.target_fat_g} varName="--color-fat" />
          <MacroBar label="Carbs" v={t.pfc.c} t={target?.target_carbs_g} varName="--color-carb" />
        </div>
        <SaltLine v={t.pfc.salt_g} target={target?.target_salt_g ?? 6} />
        {hasMeals && (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
            {t.meals.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink">
                  <Utensils className="h-3.5 w-3.5 text-faint" strokeWidth={2.2} />
                  {mealTypeJa(m.meal_type)}
                </span>
                <span className="tnum text-muted">
                  {Math.round(m.items.reduce((a, i) => a + i.calories_kcal, 0))} kcal
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SleepCard sleep={t.sleep} />
      <SensingCard daily={t.daily} />
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

function SourceBadge({ device }: { device: boolean }) {
  return (
    <span className="mt-2 inline-block rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-faint">
      {device ? 'Google Health' : '手入力'}
    </span>
  );
}

// ============ 睡眠 ============
function SleepCard({ sleep }: { sleep: import('../lib/api').SleepSummary | null }) {
  return (
    <Card title="睡眠" right={<Moon className="h-4 w-4 text-carb" strokeWidth={2.2} />}>
      {sleep ? (
        <div>
          <div className="flex items-baseline gap-3">
            <Stat value={Math.floor(sleep.total_min / 60)} unit="h" />
            <Stat value={sleep.total_min % 60} unit="m" />
            {sleep.efficiency != null && (
              <span className="ml-auto text-sm text-muted">効率 {sleep.efficiency}%</span>
            )}
          </div>
          <div className="mt-3 flex gap-1.5 text-[11px]">
            <StagePill label="Deep" min={sleep.deep_min} color="--color-carb" />
            <StagePill label="Light" min={sleep.light_min} color="--color-muted" />
            <StagePill label="REM" min={sleep.rem_min} color="--color-accent" />
            <StagePill label="Awake" min={sleep.awake_min} color="--color-faint" />
          </div>
        </div>
      ) : (
        <p className="text-sm text-faint">—</p>
      )}
    </Card>
  );
}

function StagePill({ label, min, color }: { label: string; min: number | null; color: string }) {
  if (min == null) return null;
  return (
    <span className="flex-1 rounded-lg bg-paper px-2 py-1.5 text-center">
      <span className="block font-semibold" style={{ color: `var(${color})` }}>
        {label}
      </span>
      <span className="tnum text-muted">{min}m</span>
    </span>
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

function MacroBar({
  label,
  v,
  t,
  varName,
}: {
  label: string;
  v: number;
  t?: number;
  varName: string;
}) {
  const pct = t && t > 0 ? Math.min(100, (v / t) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold" style={{ color: `var(${varName})` }}>
          {label}
        </span>
        <span className="tnum text-muted">
          {Math.round(v)}
          {t ? ` / ${Math.round(t)}g` : 'g'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: `var(${varName})` }}
        />
      </div>
    </div>
  );
}

function SaltLine({ v, target }: { v: number; target: number }) {
  const over = v > target;
  const pct = target > 0 ? Math.min(100, (v / target) * 100) : 0;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-muted">食塩相当量</span>
        <span className={`tnum font-semibold ${over ? 'text-accent-ink' : 'text-muted'}`}>
          {v} / {target} g{over ? ' ⚠' : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: over ? 'var(--color-accent)' : 'var(--color-muted)',
          }}
        />
      </div>
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
