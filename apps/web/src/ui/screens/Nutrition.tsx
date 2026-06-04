import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronLeft, ChevronRight, Flame, Plus, Share2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import { DateField } from '../components/DateField';
import { MealReport } from '../components/MealReport';
import { NutrientBars } from '../components/NutrientBars';
import { NutritionScoreCard } from '../components/NutritionScoreCard';
import { Loading } from '../components/state';
import { api, type TodayMeal } from '../lib/api';
import { DOW_JA, formatDateForDisplay, jstDayOfWeek, shiftDate, todayJst } from '../lib/datetime';
import { energyBalance } from '../lib/energy';
import { MEAL_ORDER, mealTypeJa } from '../lib/meals';

/** 栄養画面(サブスクリーン)。kcal残ヒーロー + マクロ + 食事区分(タップで詳細レーダー)+ 記録導線。 */
export function NutritionScreen({
  date,
  onDateChange,
  onRecordMeal,
  onStartFromPreset,
  onOpenSettings,
  onOpenCategory,
}: {
  date: string;
  onDateChange: (date: string) => void;
  onRecordMeal: () => void;
  onStartFromPreset: (presetId: string) => void;
  onOpenSettings: () => void;
  onOpenCategory: (mealType: string, date: string) => void;
}) {
  // 日付は URL(?d=)が唯一の真実。ステッパーは onDateChange で URL を更新 → 戻る/進むも整合(state drift なし)。
  const isToday = date === todayJst();
  const today = useQuery({ queryKey: ['today', date], queryFn: () => api.today(date) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const score = useQuery({
    queryKey: ['nutrition-score', date],
    queryFn: () => api.nutritionScore(date),
  });
  const [shareDay, setShareDay] = useState(false);
  if (today.isLoading) return <Loading />;
  const t = today.data;
  const target = settings.data?.nutritionTarget ?? null;
  const pfc = t?.pfc ?? { kcal: 0, p: 0, f: 0, c: 0, salt_g: 0, fiber_g: 0 };
  const kcal = Math.round(pfc.kcal);
  const remain = target ? Math.round(target.target_kcal - kcal) : null;
  const pct = target ? Math.min(100, (kcal / target.target_kcal) * 100) : 0;
  const wd = DOW_JA[jstDayOfWeek(date)];
  // その日の活動消費(GHミラー)。摂取との収支の目安に。
  const activeKcal = t?.daily?.find((d) => d.metric === 'active_energy_kcal')?.value ?? null;
  // 推定総消費 = BMR(身体プロフィール)+ 活動消費。収支 = 摂取 − 総消費。BMR 未設定なら出さない。
  const s = settings.data?.settings;
  const { bmr, expenditure, balance } = energyBalance({
    weightKg: t?.body?.weightKg ?? null,
    heightCm: s?.height_cm ?? null,
    birthYear: s?.birth_year ?? null,
    sex: s?.sex ?? null,
    currentYear: Number(todayJst().slice(0, 4)),
    intakeKcal: kcal,
    activeKcal,
  });

  const sc = score.data;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-1">
        <h1 className="font-display text-lg font-bold tracking-tight">食事</h1>
        {/* 日付ステッパー(過去日の食事も確認可能) */}
        <div className="ml-auto flex items-center gap-1">
          {(t?.meals?.length ?? 0) > 0 && (
            <button
              type="button"
              aria-label="1日の食事を画像で保存"
              onClick={() => setShareDay(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
            >
              <Share2 className="h-4 w-4" strokeWidth={2.2} />
            </button>
          )}
          <button
            type="button"
            aria-label="前日"
            onClick={() => onDateChange(shiftDate(date, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
          </button>
          <DateField
            date={date}
            onPick={onDateChange}
            max={todayJst()}
            className="min-w-14 justify-center text-sm font-semibold"
          >
            <span>
              {isToday ? '今日' : formatDateForDisplay(date)}
              <span className="ml-1 text-xs text-muted">({wd})</span>
            </span>
          </DateField>
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

      {/* kcal 残ヒーロー + エネルギー収支(統合・情報密度up) */}
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
            <div className="mt-1 flex items-center justify-between text-[11px] text-faint">
              <span>
                {kcal.toLocaleString()} / {target.target_kcal.toLocaleString()} kcal
              </span>
              {/* BMR 未設定で収支が出せないときだけ、活動消費をここに単独表示 */}
              {expenditure == null && activeKcal != null && (
                <span className="flex items-center gap-1">
                  <Flame className="h-3 w-3" strokeWidth={2.2} />
                  活動消費 {Math.round(activeKcal).toLocaleString()} kcal
                </span>
              )}
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

            {/* エネルギー収支(推定)= 摂取 −(基礎代謝 + 活動消費)。プロフィール未設定なら誘導。 */}
            {expenditure != null && balance != null ? (
              <div className="mt-3 border-t border-line/60 pt-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold text-faint">収支(推定)</span>
                  <span
                    className={`tnum text-base font-bold ${balance <= 0 ? 'text-carb' : 'text-accent-ink'}`}
                  >
                    {balance <= 0 ? `${balance}` : `+${balance}`} kcal
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-faint">
                  <span className="tnum">摂取 {kcal.toLocaleString()}</span>
                  <span>−</span>
                  <span className="tnum">消費 {expenditure.toLocaleString()}</span>
                  <span>
                    (基礎 {bmr?.toLocaleString()} + 活動{' '}
                    {Math.round(activeKcal ?? 0).toLocaleString()})
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-2.5 w-full border-t border-line/60 pt-2 text-left text-[10px] text-faint"
              >
                身体プロフィール(身長/生年/性別)を設定すると推定収支が出ます ›
              </button>
            )}
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

      {/* 栄養スコア(1日全体・マクロ目標適合度レーダー)。カテゴリ別は各区分の画面に出す。 */}
      {sc?.day && <NutritionScoreCard score={sc.day} />}

      <MealsCard meals={t?.meals ?? []} onOpenCategory={(mt) => onOpenCategory(mt, date)} />

      <PresetsCard onStart={onStartFromPreset} />

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

      {shareDay && <MealReport mode="day" date={date} onClose={() => setShareDay(false)} />}
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

// ============ プリセット一覧(独立セクション。タップで適用して記録開始) ============
/** 登録済み食事プリセットの一覧。タップでその内容を適用した記録画面へ。各行で削除も可能。 */
function PresetsCard({ onStart }: { onStart: (presetId: string) => void }) {
  const qc = useQueryClient();
  const presets = useQuery({ queryKey: ['meal-presets'], queryFn: api.mealPresets });
  const del = useMutation({
    mutationFn: api.deleteMealPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-presets'] }),
  });
  const list = presets.data?.presets ?? [];
  return (
    <Card title="プリセット">
      {list.length === 0 ? (
        <p className="py-2 text-sm text-faint">
          まだありません。食事の記録画面で「プリセットとして保存」すると、ここに並びます。
        </p>
      ) : (
        <div className="divide-y divide-line/60">
          {list.map((p) => {
            const tot = p.items.reduce(
              (a, it) => ({
                kcal: a.kcal + it.caloriesKcal,
                p: a.p + (it.proteinG ?? 0),
                f: a.f + (it.fatG ?? 0),
                c: a.c + (it.carbsG ?? 0),
              }),
              { kcal: 0, p: 0, f: 0, c: 0 },
            );
            return (
              <div key={p.id} className="flex items-center gap-2 py-2.5 first:pt-1 last:pb-1">
                <button
                  type="button"
                  onClick={() => onStart(p.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <Bookmark className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.4} />
                    <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                    <span className="shrink-0 text-[11px] text-faint">{p.items.length}品</span>
                  </span>
                  <span className="mt-0.5 flex gap-2 pl-5 text-[10px] tnum">
                    <span style={{ color: 'var(--color-protein)' }}>P{Math.round(tot.p)}</span>
                    <span style={{ color: 'var(--color-fat)' }}>F{Math.round(tot.f)}</span>
                    <span style={{ color: 'var(--color-carb)' }}>C{Math.round(tot.c)}</span>
                  </span>
                </button>
                <span className="tnum shrink-0 text-sm font-semibold text-ink">
                  {Math.round(tot.kcal)}
                  <span className="text-[10px] text-faint"> kcal</span>
                </span>
                <button
                  type="button"
                  aria-label="プリセット削除"
                  onClick={() => del.mutate(p.id)}
                  className="shrink-0 p-1 text-faint active:text-accent"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
