import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { Loading } from '../components/state';
import { api, type TodayMeal } from '../lib/api';

// meal_type の表示順(朝→夜)+ 日本語ラベル。
export const MEAL_ORDER = [
  'Breakfast',
  'MorningSnack',
  'Lunch',
  'AfternoonSnack',
  'Dinner',
  'Anytime',
];
export function mealTypeJa(t: string): string {
  return (
    {
      Breakfast: '朝食',
      MorningSnack: '午前間食',
      Lunch: '昼食',
      AfternoonSnack: '午後間食',
      Dinner: '夕食',
      Anytime: '間食',
    }[t] ?? t
  );
}

/** 栄養画面(サブスクリーン)。kcal残ヒーロー + マクロ + 食事ログ(品目別) + 記録導線。 */
export function NutritionScreen({
  date,
  onBack,
  onRecordMeal,
  onEditMeal,
  onOpenSettings,
}: {
  date: string;
  onBack: () => void;
  onRecordMeal: () => void;
  onEditMeal: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  if (today.isLoading) return <Loading />;
  const t = today.data;
  const target = settings.data?.nutritionTarget ?? null;
  const pfc = t?.pfc ?? { kcal: 0, p: 0, f: 0, c: 0, salt_g: 0 };
  const kcal = Math.round(pfc.kcal);
  const remain = target ? Math.round(target.target_kcal - kcal) : null;
  const pct = target ? Math.min(100, (kcal / target.target_kcal) * 100) : 0;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="戻る"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <h1 className="font-display text-lg font-bold tracking-tight">栄養</h1>
        <span className="ml-auto text-sm font-semibold text-muted">
          {date.slice(5).replace('-', '/')}
        </span>
      </div>

      {/* kcal 残ヒーロー */}
      <Card>
        {target ? (
          <>
            <div className="flex items-baseline justify-between">
              <span
                className={`stat text-4xl ${remain != null && remain < 0 ? 'text-accent-ink' : ''}`}
              >
                {remain != null && remain >= 0 ? `残り ${remain}` : `${Math.abs(remain ?? 0)} 超過`}
              </span>
              <span className="text-sm font-semibold text-muted">kcal</span>
            </div>
            <div className="mt-1 text-[11px] text-faint">
              {kcal.toLocaleString()} / {target.target_kcal.toLocaleString()} kcal
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor:
                    remain != null && remain < 0 ? 'var(--color-accent)' : 'var(--color-ink)',
                }}
              />
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-baseline justify-between"
          >
            <span className="stat text-4xl">{kcal.toLocaleString()}</span>
            <span className="text-sm font-semibold text-accent">目標を設定 ›</span>
          </button>
        )}
      </Card>

      {/* マクロ */}
      <Card title="マクロ">
        <div className="space-y-2.5">
          <Bar label="Protein" v={pfc.p} t={target?.target_protein_g} varName="--color-protein" />
          <Bar label="Fat" v={pfc.f} t={target?.target_fat_g} varName="--color-fat" />
          <Bar label="Carbs" v={pfc.c} t={target?.target_carbs_g} varName="--color-carb" />
          <Bar
            label="食塩"
            v={pfc.salt_g}
            t={target?.target_salt_g ?? 6}
            varName="--color-muted"
            overWarn
            unit="g"
          />
        </div>
      </Card>

      <MealsCard meals={t?.meals ?? []} date={date} onEdit={onEditMeal} />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRecordMeal}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-accent py-3 font-display text-sm font-bold text-card shadow-[0_8px_24px_-8px] shadow-accent/60 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" strokeWidth={3} /> 食事を記録
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-muted"
        >
          目標調整
        </button>
      </div>
    </div>
  );
}

