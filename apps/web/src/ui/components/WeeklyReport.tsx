import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { api } from '../lib/api';
import { formatDateForDisplay } from '../lib/datetime';
import { MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';
import { saltFromSodiumMg } from '../lib/units';
import { NutrientBars } from './NutrientBars';
import { ReportStat, ShareImageModal } from './ShareImageModal';

const RAMP = HEATMAP_RAMP;
const BASE_BODY = '#c2b8a6';

function bucket(i: number): number {
  if (i <= 0.02) return 0;
  return Math.min(5, Math.max(1, Math.ceil(i * 5)));
}

/** 総挙上量(kg)を身近な物に例える(さりげなく出す用)。1以上になる最大の物を選ぶ。 */
function tonnageBrag(totalKg: number): string | null {
  if (totalKg <= 0) return null;
  const items = [
    { kg: 6000, label: 'アフリカゾウ', unit: '頭', emoji: '🐘' },
    { kg: 1500, label: '乗用車', unit: '台', emoji: '🚗' },
    { kg: 400, label: 'グランドピアノ', unit: '台', emoji: '🎹' },
    { kg: 130, label: '力士', unit: '人', emoji: '🟤' },
  ];
  for (const it of items) {
    const n = totalKg / it.kg;
    if (n >= 1) {
      const c = n < 10 ? n.toFixed(1) : String(Math.round(n));
      return `${it.emoji} ${it.label} 約${c}${it.unit}分`;
    }
  }
  return null;
}

function fmtSleep(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? `${m}m` : ''}`;
}

/**
 * 週間サマリーのシェアレポート(直近7日の総合ラップ: トレ/食事/睡眠/コンディション/体重)。
 * 共通台紙 ShareImageModal に乗せる。総挙上量は物に例えてさりげなく忍ばせる。
 */
export function WeeklyReport({ onClose }: { onClose: () => void }) {
  const week = useQuery({ queryKey: ['weekly-summary'], queryFn: api.weeklySummary });
  const mv = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  const d = week.data;

  // 人体図(直近7日に効かせた部位)。
  const slugBucket = new Map<Muscle, number>();
  for (const m of mv.data?.muscles ?? []) {
    const b = bucket(m.stimulus);
    for (const slug of MUSCLE_TO_SLUGS[m.muscle] ?? []) {
      if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
    }
  }
  const bodyData: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));

  const tons = d ? d.training.volumeKg / 1000 : 0;
  const brag = d ? tonnageBrag(d.training.volumeKg) : null;
  const nutrients = d
    ? {
        kcal: d.nutrition.avgKcal,
        p: d.nutrition.avgP,
        f: d.nutrition.avgF,
        c: d.nutrition.avgC,
        salt_g: Math.round(saltFromSodiumMg(d.nutrition.avgSodiumMg) * 10) / 10,
        fiber_g: d.nutrition.avgFiberG,
      }
    : null;
  const rangeLabel = d
    ? `${formatDateForDisplay(d.range.start)} – ${formatDateForDisplay(d.range.end)}`
    : '';

  return (
    <ShareImageModal
      heading="週間サマリー"
      filename={d ? `logbook-week-${d.range.end}.png` : 'logbook-week.png'}
      headerRight={
        <span className="tnum whitespace-nowrap text-[12px] font-semibold text-muted">
          {rangeLabel}
        </span>
      }
      onClose={onClose}
      disabled={week.isLoading || mv.isLoading}
    >
      {/* タイトル */}
      <div className="mt-4">
        <div className="font-display text-[26px] font-extrabold leading-tight tracking-tight">
          今週のまとめ
        </div>
      </div>

      {/* トレーニング */}
      <SectionLabel>トレーニング</SectionLabel>
      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <ReportStat label="セッション" value={String(d?.training.sessions ?? 0)} unit="回" />
        <ReportStat
          label="総挙上"
          value={tons.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          unit="t"
        />
        <ReportStat label="自己ベスト" value={String(d?.training.prs ?? 0)} unit="PR" />
      </div>
      {brag && (
        <div className="mt-1.5 text-center text-[11px] font-medium text-faint">
          今週の総挙上 ≈ {brag}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-1 [&_svg]:h-auto [&_svg]:max-h-[26vh] [&_svg]:w-full">
        <Model type="anterior" data={bodyData} highlightedColors={RAMP} bodyColor={BASE_BODY} />
        <Model type="posterior" data={bodyData} highlightedColors={RAMP} bodyColor={BASE_BODY} />
      </div>

      {/* 栄養(1日平均) */}
      <SectionLabel>栄養 — 1日平均</SectionLabel>
      <div className="rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        {nutrients && (d?.nutrition.daysLogged ?? 0) > 0 ? (
          <NutrientBars values={nutrients} target={d?.target ?? null} />
        ) : (
          // 記録ゼロは「0/目標」のバーだと絶食と誤読されるため「記録なし」と明示。
          <p className="py-1 text-center text-[12px] text-faint">この期間の食事記録はありません</p>
        )}
        <div className="mt-2 text-[10px] text-faint">記録 {d?.nutrition.daysLogged ?? 0}/7 日</div>
      </div>

      {/* 睡眠・コンディション */}
      <SectionLabel>睡眠・コンディション</SectionLabel>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <MiniStat
          label="平均睡眠"
          value={fmtSleep(d?.sleep.avgTotalMin ?? null)}
          sub={d?.sleep.avgEfficiency != null ? `効率${d.sleep.avgEfficiency}%` : undefined}
        />
        <MiniStat
          label="平均歩数"
          value={d?.sensing.avgSteps != null ? d.sensing.avgSteps.toLocaleString() : '—'}
        />
        <MiniStat
          label="平均消費"
          value={d?.sensing.avgActiveKcal != null ? d.sensing.avgActiveKcal.toLocaleString() : '—'}
          sub="kcal"
        />
        <MiniStat
          label="体重"
          value={d?.body.endKg != null ? String(d.body.endKg) : '—'}
          sub={
            d?.body.deltaKg != null ? `${d.body.deltaKg >= 0 ? '+' : ''}${d.body.deltaKg}kg` : 'kg'
          }
        />
      </div>
    </ShareImageModal>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 mb-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
      {children}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="tnum text-[13px] font-semibold text-ink">
        {value}
        {sub && <span className="ml-1 text-[10px] font-normal text-muted">{sub}</span>}
      </span>
    </div>
  );
}
