import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api } from '../lib/api';
import { fmtKg } from '../lib/units';

export function TodayScreen({ onGoRecord }: { onGoRecord: () => void }) {
  const today = useQuery({ queryKey: ['today'], queryFn: api.today });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  if (today.isLoading) return <Loading />;
  if (today.error) return <ErrorBox error={today.error} />;
  const t = today.data!;
  const target = settings.data?.nutritionTarget;
  const deviceWeight = t.body.find((b) => b.source === 'google_health' && b.weight_kg != null);
  const appWeight = t.body.find((b) => b.source === 'app' && b.weight_kg != null);
  const weight = deviceWeight ?? appWeight;

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-lg font-bold">{t.date}</h1>

      <div className="grid grid-cols-2 gap-3">
        <Card title="体重">
          <div className="text-xl font-semibold">{fmtKg(weight?.weight_kg ?? null)}</div>
          <div className="mt-1 text-[11px] text-gray-400">
            {deviceWeight ? 'Google Health(測定)' : appWeight ? '手入力' : '記録なし'}
          </div>
        </Card>
        <Card title="体脂肪">
          <div className="text-xl font-semibold">
            {weight?.body_fat_pct != null ? `${weight.body_fat_pct}%` : '—'}
          </div>
        </Card>
      </div>

      {t.inProgress && (
        <Card title="記録中のワークアウト" accent>
          <div className="flex items-center justify-between">
            <span>{t.inProgress.title ?? 'ワークアウト'}</span>
            <button
              type="button"
              onClick={onGoRecord}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm"
            >
              再開
            </button>
          </div>
        </Card>
      )}

      <Card title="今日の食事">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold">{Math.round(t.pfc.kcal)}</span>
          <span className="text-sm text-gray-400">
            / {target ? Math.round(target.target_kcal) : '—'} kcal
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <Macro label="P" v={t.pfc.p} t={target?.target_protein_g} color="text-rose-300" />
          <Macro label="F" v={t.pfc.f} t={target?.target_fat_g} color="text-amber-300" />
          <Macro label="C" v={t.pfc.c} t={target?.target_carbs_g} color="text-sky-300" />
        </div>
        {t.meals.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-gray-300">
            {t.meals.map((m) => (
              <li key={m.id} className="flex justify-between">
                <span>{mealTypeJa(m.meal_type)}</span>
                <span className="text-gray-400">
                  {Math.round(m.items.reduce((a, i) => a + i.calories_kcal, 0))} kcal
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Macro({ label, v, t, color }: { label: string; v: number; t?: number; color: string }) {
  return (
    <div className="rounded-lg bg-white/5 py-2">
      <div className={`font-bold ${color}`}>{label}</div>
      <div className="text-sm">
        {Math.round(v)}
        {t ? <span className="text-gray-500"> / {Math.round(t)}g</span> : 'g'}
      </div>
    </div>
  );
}

function mealTypeJa(t: string): string {
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

export function Loading() {
  return <div className="py-20 text-center text-gray-500">読み込み中…</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg bg-rose-950/50 p-4 text-sm text-rose-200">
      エラー: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