// ============ マクロ目標バー(P/F/C/食塩)。Home の NutritionGlance でも再利用。 ============
export function Bar({
  label,
  v,
  t,
  varName,
  unit = 'g',
  overWarn = false,
}: {
  label: string;
  v: number;
  t?: number;
  varName: string;
  unit?: string;
  overWarn?: boolean;
}) {
  const pct = t && t > 0 ? Math.min(100, (v / t) * 100) : 0;
  const over = t != null && v > t;
  const barColor = overWarn && over ? 'var(--color-accent)' : `var(${varName})`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold" style={{ color: barColor }}>
          {label}
        </span>
        <span
          className={`tnum ${overWarn && over ? 'font-semibold text-accent-ink' : 'text-muted'}`}
        >
          {Math.round(v * 10) / 10}
          {t ? ` / ${Math.round(t)}${unit}` : unit}
          {over && !overWarn ? ` (+${Math.round(v - t)})` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

// ============ 食事ログ(meal_type グルーピング + 品目別 PFC + カテゴリ小計 + 削除確認) ============
function MealsCard({
  meals,
  date,
  onEdit,
}: {
  meals: TodayMeal[];
  date: string;
  onEdit: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['Breakfast', 'Lunch', 'Dinner']),
  );
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const del = useMutation({
    mutationFn: api.deleteMeal,
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['today', date] });
      qc.invalidateQueries({ queryKey: ['trends'] });
    },
  });

  const groups = useMemo(() => {
    const byType = new Map<string, TodayMeal[]>();
    for (const m of meals) {
      const arr = byType.get(m.meal_type);
      if (arr) arr.push(m);
      else byType.set(m.meal_type, [m]);
    }
    return MEAL_ORDER.filter((t) => byType.has(t)).map((type) => {
      const ms = byType.get(type)!;
      let kcal = 0;
      let p = 0;
      let f = 0;
      let c = 0;
      let count = 0;
      for (const m of ms)
        for (const it of m.items) {
          kcal += it.calories_kcal;
          p += it.protein_g;
          f += it.fat_g;
          c += it.carbs_g;
          count++;
        }
      return { type, meals: ms, kcal, p, f, c, count };
    });
  }, [meals]);

  const toggle = (t: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  return (
    <Card title="食事ログ">
      {groups.length === 0 ? (
        <p className="py-2 text-sm text-faint">まだ記録がありません。＋から食事を記録できます。</p>
      ) : (
        <div className="divide-y divide-line/60">
          {groups.map((g) => {
            const isOpen = expanded.has(g.type);
            return (
              <div key={g.type} className="py-1 first:pt-0 last:pb-0">
                <button
                  type="button"
                  onClick={() => toggle(g.type)}
                  className="flex w-full items-center justify-between gap-2 py-1"
                >
                  <span className="flex items-center gap-1.5">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-faint" strokeWidth={2.4} />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-faint" strokeWidth={2.4} />
                    )}
                    <span className="text-sm font-semibold text-ink">{mealTypeJa(g.type)}</span>
                    <span className="text-[11px] text-faint">{g.count}品</span>
                  </span>
                  <span className="tnum text-sm font-semibold text-ink">
                    {Math.round(g.kcal)} kcal
                  </span>
                </button>

                {isOpen && (
                  <div className="mb-1 pl-5">
                    <ul>
                      {g.meals.flatMap((m) => {
                        const isGh = m.source === 'google_health';
                        const mealKcal = Math.round(
                          m.items.reduce((a, i) => a + i.calories_kcal, 0),
                        );
                        return m.items.map((it, idx) => (
                          <li
                            // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト(並べ替え/挿入なし)
                            key={`${m.id}:${idx}`}
                            className="flex items-start justify-between gap-2 border-b border-line/40 py-1.5 last:border-0"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-sm text-ink">{it.food_name}</span>
                              <span className="mt-0.5 flex gap-2 text-[10px] tnum">
                                <span style={{ color: 'var(--color-protein)' }}>
                                  P{Math.round(it.protein_g)}g
                                </span>
                                <span style={{ color: 'var(--color-fat)' }}>
                                  F{Math.round(it.fat_g)}g
                                </span>
                                <span style={{ color: 'var(--color-carb)' }}>
                                  C{Math.round(it.carbs_g)}g
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className="tnum text-[11px] text-muted">
                                {Math.round(it.calories_kcal)}
                              </span>
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
                                      onClick={() => onEdit(m.id)}
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
                                          label: `${mealTypeJa(m.meal_type)} / ${m.items[0]?.food_name ?? '食事'}${m.items.length > 1 ? ` 他${m.items.length - 1}品` : ''} (${mealKcal}kcal)`,
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
                    <div className="mt-1 flex items-center justify-between border-t border-line/60 pt-1.5">
                      <span className="text-[11px] font-bold text-muted">
                        {mealTypeJa(g.type)}計
                      </span>
                      <span className="tnum text-[10px] text-muted">
                        {Math.round(g.kcal)}kcal · P{Math.round(g.p)} F{Math.round(g.f)} C
                        {Math.round(g.c)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
    </Card>
  );
}
