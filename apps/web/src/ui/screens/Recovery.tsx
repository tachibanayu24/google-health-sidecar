import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Flame,
  Footprints,
  Gauge,
  HeartPulse,
  Moon,
  Thermometer,
  Wind,
} from 'lucide-react';
import { Card, Stat } from '../components/Card';
import { Empty, ErrorBox, Loading } from '../components/state';
import { api, type Readiness, type ReadinessContributor, type SleepSummary } from '../lib/api';
import {
  DOW_JA,
  epochToJstHhmm,
  formatDateForDisplay,
  jstDayOfWeek,
  shiftDate,
  todayJst,
} from '../lib/datetime';
import { round } from '../lib/units';

/**
 * からだ = 「ちゃんと回復できているか」を選択日で見る表示専用ダッシュボード(睡眠・HRV・安静時心拍・センシング)。
 * 日付切替で前日以前の回復も確認可。体組成の推移はホームのミニグラフ、体重記録は中央+ボタンへ移設。
 */
export function RecoveryScreen({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (date: string) => void;
}) {
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const readiness = useQuery({ queryKey: ['readiness', date], queryFn: () => api.readiness(date) });
  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data!;
  const metric = (m: string) => t.daily.find((d) => d.metric === m)?.value ?? null;
  const isToday = date === todayJst();
  const wd = DOW_JA[jstDayOfWeek(date)];

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-1">
        <h1 className="font-display text-lg font-bold tracking-tight">からだ</h1>
        {/* 日付ステッパー(前日以前の睡眠・回復・センシングを確認) */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="前日"
            onClick={() => onDateChange(shiftDate(date, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => onDateChange(todayJst())}
            className="min-w-14 text-center text-sm font-semibold"
          >
            {isToday ? '今日' : formatDateForDisplay(date)}
            <span className="ml-1 text-xs text-muted">({wd})</span>
          </button>
          <button
            type="button"
            aria-label="翌日"
            onClick={() => onDateChange(shiftDate(date, 1))}
            disabled={isToday}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60 disabled:opacity-25"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {readiness.data && <ReadinessCard data={readiness.data} />}
      <RecoveryCard sleep={t.sleep} hrv={metric('hrv_rmssd')} rhr={metric('resting_hr')} />
      <DailySensing daily={t.daily} />
    </div>
  );
}

// ============ Readiness(コンディション信号 = 個人ベースライン比の相対逸脱) ============
const SIGNAL_STYLE = {
  green: { color: '#2f9e6e', label: '良好' },
  yellow: { color: '#c98a2b', label: '注意' },
  red: { color: '#e0521f', label: '要注意' },
} as const;

/**
 * 偽の合成スコアは出さず「信号 + 実測値 + あなたの平常範囲」を見せる(実測主義)。
 * 学習中・データ不足は判定を出さず正直に表示。これは診断・予測ではなく自分比の逸脱の提示。
 */
function ReadinessCard({ data }: { data: Readiness }) {
  const { overall } = data;
  const sig = overall.signal ? SIGNAL_STYLE[overall.signal] : null;
  const shown = data.contributors.filter((c) => c.status !== 'no-data' || c.isCore);
  return (
    <Card
      title="コンディション"
      right={<Gauge className="h-4 w-4 text-accent" strokeWidth={2.2} />}
    >
      {/* 総合: 信号ドット + 文言。学習中は灰で正直に。 */}
      <div className="flex items-center gap-2.5">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: sig?.color ?? '#b8ab97' }}
        />
        <div className="min-w-0">
          <div className="text-sm font-bold" style={{ color: sig?.color ?? 'var(--color-muted)' }}>
            {sig?.label ?? '学習中'}
          </div>
          <div className="text-[11px] leading-snug text-muted">{overall.summary}</div>
        </div>
      </div>

      {shown.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line/60 pt-3">
          {shown.map((c) => (
            <ContributorRow key={c.metric} c={c} />
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-snug text-faint">{data.disclaimer}</p>
    </Card>
  );
}

function ContributorRow({ c }: { c: ReadinessContributor }) {
  const sig = c.signal ? SIGNAL_STYLE[c.signal] : null;
  // 矢印は実際にフラグ(黄/赤)が立った逸脱のみ(緑+矢印の紛らわしさを避ける)。
  const flagged = c.signal === 'yellow' || c.signal === 'red';
  const arrow =
    flagged && c.deviation === 'low' ? '↓' : flagged && c.deviation === 'high' ? '↑' : null;
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className={`shrink-0 ${c.isCore ? 'font-bold text-ink' : 'text-muted'}`}>
        {c.label}
      </span>
      {c.status === 'learning' ? (
        <span className="ml-auto text-[11px] text-faint">学習中(あと{c.daysOfData}日分)</span>
      ) : c.status === 'no-data' ? (
        <span className="ml-auto text-[11px] text-faint">データなし</span>
      ) : (
        <>
          <span className="tnum font-semibold" style={{ color: sig?.color ?? 'var(--color-ink)' }}>
            {c.current}
            <span className="ml-0.5 text-[11px] font-normal text-muted">{c.unit}</span>
            {arrow && (
              <span className="ml-0.5" style={{ color: sig?.color ?? 'var(--color-muted)' }}>
                {arrow}
              </span>
            )}
          </span>
          <span className="tnum ml-auto text-[11px] text-faint">
            平常 {c.normalLow}–{c.normalHigh}
          </span>
        </>
      )}
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
/** 回復カード = 睡眠(時間/効率/ステージ/就寝起床)+ HRV + 安静時心拍 を1枚に。「整っているか」を見る。 */
function RecoveryCard({
  sleep,
  hrv,
  rhr,
}: {
  sleep: SleepSummary | null;
  hrv: number | null;
  rhr: number | null;
}) {
  return (
    <Card title="回復" right={<Moon className="h-4 w-4 text-carb" strokeWidth={2.2} />}>
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
                <div className="text-[11px] text-faint">睡眠効率 {sleep.efficiency}%</div>
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
      {/* 自律神経の回復指標(HRV↑/安静時心拍↓ が回復良好の目安)。 */}
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line/60 pt-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.2} />
          <div>
            <div className="text-[11px] text-faint">HRV</div>
            <div className="tnum text-sm font-semibold">
              {hrv != null ? round(hrv, 0) : '—'}
              <span className="ml-0.5 text-[11px] font-normal text-muted">ms</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.2} />
          <div>
            <div className="text-[11px] text-faint">安静時心拍</div>
            <div className="tnum text-sm font-semibold">
              {rhr != null ? round(rhr, 0) : '—'}
              <span className="ml-0.5 text-[11px] font-normal text-muted">bpm</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============ 日次センシング(歩数/消費/SpO2/呼吸/皮膚温/VO2max) ============
const SENSING_META: Record<string, { label: string; Icon: typeof HeartPulse; unit?: string }> = {
  steps: { label: '歩数', Icon: Footprints, unit: '歩' },
  active_energy_kcal: { label: '消費', Icon: Flame, unit: 'kcal' }, // 摂取kcal(食事)との収支に
  spo2_avg: { label: 'SpO₂', Icon: Activity, unit: '%' },
  resp_rate: { label: '呼吸数', Icon: Wind, unit: '/min' },
  skin_temp_c: { label: '皮膚温', Icon: Thermometer, unit: '℃' }, // 夜間皮膚温(readiness 材料)
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
            d.metric === 'steps' || d.metric === 'active_energy_kcal'
              ? Math.round(d.value).toLocaleString()
              : round(d.value, 1);
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
