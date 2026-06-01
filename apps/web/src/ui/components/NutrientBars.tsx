import type { NutritionTarget } from '../lib/api';

/**
 * 栄養素の唯一の可視化(対目標%の横バー)。P/F/C/塩/繊維 を同一言語で並置。
 * レーダー等との混在を避けるため、マクロ/栄養素は全画面でこのコンポーネントに統一する。
 *
 * - P/F/C/繊維 = 多いほど良い: 目標到達でバー満タン、超過は `(+N)` 注記(色は素材色のまま)。
 * - 塩 = 少ないほど良い(反転): 目標(<6g)以内は muted、超過時のみ accent + ⚠。
 * - 繊維がデータ無し(0)のとき「— / 20g(未捕捉)」のグレー表示(将来埋まることを示す)。
 */
export function NutrientBars({
  values,
  target,
  showContribution = false,
}: {
  values: { p: number; f: number; c: number; salt_g: number; fiber_g: number; kcal?: number };
  target: NutritionTarget | null;
  showContribution?: boolean;
}) {
  // カロリー寄与%(P/C=4, F=9)。区分詳細の副情報。
  const pK = values.p * 4;
  const fK = values.f * 9;
  const cK = values.c * 4;
  const totK = pK + fK + cK || 1;
  const contrib = { p: (pK / totK) * 100, f: (fK / totK) * 100, c: (cK / totK) * 100 };

  return (
    <div className="space-y-2.5">
      <Row
        label="Protein"
        value={values.p}
        target={target?.target_protein_g}
        color="var(--color-protein)"
        contribution={showContribution ? contrib.p : undefined}
      />
      <Row
        label="Fat"
        value={values.f}
        target={target?.target_fat_g}
        color="var(--color-fat)"
        contribution={showContribution ? contrib.f : undefined}
      />
      <Row
        label="Carbs"
        value={values.c}
        target={target?.target_carbs_g}
        color="var(--color-carb)"
        contribution={showContribution ? contrib.c : undefined}
      />
      <Row
        label="食塩"
        value={values.salt_g}
        target={target?.target_salt_g ?? 6}
        color="var(--color-muted)"
        inverted
      />
      <Row
        label="食物繊維"
        value={values.fiber_g}
        target={target?.target_fiber_g ?? 20}
        color="var(--color-fiber)"
        uncaptured={values.fiber_g <= 0}
      />
    </div>
  );
}

function Row({
  label,
  value,
  target,
  color,
  inverted = false,
  uncaptured = false,
  contribution,
}: {
  label: string;
  value: number;
  target?: number;
  color: string;
  inverted?: boolean;
  uncaptured?: boolean;
  contribution?: number;
}) {
  const t = target && target > 0 ? target : 0;
  const pct = t ? Math.min(100, (value / t) * 100) : 0;
  const over = t > 0 && value > t;
  // 塩は超過のみ警告色。それ以外は素材色。未捕捉はグレー。
  const barColor = uncaptured
    ? 'var(--color-line)'
    : inverted && over
      ? 'var(--color-accent)'
      : color;
  const rounded = Math.round(value * 10) / 10;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-baseline gap-1.5">
          <span
            className="font-semibold"
            style={{ color: uncaptured ? 'var(--color-faint)' : color }}
          >
            {label}
          </span>
          {contribution != null && !uncaptured && (
            <span className="text-[10px] text-faint">寄与{Math.round(contribution)}%</span>
          )}
        </span>
        <span
          className={`tnum ${inverted && over ? 'font-semibold text-accent-ink' : uncaptured ? 'text-faint' : 'text-muted'}`}
        >
          {uncaptured ? '—' : rounded}
          {t ? ` / ${Math.round(t)}` : ''}
          {label === '食塩' || label === '食物繊維' ? 'g' : 'g'}
          {over && !inverted ? ` (+${Math.round(value - t)})` : ''}
          {inverted && over ? ' ⚠' : ''}
          {uncaptured ? ' 未捕捉' : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${uncaptured ? 0 : pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}
