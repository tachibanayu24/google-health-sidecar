import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Footprints, HeartPulse, Moon, Scale, Wind } from 'lucide-react';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Stat } from '../components/Card';
import { axisTick, CHART, ChartFrame, mmdd, TT } from '../components/chart';
import { Empty, ErrorBox, Loading } from '../components/state';
import { api, type SleepSummary } from '../lib/api';
import { epochToJstHhmm } from '../lib/datetime';
import { round } from '../lib/units';

/** からだ(身体・回復)。GH センシング表示専用 + 体重手入力。単一責務: 体組成/睡眠/日次センサ。 */
export function RecoveryScreen() {
  const today = useQuery({ queryKey: ['today'], queryFn: () => api.today() });
  const trends = useQuery({ queryKey: ['trends', 90], queryFn: () => api.trends(90) });
  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data!;
  const metric = (m: string) => t.daily.find((d) => d.metric === m)?.value ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <WeeklySnapshot
        sleepMin={t.sleep?.total_min ?? null}
        hrv={metric('hrv_rmssd')}
        rhr={metric('resting_hr')}
      />
      <BodyComposition body={t.body} series={trends.data?.body ?? []} loading={trends.isLoading} />
      <SleepQuality sleep={t.sleep} />
      <DailySensing daily={t.daily} />
    </div>
  );
}

