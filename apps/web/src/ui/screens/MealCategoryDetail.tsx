import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '../components/Card';
import { CHART } from '../components/chart';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { Empty, Loading } from '../components/state';
import { api } from '../lib/api';
import { mealTypeJa } from './Nutrition';

/** 食事カテゴリの詳細(タップで開く)。マクロバランスをレーダーチャートで可視化 + 品目別内訳。 */
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
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const del = useMutation({
    mutationFn: api.deleteMeal,
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['today', date] });
      qc.invalidateQueries({ queryKey: ['trends'] });
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
    }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  // マクロを「カロリー寄与の割合」でレーダー化(P/C=4kcal/g, F=9kcal/g)。形で偏りが直感的に分かる。
  const pK = tot.p * 4;
  const fK = tot.f * 9;
  const cK = tot.c * 4;
  const totK = pK + fK + cK || 1;
  const radar = [
    { axis: 'P', value: Math.round((pK / totK) * 100) },
    { axis: 'F', value: Math.round((fK / totK) * 100) },
    { axis: 'C', value: Math.round((cK / totK) * 100) },
  ];

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
        <span className="ml-auto text-sm font-semibold text-muted">
          {date.slice(5).replace('-', '/')}
        </span>
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
          {/* マクロバランス レーダー + 合計 */}
          <Card title="マクロバランス">
            <div className="flex items-center gap-2">
              <div className="h-40 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radar} outerRadius="72%">
                    <PolarGrid stroke={CHART.line} />
                    <PolarAngleAxis dataKey="axis" tick={{ fill: CHART.faint, fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      dataKey="value"
                      stroke={CHART.accent}
                      fill={CHART.accent}
                      fillOpacity={0.25}
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="shrink-0 space-y-2 pr-2">
                <MacroLegend
                  color="var(--color-protein)"
                  label="P"
                  g={tot.p}
                  pct={radar[0]!.value}
                />
                <MacroLegend color="var(--color-fat)" label="F" g={tot.f} pct={radar[1]!.value} />
                <MacroLegend color="var(--color-carb)" label="C" g={tot.c} pct={radar[2]!.value} />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-center gap-1 border-t border-line/60 pt-2">
              <span className="stat text-2xl leading-none">
                {Math.round(tot.kcal).toLocaleString()}
              </span>
              <span className="text-sm text-muted">kcal</span>
              <span className="ml-2 text-[11px] text-faint">
                {items.length}品 · カロリー寄与で算出
              </span>
            </div>
          </Card>

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
    </div>
  );
}

function MacroLegend({
  color,
  label,
  g,
  pct,
}: {
  color: string;
  label: string;
  g: number;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-bold" style={{ color }}>
        {label}
      </span>
      <span className="tnum text-[11px] text-muted">
        {Math.round(g)}g<span className="ml-1 text-faint">{pct}%</span>
      </span>
    </div>
  );
}
