import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateLong } from '../lib/datetime';
import { MEAL_ORDER, mealTypeJa } from '../lib/meals';
import { saltFromSodiumMg } from '../lib/units';
import { NutrientBars } from './NutrientBars';
import { ShareImageModal } from './ShareImageModal';

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

  // day モード: meal_type 別の内訳(記録のある区分のみ・表示順)。区分ごとに「何を食べたか」=品名を出す。
  const byType = MEAL_ORDER.flatMap((type) => {
    const its = allMeals.filter((m) => m.meal_type === type).flatMap((m) => m.items);
    if (its.length === 0) return [];
    return [
      {
        type,
        kcal: its.reduce((a, it) => a + it.calories_kcal, 0),
        foods: its.map((it) => it.food_name),
      },
    ];
  });

  const title = mode === 'day' ? '1日の食事' : mealTypeJa(mealType ?? '');
  const heading = mode === 'day' ? '食事 — 1日' : `食事 — ${mealTypeJa(mealType ?? '')}`;
  // download 名は英字のみに正規化(mealType への不正値混入でのパス分離を防ぐ)。
  const safeType = (mealType ?? '').replace(/[^a-zA-Z]/g, '') || 'meal';
  const filename = mode === 'day' ? `logbook-meal-${date}.png` : `logbook-${safeType}-${date}.png`;

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
      </div>

      {/* 栄養素(対目標バー・全画面共通)。kcal もバーに含める。区分単体は寄与%も併記。 */}
      <div className="mt-4 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <NutrientBars
          values={{ ...nutrients, kcal }}
          target={target}
          showContribution={mode === 'category'}
        />
      </div>

      {/* 内訳 */}
      {mode === 'day' ? (
        <div className="mt-4 space-y-2">
          {byType.map((g) => (
            <div key={g.type} className="rounded-lg bg-card/60 px-3 py-2 ring-1 ring-line/50">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-bold text-ink">{mealTypeJa(g.type)}</span>
                <span className="tnum shrink-0 text-[12px] font-semibold text-ink">
                  {Math.round(g.kcal)}
                  <span className="text-[10px] text-faint"> kcal</span>
                </span>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{g.foods.join('・')}</div>
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
