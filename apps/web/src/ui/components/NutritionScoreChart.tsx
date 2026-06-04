import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import type { NutritionScopeScore } from '../lib/api';
import { CHART } from './chart';

/**
 * 栄養スコアのレーダー(マクロ目標適合度)。設計: docs/nutrition-scoring-design.md §6。
 * score(0..1)を半径に打つ(生の量/目標比でなく score=過剰も内側に凹む)。外周=理想(100%)。
 * 欠損軸は「— データ無し」(0にしない)。recharts は lazy チャンクに同梱。
 */

// ideal=緑、過不足(low/high)=アクセント、na=フェイント。
const zoneColor = (zone: string) =>
  zone === 'ideal' ? CHART.carb : zone === 'na' ? CHART.faint : CHART.accent;

const GATE_LABEL: Record<string, string | null> = {
  over: '超過',
  under: '赤字',
  ok: null,
  na: null,
};

export function NutritionScoreChart({ score }: { score: NutritionScopeScore }) {
  const data = score.axes.map((a) => ({
    axis: a.labelJa,
    pct: a.score != null ? Math.round(a.score * 100) : null,
  }));
  const overallPct = score.overall != null ? Math.round(score.overall * 100) : null;
  const cal = score.calories;
  const gate = GATE_LABEL[cal.gate];

  return (
    <div>
      {/* 総合スコア + カロリー収支(カロリーは頂点でなくここに実数表示・§4.5) */}
      <div className="mb-1 flex items-baseline justify-between">
        <span className="flex items-baseline gap-1">
          <span className="stat text-3xl">{overallPct ?? '—'}</span>
          {overallPct != null && <span className="text-xs font-semibold text-muted">/ 100</span>}
        </span>
        {cal.target != null && (
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <span className="tnum">
              {cal.kcal.toLocaleString()} / {cal.target.toLocaleString()} kcal
            </span>
            {gate && (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 font-semibold text-accent-ink">
                {gate}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={data}
            outerRadius="70%"
            margin={{ top: 10, right: 14, bottom: 10, left: 14 }}
          >
            <PolarGrid stroke={CHART.line} />
            <PolarAngleAxis dataKey="axis" tick={{ fill: CHART.faint, fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="pct"
              stroke={CHART.accent}
              fill={CHART.accent}
              fillOpacity={0.26}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* 軸の実測値/目標と zone。na は「—」で明示(0と区別)。軸数は scope で可変(day=5/category=4)。 */}
      <div
        className="mt-1 grid gap-1 text-center"
        style={{ gridTemplateColumns: `repeat(${score.axes.length}, minmax(0, 1fr))` }}
      >
        {score.axes.map((a) => (
          <div key={a.key}>
            <div className="text-[10px] text-faint">{a.labelJa}</div>
            <div className="tnum text-[11px] font-semibold" style={{ color: zoneColor(a.zone) }}>
              {a.score != null ? `${Math.round(a.score * 100)}` : '—'}
            </div>
            <div className="tnum text-[9px] text-faint">
              {a.value != null ? `${a.value}${a.target != null ? `/${a.target}` : ''}` : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
