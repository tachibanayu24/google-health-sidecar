import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Dumbbell,
  Flame,
  HeartPulse,
  RefreshCw,
  Scale,
  Share2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { NutrientBars } from '../components/NutrientBars';
import { ErrorBox, Loading } from '../components/state';
import { WeeklyReport } from '../components/WeeklyReport';
import { api, type BodyReading, type NutritionTarget, type Today } from '../lib/api';
import { DOW_JA, formatDateForDisplay, jstDayOfWeek, shiftDate, todayJst } from '../lib/datetime';
import { invalidateAfterFlush } from '../lib/invalidate';
import { flushOutbox, pendingCount, subscribeOutbox } from '../lib/outbox';
import { round } from '../lib/units';

/** ホーム = 今日のグランス + 日付ナビ(選択日に各グランスを整合)。詰め込みは排除。 */
export function HomeScreen({
  onOpenNutrition,
  onOpenTraining,
  onOpenRecovery,
  onResume,
}: {
  onOpenNutrition: (date: string) => void;
  onOpenTraining: () => void;
  onOpenRecovery: () => void;
  onResume: () => void;
}) {
  const [date, setDate] = useState(todayJst());
  const [shareWeek, setShareWeek] = useState(false);
  const isToday = date === todayJst();
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  // TrainingGlance 用(トレーニング画面と queryKey 共有 → 二重取得回避)。
  const recent = useQuery({
    queryKey: ['recent-workouts'],
    queryFn: api.recentWorkouts,
    staleTime: 60_000,
  });
  const mv = useQuery({
    queryKey: ['muscle-volume', 7],
    queryFn: () => api.muscleVolume(7),
    staleTime: 60_000,
  });

  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data!;
  const target = settings.data?.nutritionTarget ?? null;
  const worked = (mv.data?.muscles ?? []).filter((m) => m.actual_sets > 0).length;
  // 選択日のワークアウト(無ければ null)。各グランスは選択日に整合させる。
  const daySession = recent.data?.sessions?.find((s) => s.date === date) ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <SyncHealthBanner />
      <OutboxBanner />
      <DateNav
        date={date}
        isToday={isToday}
        onPrev={() => setDate((d) => shiftDate(d, -1))}
        onNext={() => setDate((d) => shiftDate(d, 1))}
        onToday={() => setDate(todayJst())}
      />

      <BodyStrip body={t.body} onOpen={onOpenRecovery} />

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
              onClick={onResume}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-card"
            >
              再開
            </button>
          </div>
        </Card>
      )}

      <NutritionGlance pfc={t.pfc} target={target} onOpen={() => onOpenNutrition(date)} />
      <TrainingGlance
        session={daySession}
        worked={worked}
        isToday={isToday}
        onOpen={onOpenTraining}
      />
      <RecoveryGlance sleep={t.sleep} daily={t.daily} onOpen={onOpenRecovery} />

      <button
        type="button"
        onClick={() => setShareWeek(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-card/60 py-3 text-sm font-semibold text-muted active:scale-[0.99]"
      >
        <Share2 className="h-4 w-4" strokeWidth={2.2} /> 今週のまとめを画像に
      </button>

      {shareWeek && <WeeklyReport onClose={() => setShareWeek(false)} />}
    </div>
  );
}

/** 日付ナビ(±1日/今日)。Home の各グランスは選択日に整合する。 */
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
  const wd = DOW_JA[jstDayOfWeek(date)];
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
        <span className="stat text-2xl">{isToday ? '今日' : formatDateForDisplay(date)}</span>
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

/** グランス用カード: 見出し+右に[詳細›]、カード全体タップで詳細画面へ。 */
function GlanceCard({
  title,
  Icon,
  onOpen,
  children,
}: {
  title: string;
  Icon: typeof Flame;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left">
      <Card
        title={title}
        right={
          <span className="flex items-center gap-1 text-faint">
            <Icon className="h-4 w-4" strokeWidth={2.2} />
            <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
          </span>
        }
      >
        {children}
      </Card>
    </button>
  );
}

// ============ 体組成ストリップ(薄型・タップで からだ) ============
function BodyStrip({ body, onOpen }: { body: BodyReading; onOpen: () => void }) {
  const { weightKg, bodyFatPct, prevWeightKg, source } = body;
  const diff =
    weightKg != null && prevWeightKg != null
      ? Math.round((weightKg - prevWeightKg) * 10) / 10
      : null;
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left">
      <Card>
        <div className="flex items-center">
          <Scale className="mr-3 h-5 w-5 text-faint" strokeWidth={2.2} />
          <div className="flex items-baseline gap-1">
            <span className="stat text-2xl leading-none">
              {weightKg != null ? round(weightKg, 1) : '—'}
            </span>
            <span className="text-xs text-muted">kg</span>
          </div>
          {diff != null && diff !== 0 && (
            <span
              className={`tnum ml-2 text-[11px] font-semibold ${diff < 0 ? 'text-carb' : 'text-accent-ink'}`}
            >
              {diff > 0 ? '+' : ''}
              {diff}
            </span>
          )}
          <div className="ml-auto flex items-baseline gap-1">
            <span className="stat text-xl leading-none" style={{ color: 'var(--color-fat)' }}>
              {bodyFatPct != null ? round(bodyFatPct, 1) : '—'}
            </span>
            <span className="text-xs text-muted">%</span>
          </div>
          {source && (
            <span className="ml-2 rounded-full bg-paper px-1.5 py-0.5 text-[9px] font-semibold text-faint">
              {source === 'google_health' ? 'GH' : '手入力'}
            </span>
          )}
          <ChevronRight className="ml-1.5 h-4 w-4 text-faint" strokeWidth={2.4} />
        </div>
      </Card>
    </button>
  );
}