// ============ 週間スナップショット(睡眠 / HRV / 安静時心拍) ============
function WeeklySnapshot({
  sleepMin,
  hrv,
  rhr,
}: {
  sleepMin: number | null;
  hrv: number | null;
  rhr: number | null;
}) {
  return (
    <Card>
      <div className="grid grid-cols-3 divide-x divide-line">
        <SnapStat
          Icon={Moon}
          label="睡眠"
          value={
            sleepMin != null
              ? `${Math.floor(sleepMin / 60)}:${String(sleepMin % 60).padStart(2, '0')}`
              : '—'
          }
        />
        <SnapStat Icon={Activity} label="HRV" value={hrv != null ? round(hrv, 0) : '—'} unit="ms" />
        <SnapStat
          Icon={HeartPulse}
          label="安静時心拍"
          value={rhr != null ? round(rhr, 0) : '—'}
          unit="bpm"
        />
      </div>
    </Card>
  );
}
function SnapStat({
  Icon,
  label,
  value,
  unit,
}: {
  Icon: typeof Moon;
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="flex flex-col items-center px-1">
      <Icon className="h-4 w-4 text-faint" strokeWidth={2.2} />
      <div className="mt-1 flex items-baseline gap-0.5">
        <span className="stat text-xl leading-none">{value}</span>
        {unit && <span className="text-[10px] text-muted">{unit}</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-faint">{label}</div>
    </div>
  );
}

// ============ 体組成(体重+体脂肪 90日 dual line + 現在値 + 手入力) ============
function BodyComposition({
  body,
  series,
  loading,
}: {
  body: { weightKg: number | null; bodyFatPct: number | null; prevWeightKg: number | null };
  series: Array<{ date: string; weight_kg: number | null; body_fat_pct: number | null }>;
  loading: boolean;
}) {
  const diff =
    body.weightKg != null && body.prevWeightKg != null
      ? Math.round((body.weightKg - body.prevWeightKg) * 10) / 10
      : null;
  const hasW = series.some((b) => b.weight_kg != null);
  const hasF = series.some((b) => b.body_fat_pct != null);
  return (
    <Card title="体組成" right={<span className="text-[11px] text-faint">90日</span>}>
      <div className="mb-3 flex items-end gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="stat text-3xl leading-none">
              {body.weightKg != null ? round(body.weightKg, 1) : '—'}
            </span>
            <span className="text-sm text-muted">kg</span>
          </div>
          {diff != null && diff !== 0 && (
            <span
              className={`tnum text-[11px] font-semibold ${diff < 0 ? 'text-carb' : 'text-accent-ink'}`}
            >
              前日比 {diff > 0 ? '+' : ''}
              {diff}kg
            </span>
          )}
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="stat text-2xl leading-none" style={{ color: CHART.fat }}>
              {body.bodyFatPct != null ? round(body.bodyFatPct, 1) : '—'}
            </span>
            <span className="text-sm text-muted">%</span>
          </div>
          <span className="text-[11px] text-faint">体脂肪</span>
        </div>
        <div className="ml-auto">
          <WeightLogger />
        </div>
      </div>
      {loading ? (
        <Empty note="読み込み中…" />
      ) : hasW || hasF ? (
        <ChartFrame>
          <LineChart data={series} margin={{ top: 6, right: 0, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={CHART.line} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={mmdd}
              tick={axisTick}
              stroke={CHART.line}
              minTickGap={28}
            />
            <YAxis
              yAxisId="w"
              tick={axisTick}
              stroke={CHART.line}
              domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]}
              width={34}
            />
            <YAxis yAxisId="f" orientation="right" tick={axisTick} stroke={CHART.line} width={28} />
            <Tooltip content={<TT unit="" />} />
            <Line
              yAxisId="w"
              type="monotone"
              dataKey="weight_kg"
              name="体重"
              stroke={CHART.ink}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="f"
              type="monotone"
              dataKey="body_fat_pct"
              name="体脂肪"
              stroke={CHART.fat}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartFrame>
      ) : (
        <Empty note="体重は Google Health 同期 or 手入力で表示されます。" />
      )}
    </Card>
  );
}

/** 体重(+任意で体脂肪)の手入力。GH へも best-effort push(§5.2)。 */
function WeightLogger() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [w, setW] = useState<number | null>(null);
  const [bf, setBf] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.logWeight({ entryValue: w, entryUnit: 'kg', bodyFatPct: bf ?? undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['trends'] });
      setOpen(false);
      setW(null);
      setBf(null);
    },
  });
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted"
      >
        <Scale className="h-3.5 w-3.5" strokeWidth={2.2} /> 記録
      </button>
    );
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div className="rise relative w-full max-w-md rounded-t-3xl bg-card px-5 pb-8 pt-5 shadow-[0_-12px_40px_-12px] shadow-ink/30">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" />
        <div className="mb-3 font-display text-base font-bold">体重を記録</div>
        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-semibold text-faint">体重 (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              // biome-ignore lint/a11y/noAutofocus: シート展開直後の主入力にフォーカスは妥当
              autoFocus
              value={w ?? ''}
              onChange={(e) => setW(e.target.value === '' ? null : Number(e.target.value))}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold tnum outline-none focus:border-accent focus:bg-card"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-semibold text-faint">体脂肪 (%) 任意</span>
            <input
              type="number"
              inputMode="decimal"
              value={bf ?? ''}
              onChange={(e) => setBf(e.target.value === '' ? null : Number(e.target.value))}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold tnum outline-none focus:border-accent focus:bg-card"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={w == null || save.isPending}
          onClick={() => save.mutate()}
          className="mt-4 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-card disabled:opacity-40"
        >
          {save.isPending ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

// ============ 睡眠の質(ステージ積層 + 凡例 + 就寝→起床) ============
const SLEEP_STAGES: Array<{ key: keyof SleepSummary; label: string; color: string }> = [
  { key: 'deep_min', label: 'Deep', color: '#155e63' },
  { key: 'rem_min', label: 'REM', color: '#6b63c9' },
  { key: 'light_min', label: 'Light', color: '#4c9aa0' },
  { key: 'awake_min', label: 'Awake', color: '#cbb89a' },
];
function SleepQuality({ sleep }: { sleep: SleepSummary | null }) {
  return (
    <Card title="睡眠の質" right={<Moon className="h-4 w-4 text-carb" strokeWidth={2.2} />}>
      {sleep ? (
        <div>
          <div className="flex items-baseline gap-3">
            <Stat value={Math.floor(sleep.total_min / 60)} unit="h" />
            <Stat value={sleep.total_min % 60} unit="m" />
            <div className="ml-auto text-right">
              {sleep.end_at > sleep.start_at && (
                <div className="tnum text-xs font-semibold text-muted">
                  {epochToJstHhmm(sleep.start_at)} → {epochToJstHhmm(sleep.end_at)}
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
        <Empty note="睡眠データなし(Google Health 同期待ち)。" />
      )}
    </Card>
  );
}

// ============ 日次センシング(歩数/SpO2/呼吸/VO2max) ============
const SENSING_META: Record<string, { label: string; Icon: typeof HeartPulse; unit?: string }> = {
  steps: { label: '歩数', Icon: Footprints, unit: '歩' },
  spo2_avg: { label: 'SpO₂', Icon: Activity, unit: '%' },
  resp_rate: { label: '呼吸数', Icon: Wind, unit: '/min' },
  vo2max: { label: 'VO₂max', Icon: Activity },
};
function DailySensing({
  daily,
}: {
  daily: Array<{ metric: string; value: number; unit: string }>;
}) {
  const shown = daily.filter((d) => SENSING_META[d.metric]);
  if (shown.length === 0) return null;
  return (
    <Card
      title="センシング"
      right={<HeartPulse className="h-4 w-4 text-accent" strokeWidth={2.2} />}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {shown.map((d) => {
          const meta = SENSING_META[d.metric]!;
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
