import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/Card';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { MealReport } from '../components/MealReport';
import { NutrientBars } from '../components/NutrientBars';
import { NutritionScoreCard } from '../components/NutritionScoreCard';
import { Empty, Loading } from '../components/state';
import { api } from '../lib/api';
import { formatDateForDisplay } from '../lib/datetime';
import { invalidateMeals } from '../lib/invalidate';
import { mealTypeJa } from '../lib/meals';
import { saltFromSodiumMg } from '../lib/units';

/** 食事カテゴリの詳細(タップで開く)。栄養素を対目標バーで可視化(全画面共通の NutrientBars)+ 品目別内訳。 */
export function MealCategoryDetail({
  mealType,
  date,
  onBack,
  onEditMeal,
  onRecordMeal,
}: {
  mealType: string;
  date: string;
  onBack: () => void;
  onEditMeal: (id: string) => void;
  onRecordMeal: () => void;
}) {
  const qc = useQueryClient();
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const score = useQuery({
    queryKey: ['nutrition-score', date],
    queryFn: () => api.nutritionScore(date),
  });
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const [share, setShare] = useState(false);
  const del = useMutation({
    mutationFn: api.deleteMeal,
    onSuccess: () => {
      setConfirm(null);
      invalidateMeals(qc);
    },
  });
  if (today.isLoading) return <Loading />;

  const meals = (today.data?.meals ?? []).filter((m) => m.meal_type === mealType);
  const items = meals.flatMap((m) => m.items);
  const tot = items.reduce(
    (a, it) => ({
      kcal: a.kcal + it.calories_kcal,
      p: a.p + it.protein_g,
      f: a.f + it.fat_g,
      c: a.c + it.carbs_g,
      sodium: a.sodium + (it.sodium_mg ?? 0),
      fiber: a.fiber + (it.fiber_g ?? 0),
      sugar: a.sugar + (it.sugar_g ?? 0),
    }),
    { kcal: 0, p: 0, f: 0, c: 0, sodium: 0, fiber: 0, sugar: 0 },
  );
  // 糖質は手入力では未取得もあり得る。1品でも値があるときだけ「うち糖質」を出す。
  const hasSugar = items.some((it) => it.sugar_g != null);
  const nutrients = {
    p: tot.p,
    f: tot.f,
    c: tot.c,
    salt_g: Math.round(saltFromSodiumMg(tot.sodium) * 10) / 10,
    fiber_g: Math.round(tot.fiber * 10) / 10,
  };
  // この区分の栄養スコア(マクロ目標適合度・4軸=塩分/カロリーは1日単位)。
  const catScore = score.data?.categories.find((c) => c.mealType === mealType)?.score ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="戻る"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <h1 className="font-display text-lg font-bold tracking-tight">{mealTypeJa(mealType)}</h1>
        <div className="ml-auto flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              aria-label="この区分を画像で保存"
              onClick={() => setShare(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
            >
              <Share2 className="h-4 w-4" strokeWidth={2.2} />
            </button>
          )}
          <span className="text-sm font-semibold text-muted">{formatDateForDisplay(date)}</span>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <Empty note="この区分の記録はまだありません。" />
          <button
            type="button"
            onClick={onRecordMeal}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-bold text-card"
          >
            <Plus className="h-4 w-4" strokeWidth={3} /> 食事を記録
          </button>
        </Card>
      ) : (
        <>
          {/* 栄養素(対目標バー・全画面共通)。寄与%を副情報で併記。 */}
          <Card title="栄養素(対目標)">
            <NutrientBars
              values={nutrients}
              target={settings.data?.nutritionTarget ?? null}
              showContribution
            />
            <div className="mt-3 flex items-baseline justify-center gap-1 border-t border-line/60 pt-2.5">
              <span className="stat text-2xl leading-none">
                {Math.round(tot.kcal).toLocaleString()}
              </span>
              <span className="text-sm text-muted">kcal</span>
              {hasSugar && (
                <span className="ml-2 text-[11px]" style={{ color: 'var(--color-sugar)' }}>
                  うち糖質 {Math.round(tot.sugar)}g
                </span>
              )}
              <span className="ml-2 text-[11px] text-faint">{items.length}品</span>
            </div>
          </Card>

          {/* この区分の栄養スコア(マクロ目標適合度レーダー) */}
          {catScore && <NutritionScoreCard score={catScore} isCategory />}

          {/* 品目別 内訳 */}
          <Card title="内訳">
            <ul>
              {meals.flatMap((m) => {
                const isGh = m.source === 'google_health';
                const mealKcal = Math.round(m.items.reduce((a, i) => a + i.calories_kcal, 0));
                return m.items.map((it, idx) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト
                    key={`${m.id}:${idx}`}
                    className="flex items-start justify-between gap-2 border-b border-line/40 py-2 last:border-0"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium text-ink">{it.food_name}</span>
                      <span className="mt-0.5 flex gap-2.5 text-[11px] tnum">
                        <span style={{ color: 'var(--color-protein)' }}>
                          P{Math.round(it.protein_g)}
                        </span>
                        <span style={{ color: 'var(--color-fat)' }}>F{Math.round(it.fat_g)}</span>
                        <span style={{ color: 'var(--color-carb)' }}>
                          C{Math.round(it.carbs_g)}
                        </span>
                        {it.sugar_g != null && (
                          <span style={{ color: 'var(--color-sugar)' }}>
                            糖{Math.round(it.sugar_g)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tnum text-sm font-semibold">
                        {Math.round(it.calories_kcal)}
                      </span>
                      <span className="text-[10px] text-faint">kcal</span>
                      {idx === 0 &&
                        (isGh ? (
                          <span className="rounded-full bg-paper px-1.5 py-0.5 text-[9px] font-semibold text-faint">
                            GH
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              aria-label="編集"
                              onClick={() => onEditMeal(m.id)}
                              className="p-1 text-faint active:text-accent"
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
                            </button>
                            <button
                              type="button"
                              aria-label="削除"
                              onClick={() =>
                                setConfirm({
                                  id: m.id,
                                  label: `${mealTypeJa(mealType)} / ${m.items[0]?.food_name ?? '食事'}${m.items.length > 1 ? ` 他${m.items.length - 1}品` : ''} (${mealKcal}kcal)`,
                                })
                              }
                              className="p-1 text-faint active:text-accent"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                            </button>
                          </>
                        ))}
                    </span>
                  </li>
                ));
              })}
            </ul>
          </Card>

          <button
            type="button"
            onClick={onRecordMeal}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-line py-3 text-sm font-semibold text-muted"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} /> この区分に追加
          </button>
        </>
      )}

      {confirm && (
        <DeleteConfirmModal
          kind="meal"
          targetLabel={confirm.label}
          isPending={del.isPending}
          onConfirm={() => del.mutate(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {share && (
        <MealReport
          mode="category"
          date={date}
          mealType={mealType}
          onClose={() => setShare(false)}
        />
      )}
    </div>
  );
}
