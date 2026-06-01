import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Card } from '../components/Card';
import { NutrientBars } from '../components/NutrientBars';
import { Loading } from '../components/state';
import { api, type TodayMeal } from '../lib/api';
import { formatDateForDisplay, jstDayOfWeek, shiftDate, todayJst } from '../lib/datetime';

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

/** 栄養画面(サブスクリーン)。kcal残ヒーロー + マクロ + 食事区分(タップで詳細レーダー)+ 記録導線。 */
export function NutritionScreen({
  date,
  onBack,
  onDateChange,
  onRecordMeal,
  onOpenSettings,
  onOpenCategory,
}: {
  date: string;
  onBack: () => void;
  onDateChange: (date: string) => void;
  onRecordMeal: () => void;
  onOpenSettings: () => void;
  onOpenCategory: (mealType: string, date: string) => void;
}) {
  // 日付は URL(?d=)が唯一の真実。ステッパーは onDateChange で URL を更新 → 戻る/進むも整合(state drift なし)。
  const isToday = date === todayJst();
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  if (today.isLoading) return <Loading />;
  const t = today.data;
  const target = settings.data?.nutritionTarget ?? null;
  const pfc = t?.pfc ?? { kcal: 0, p: 0, f: 0, c: 0, salt_g: 0, fiber_g: 0 };
  const kcal = Math.round(pfc.kcal);
  const remain = target ? Math.round(target.target_kcal - kcal) : null;
  const pct = target ? Math.min(100, (kcal / target.target_kcal) * 100) : 0;
  const wd = ['日', '月', '火', '水', '木', '金', '土'][jstDayOfWeek(date)];

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
        <h1 className="font-display text-lg font-bold tracking-tight">栄養</h1>
        {/* 日付ステッパー(過去日の食事も確認可能) */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="前日"
            onClick={() => onDateChange(shiftDate(date, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => onDateChange(todayJst())}
            className="min-w-14 text-center text-sm font-semibold"
          >
            {isToday ? '今日' : formatDateForDisplay(date)}
            <span className="ml-1 text-xs text-muted">({wd})</span>
          </button>
          <button
            type="button"
            aria-label="翌日"
            onClick={() => onDateChange(shiftDate(date, 1))}
            disabled={isToday}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60 disabled:opacity-25"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
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

      {/* 栄養素(対目標バー・全画面共通) */}
      <Card title="栄養素(対目標)">
        <NutrientBars
          values={{ p: pfc.p, f: pfc.f, c: pfc.c, salt_g: pfc.salt_g, fiber_g: pfc.fiber_g }}
          target={target}
        />
      </Card>

      <MealsCard meals={t?.meals ?? []} onOpenCategory={(mt) => onOpenCategory(mt, date)} />

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

// ============ 食事ログ(meal_type 区分サマリ) ============
/** 食事区分のサマリ一覧。各行タップで MealCategoryDetail(対目標バー+内訳)へ。 */
function MealsCard({
  meals,
  onOpenCategory,
}: {
  meals: TodayMeal[];
  onOpenCategory: (mealType: string) => void;
}) {
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
      return { type, kcal, p, f, c, count };
    });
  }, [meals]);

  return (
    <Card title="食事ログ">
      {groups.length === 0 ? (
        <p className="py-2 text-sm text-faint">まだ記録がありません。＋から食事を記録できます。</p>
      ) : (
        <div className="divide-y divide-line/60">
          {groups.map((g) => (
            <button
              key={g.type}
              type="button"
              onClick={() => onOpenCategory(g.type)}
              className="flex w-full items-center gap-3 py-2.5 text-left first:pt-1 last:pb-1"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-ink">{mealTypeJa(g.type)}</span>
                  <span className="text-[11px] text-faint">{g.count}品</span>
                </span>
                <span className="mt-0.5 flex gap-2 text-[10px] tnum">
                  <span style={{ color: 'var(--color-protein)' }}>P{Math.round(g.p)}</span>
                  <span style={{ color: 'var(--color-fat)' }}>F{Math.round(g.f)}</span>
                  <span style={{ color: 'var(--color-carb)' }}>C{Math.round(g.c)}</span>
                </span>
              </span>
              <span className="tnum text-sm font-semibold text-ink">{Math.round(g.kcal)} kcal</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
