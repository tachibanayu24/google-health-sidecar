import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateLong } from '../lib/datetime';
import { MEAL_ORDER, mealTypeJa } from '../lib/meals';
import { saltFromSodiumMg } from '../lib/units';
import { NutrientBars } from './NutrientBars';
import { ReportStat, ShareImageModal } from './ShareImageModal';

/**
 * 食事のシェアレポート(画像エクスポート)。
 * mode='day' で1日まるごと(区分別内訳)、mode='category' で1区分(品目別内訳)を出力。
 * データは today(date) キャッシュを共有。栄養素は全画面共通の NutrientBars で表示。
 */
export function MealReport({
  mode,
  date,
  mealType,
  onClose,
}: {
  mode: 'day' | 'category';
  date: string;
  mealType?: string;
  onClose: () => void;
}) {
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const target = settings.data?.nutritionTarget ?? null;

  const allMeals = today.data?.meals ?? [];
  const meals = mode === 'category' ? allMeals.filter((m) => m.meal_type === mealType) : allMeals;
  const items = meals.flatMap((m) => m.items);

  const tot = items.reduce(
    (a, it) => ({
      kcal: a.kcal + it.calories_kcal,
      p: a.p + it.protein_g,
      f: a.f + it.fat_g,
      c: a.c + it.carbs_g,
      sodium: a.sodium + (it.sodium_mg ?? 0),
      fiber: a.fiber + (it.fiber_g ?? 0),
    }),
    { kcal: 0, p: 0, f: 0, c: 0, sodium: 0, fiber: 0 },
  );
  const nutrients = {
    p: tot.p,
    f: tot.f,
    c: tot.c,
    salt_g: Math.round(saltFromSodiumMg(tot.sodium) * 10) / 10,
    fiber_g: Math.round(tot.fiber * 10) / 10,
  };
  const kcal = Math.round(tot.kcal);

  // day モード: meal_type 別の内訳(記録のある区分のみ・表示順)。
  const byType = MEAL_ORDER.flatMap((type) => {
    const its = allMeals.filter((m) => m.meal_type === type).flatMap((m) => m.items);
    if (its.length === 0) return [];
    const sum = its.reduce(
      (a, it) => ({
        kcal: a.kcal + it.calories_kcal,
        p: a.p + it.protein_g,
        f: a.f + it.fat_g,
        c: a.c + it.carbs_g,
      }),
      { kcal: 0, p: 0, f: 0, c: 0 },
    );
    return [{ type, ...sum, count: its.length }];
  });

  const title = mode === 'day' ? '1日の食事' : mealTypeJa(mealType ?? '');
  const heading = mode === 'day' ? '食事 — 1日' : `食事 — ${mealTypeJa(mealType ?? '')}`;
  // download 名は英字のみに正規化(mealType への不正値混入でのパス分離を防ぐ)。
  const safeType = (mealType ?? '').replace(/[^a-zA-Z]/g, '') || 'meal';
  const filename = mode === 'day' ? `logbook-meal-${date}.png` : `logbook-${safeType}-${date}.png`;
  const diff = target ? target.target_kcal - kcal : null;

  return (
    <ShareImageModal
      heading={heading}
      filename={filename}
      headerRight={
        <span className="tnum whitespace-nowrap text-[12px] font-semibold text-muted">
          {formatDateLong(date)}
        </span>
      }
      onClose={onClose}
      disabled={today.isLoading}
    >
      {/* タイトル */}
      <div className="mt-4">
        <div className="font-display text-[26px] font-extrabold leading-tight tracking-tight">
          {title}
        </div>
        <div className="mt-1 text-[12px] font-semibold text-faint">
          {items.length}品 · {kcal.toLocaleString()} kcal
          {mode === 'day' && target && diff != null
            ? diff >= 0
              ? ` · 目標まで残り ${diff.toLocaleString()}`
              : ` · 目標 +${Math.abs(diff).toLocaleString()} 超過`
            : ''}
        </div>
      </div>

      {/* スタッツ(エネルギー / たんぱく質 / 炭水化物。脂質ほかは下のバー) */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <ReportStat label="エネルギー" value={kcal.toLocaleString()} unit="kcal" />
        <ReportStat label="たんぱく質" value={String(Math.round(tot.p))} unit="g" />
        <ReportStat label="炭水化物" value={String(Math.round(tot.c))} unit="g" />
      </div>

      {/* 栄養素(対目標バー・全画面共通)。区分単体は寄与%も併記。 */}
      <div className="mt-4 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <NutrientBars values={nutrients} target={target} showContribution={mode === 'category'} />
      </div>

      {/* 内訳 */}
      {mode === 'day' ? (
        <div className="mt-4 space-y-1.5">
          {byType.map((g) => (
            <div
              key={g.type}
              className="flex items-center gap-2 rounded-lg bg-card/60 px-2.5 py-1.5 ring-1 ring-line/50"
            >
              <span className="shrink-0 text-[12px] font-bold text-ink">{mealTypeJa(g.type)}</span>
              <span className="shrink-0 text-[10px] text-faint">{g.count}品</span>
              <span className="ml-auto flex gap-2 text-[10px] tnum">
                <span style={{ color: 'var(--color-protein)' }}>P{Math.round(g.p)}</span>
                <span style={{ color: 'var(--color-fat)' }}>F{Math.round(g.f)}</span>
                <span style={{ color: 'var(--color-carb)' }}>C{Math.round(g.c)}</span>
              </span>
              <span className="tnum text-[12px] font-semibold text-ink">
                {Math.round(g.kcal)}
                <span className="text-[10px] text-faint"> kcal</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          {items.map((it, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト
              key={i}
              className="flex items-baseline justify-between gap-2 border-b border-line/40 py-1.5 last:border-0"
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                {it.food_name}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="flex gap-1.5 text-[10px] tnum">
                  <span style={{ color: 'var(--color-protein)' }}>P{Math.round(it.protein_g)}</span>
                  <span style={{ color: 'var(--color-fat)' }}>F{Math.round(it.fat_g)}</span>
                  <span style={{ color: 'var(--color-carb)' }}>C{Math.round(it.carbs_g)}</span>
                </span>
                <span className="tnum text-[12px] font-semibold text-ink">
                  {Math.round(it.calories_kcal)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </ShareImageModal>
  );
}
