import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { api } from '../lib/api';
import { formatDateForDisplay } from '../lib/datetime';
import { MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';
import { ShareImageModal } from './ShareImageModal';

// 人体図は暗パネル上に「おなじみの暖色ヒートマップ(淡黄→朱=強い刺激)」で直感的に。
const FIG_BODY = '#7c6b5e'; // 未刺激の部位(ミュートグレー)

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
 * 週間サマリーのシェアレポート(直近7日の総合ラップ)。Spotify Wrapped 風の濃色・大型タイポ。
 * 共通台紙 ShareImageModal(tone='bold')に乗せ、総挙上量は物に例えてさりげなく忍ばせる。
 */
export function WeeklyReport({ onClose }: { onClose: () => void }) {
  const week = useQuery({ queryKey: ['weekly-summary'], queryFn: api.weeklySummary });
  const mv = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  const d = week.data;
  const muscles = mv.data?.muscles ?? [];
  const worked = muscles.filter((m) => m.actual_sets > 0).length;

  // 人体図(直近7日に効かせた部位)。
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
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
  const hasFood = (d?.nutrition.daysLogged ?? 0) > 0;
  const delta = d?.body.deltaKg ?? null;
  const rangeLabel = d
    ? `${formatDateForDisplay(d.range.start)} – ${formatDateForDisplay(d.range.end)}`
    : '';

  return (
    <ShareImageModal
      tone="bold"
      heading="週間サマリー"
      filename={d ? `logbook-week-${d.range.end}.png` : 'logbook-week.png'}
      headerRight={
        <span className="tnum whitespace-nowrap text-[12px] font-semibold text-card/75">
          {rangeLabel}
        </span>
      }
      onClose={onClose}
      disabled={week.isLoading || mv.isLoading}
    >
      {/* イントロ */}
      <div className="mt-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.34em] text-card/55">
          Week in review
        </div>
        <div className="mt-1 font-display text-[20px] font-extrabold text-card/95">
          今週のまとめ
        </div>
      </div>

      {/* ヒーロー: 総挙上 */}
      <div className="mt-7">
        <div className="flex items-end gap-2">
          <span className="font-display text-[68px] font-black leading-[0.82] tracking-tight">
            {tons.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
          <span className="mb-2.5 text-lg font-bold text-card/85">トン挙上</span>
        </div>
        {brag && <div className="mt-2 text-[13px] font-semibold text-card/85">≈ {brag}</div>}
      </div>

      {/* モーメント(3-up の大型数字) */}
      <div className="mt-7 grid grid-cols-3 gap-2">
        <Moment value={String(d?.training.sessions ?? 0)} label="セッション" />
        <Moment value={String(d?.training.prs ?? 0)} label="自己ベスト" />
        <Moment value={`${worked}/16`} label="攻めた部位" />
      </div>

      {/* 人体図: 暗パネル + 暖色ヒートマップ(淡黄→朱=強い刺激)。凡例つきで直感的に。 */}
      <div className="mt-6 rounded-2xl px-3 py-3" style={{ background: 'rgba(22,13,8,0.55)' }}>
        <div className="grid grid-cols-2 gap-1 [&_svg]:h-auto [&_svg]:max-h-[24vh] [&_svg]:w-full">
          <Model
            type="anterior"
            data={bodyData}
            highlightedColors={HEATMAP_RAMP}
            bodyColor={FIG_BODY}
          />
          <Model
            type="posterior"
            data={bodyData}
            highlightedColors={HEATMAP_RAMP}
            bodyColor={FIG_BODY}
          />
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[10px] font-medium text-card/75">
          <span className="whitespace-nowrap">刺激 少</span>
          <span
            className="h-1.5 w-24 rounded-full"
            style={{ background: `linear-gradient(90deg, ${FIG_BODY}, ${HEATMAP_RAMP.join(',')})` }}
          />
          <span className="whitespace-nowrap">多</span>
        </div>
      </div>

      {/* 栄養(1日平均) */}
      <div className="mt-7 border-t border-card/20 pt-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-card/55">
          1日平均の栄養
        </div>
        {hasFood && d ? (
          <>
            <div className="mt-1 flex items-end gap-2">
              <span className="font-display text-[42px] font-black leading-none">
                {d.nutrition.avgKcal.toLocaleString()}
              </span>
              <span className="mb-1.5 text-sm font-bold text-card/80">kcal</span>
            </div>
            <div className="mt-1.5 flex gap-4 text-[14px] font-bold tnum text-card/85">
              <span className="whitespace-nowrap">P {d.nutrition.avgP}</span>
              <span className="whitespace-nowrap">F {d.nutrition.avgF}</span>
              <span className="whitespace-nowrap">C {d.nutrition.avgC}</span>
            </div>
          </>
        ) : (
          <div className="mt-2 text-[14px] font-semibold text-card/70">食事の記録なし</div>
        )}
      </div>

      {/* 睡眠 / 体重 */}
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-card/20 pt-5">
        <Block
          label="平均睡眠"
          value={fmtSleep(d?.sleep.avgTotalMin ?? null)}
          sub={d?.sleep.avgEfficiency != null ? `効率 ${d.sleep.avgEfficiency}%` : undefined}
        />
        <Block
          label="体重"
          value={d?.body.endKg != null ? String(d.body.endKg) : '—'}
          unit={d?.body.endKg != null ? 'kg' : undefined}
          sub={delta != null ? `${delta >= 0 ? '+' : ''}${delta}kg / 週` : undefined}
        />
      </div>

      {/* フッタ(コンディション) */}
      {d && (d.sensing.avgSteps != null || d.sensing.avgActiveKcal != null) && (
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold text-card/55">
          {d.sensing.avgSteps != null && (
            <span className="whitespace-nowrap">歩数 {d.sensing.avgSteps.toLocaleString()}/日</span>
          )}
          {d.sensing.avgActiveKcal != null && (
            <span className="whitespace-nowrap">
              消費 {d.sensing.avgActiveKcal.toLocaleString()}kcal/日
            </span>
          )}
          {d.sensing.avgHrv != null && (
            <span className="whitespace-nowrap">HRV {d.sensing.avgHrv}ms</span>
          )}
        </div>
      )}
    </ShareImageModal>
  );
}

function Moment({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-[34px] font-black leading-none">{value}</div>
      <div className="mt-1.5 text-[11px] font-semibold tracking-wide text-card/60">{label}</div>
    </div>
  );
}

function Block({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-card/55">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-display text-[30px] font-black leading-none">{value}</span>
        {unit && <span className="text-sm font-bold text-card/75">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px] font-medium text-card/65">{sub}</div>}
    </div>
  );
}