// ============ 栄養グランス(kcal + 残/超過 + PFC/塩 ミニバー) ============
function NutritionGlance({
  pfc,
  target,
  onOpen,
}: {
  pfc: Today['pfc'];
  target: NutritionTarget | null;
  onOpen: () => void;
}) {
  const kcal = Math.round(pfc.kcal);
  const remain = target ? Math.round(target.target_kcal - kcal) : null;
  return (
    <GlanceCard title="栄養" Icon={Flame} onOpen={onOpen}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1">
          <span className="stat text-3xl leading-none">{kcal.toLocaleString()}</span>
          <span className="text-sm text-muted">kcal</span>
        </div>
        {target ? (
          <span
            className={`text-sm font-semibold ${remain != null && remain < 0 ? 'text-accent-ink' : 'text-muted'}`}
          >
            {remain != null && remain >= 0 ? `残り ${remain}` : `${Math.abs(remain ?? 0)} 超過`}
          </span>
        ) : (
          <span className="text-xs text-accent">目標未設定</span>
        )}
      </div>
      <div className="mt-3">
        <NutrientBars
          values={{ p: pfc.p, f: pfc.f, c: pfc.c, salt_g: pfc.salt_g, fiber_g: pfc.fiber_g }}
          target={target}
        />
      </div>
    </GlanceCard>
  );
}

// ============ トレーニンググランス(選択日のWO + 7日刺激部位[当日のみ]) ============
function TrainingGlance({
  session,
  worked,
  isToday,
  onOpen,
}: {
  session: {
    title: string | null;
    exercises: number;
    sets: number;
    total_volume_kg: number;
  } | null;
  worked: number;
  isToday: boolean;
  onOpen: () => void;
}) {
  return (
    <GlanceCard title="トレーニング" Icon={Dumbbell} onOpen={onOpen}>
      <div className="flex items-end justify-between">
        <div className="min-w-0">
          {session ? (
            <>
              <div className="truncate text-sm font-semibold text-ink">
                {session.title || 'ワークアウト'}
              </div>
              <div className="mt-0.5 text-[11px] text-faint">
                {session.exercises}種目 {session.sets}set ·{' '}
                {Math.round(session.total_volume_kg).toLocaleString()}kg
              </div>
            </>
          ) : (
            <p className="text-sm text-faint">
              {isToday ? '今日はまだ記録なし' : 'この日はトレーニングなし'}
            </p>
          )}
        </div>
        {/* 刺激部位は直近7日の rolling 指標なので当日表示時のみ。 */}
        {isToday && (
          <div className="shrink-0 text-right">
            <span className="stat text-xl leading-none">{worked}</span>
            <span className="text-xs text-muted">/16</span>
            <div className="text-[10px] text-faint">7日 刺激部位</div>
          </div>
        )}
      </div>
    </GlanceCard>
  );
}

// ============ 回復グランス(睡眠 + RHR/HRV/歩数) ============
function RecoveryGlance({
  sleep,
  daily,
  onOpen,
}: {
  sleep: Today['sleep'];
  daily: Today['daily'];
  onOpen: () => void;
}) {
  const metric = (m: string) => daily.find((d) => d.metric === m)?.value ?? null;
  const rhr = metric('resting_hr');
  const hrv = metric('hrv_rmssd');
  const steps = metric('steps');
  const spo2 = metric('spo2_avg');
  return (
    <GlanceCard title="回復" Icon={HeartPulse} onOpen={onOpen}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1">
          {sleep ? (
            <>
              <span className="stat text-2xl leading-none">{Math.floor(sleep.total_min / 60)}</span>
              <span className="text-xs text-muted">h</span>
              <span className="stat ml-1 text-2xl leading-none">{sleep.total_min % 60}</span>
              <span className="text-xs text-muted">m</span>
              {sleep.efficiency != null && (
                <span className="ml-2 text-[11px] text-faint">効率 {sleep.efficiency}%</span>
              )}
            </>
          ) : (
            <span className="text-sm text-faint">睡眠データ待ち</span>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted tnum">
        {rhr != null && <span>RHR {round(rhr, 0)}</span>}
        {hrv != null && <span>HRV {round(hrv, 0)}</span>}
        {spo2 != null && <span>SpO₂ {round(spo2, 0)}%</span>}
        {steps != null && <span>{Math.round(steps).toLocaleString()}歩</span>}
      </div>
    </GlanceCard>
  );
}

// ============ 同期ヘルス + オフライン未送信 バナー ============
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

function usePendingCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const refresh = () => pendingCount().then(setN);
    refresh();
    return subscribeOutbox(refresh);
  }, []);
  return n;
}
function OutboxBanner() {
  const pending = usePendingCount();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  if (pending === 0) return null;
  const flushNow = async () => {
    setSending(true);
    const r = await flushOutbox();
    setSending(false);
    if (r.sent > 0) invalidateAfterFlush(qc);
  };
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm">
      <CloudOff className="h-4 w-4 shrink-0 text-muted" strokeWidth={2.2} />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">未送信 {pending} 件</span>
        <span className="ml-1 text-muted">オンライン復帰時に自動送信</span>
      </div>
      <button
        type="button"
        onClick={flushNow}
        disabled={sending}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-bold text-card disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${sending ? 'animate-spin' : ''}`} strokeWidth={2.4} />{' '}
        今すぐ送信
      </button>
    </div>
  );
}
