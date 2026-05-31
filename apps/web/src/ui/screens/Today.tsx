import { useQuery } from '@tanstack/react-query';
import { Dumbbell, Flame, Moon, Scale, Utensils } from 'lucide-react';
import { Card, Stat } from '../components/Card';
import { api } from '../lib/api';
import { fmtKg, round } from '../lib/units';

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
    <div className="mx-auto max-w-md space-y-4">
      <DateLine date={t.date} />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="mb-1 flex items-center gap-1.5 text-faint">
            <Scale className="h-3.5 w-3.5" strokeWidth={2.4} />
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">
              体重
            </span>
          </div>
          <div className="stat text-2xl leading-none">{weightMain(weight?.weight_kg)}</div>
          <div className="mt-1.5 text-[11px] text-muted">{weightSub(weight?.weight_kg)}</div>
          <SourceBadge device={!!deviceWeight} app={!!appWeight} />
        </Card>
        <Card>
          <div className="mb-1 flex items-center gap-1.5 text-faint">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">
              体脂肪
            </span>
          </div>
          <div className="stat text-2xl leading-none">
            {weight?.body_fat_pct != null ? round(weight.body_fat_pct, 1) : '—'}
            {weight?.body_fat_pct != null && <span className="ml-0.5 text-base text-muted">%</span>}
          </div>
        </Card>
      </div>

      {t.inProgress && (
        <Card accent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4 text-accent" strokeWidth={2.4} />
              <span className="text-sm font-semibold">
                記録中 · {t.inProgress.title ?? 'ワークアウト'}
              </span>
            </div>
            <button
              type="button"
              onClick={onGoRecord}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-card"
            >
              再開
            </button>
          </div>
        </Card>
      )}

      <Card title="今日の栄養" right={<Flame className="h-4 w-4 text-accent" strokeWidth={2.2} />}>
        <div className="flex items-baseline justify-between">
          <Stat value={Math.round(t.pfc.kcal)} unit="kcal" />
          <span className="text-sm text-muted">
            目標 {target ? Math.round(target.target_kcal) : '—'}
          </span>
        </div>
        <div className="mt-4 space-y-2.5">
          <MacroBar
            label="Protein"
            v={t.pfc.p}
            t={target?.target_protein_g}
            varName="--color-protein"
          />
          <MacroBar label="Fat" v={t.pfc.f} t={target?.target_fat_g} varName="--color-fat" />
          <MacroBar label="Carbs" v={t.pfc.c} t={target?.target_carbs_g} varName="--color-carb" />
        </div>
        {t.meals.length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
            {t.meals.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink">
                  <Utensils className="h-3.5 w-3.5 text-faint" strokeWidth={2.2} />
                  {mealTypeJa(m.meal_type)}
                </span>
                <span className="tnum text-muted">
                  {Math.round(m.items.reduce((a, i) => a + i.calories_kcal, 0))} kcal
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border-t border-line pt-3 text-sm text-faint">
            まだ食事の記録がありません
          </p>
        )}
      </Card>

      <Card title="睡眠" right={<Moon className="h-4 w-4 text-carb" strokeWidth={2.2} />}>
        <p className="text-sm text-faint">
          Google Health 同期(daily batch)で表示。トークン接続後に有効化。
        </p>
      </Card>
    </div>
  );
}

function weightMain(kg: number | null | undefined): string {
  if (kg == null) return '—';
  return `${round(kg, 1)}`;
}
function weightSub(kg: number | null | undefined): string {
  if (kg == null) return 'kg / lb';
  return fmtKg(kg);
}

function SourceBadge({ device, app }: { device: boolean; app: boolean }) {
  const label = device ? 'Google Health' : app ? '手入力' : '記録なし';
  return (
    <span className="mt-2 inline-block rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-faint">
      {label}
    </span>
  );
}

function MacroBar({
  label,
  v,
  t,
  varName,
}: {
  label: string;
  v: number;
  t?: number;
  varName: string;
}) {
  const pct = t && t > 0 ? Math.min(100, (v / t) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold" style={{ color: `var(${varName})` }}>
          {label}
        </span>
        <span className="tnum text-muted">
          {Math.round(v)}
          {t ? ` / ${Math.round(t)}g` : 'g'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: `var(${varName})` }}
        />
      </div>
    </div>
  );
}

function DateLine({ date }: { date: string }) {
  const d = new Date(`${date}T00:00:00+09:00`);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return (
    <div className="flex items-baseline gap-2">
      <span className="stat text-2xl">{date.slice(5).replace('-', '/')}</span>
      <span className="text-sm font-semibold text-muted">({wd})</span>
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
  return <div className="py-24 text-center text-sm text-faint">読み込み中…</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm text-accent-ink">
      エラー: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
