import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Card } from '../components/Card';
import { api, type FoodSuggestion } from '../lib/api';

const MEAL_TYPES = [
  { id: 'Breakfast', label: '朝食' },
  { id: 'Lunch', label: '昼食' },
  { id: 'Dinner', label: '夕食' },
  { id: 'MorningSnack', label: '午前間食' },
  { id: 'AfternoonSnack', label: '午後間食' },
  { id: 'Anytime', label: '間食' },
] as const;

interface Item {
  key: string;
  foodName: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}
const newItem = (init?: Partial<Item>): Item => ({
  key: crypto.randomUUID(),
  foodName: '',
  caloriesKcal: null,
  proteinG: null,
  fatG: null,
  carbsG: null,
  ...init,
});

export function MealScreen({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const [mealType, setMealType] = useState<string>(defaultMealType());
  const [items, setItems] = useState<Item[]>([newItem()]);

  const update = (k: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === k ? { ...it, ...patch } : it)));
  const remove = (k: string) => setItems((prev) => prev.filter((it) => it.key !== k));

  const total = items.reduce(
    (a, it) => ({
      kcal: a.kcal + (it.caloriesKcal ?? 0),
      p: a.p + (it.proteinG ?? 0),
      f: a.f + (it.fatG ?? 0),
      c: a.c + (it.carbsG ?? 0),
    }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );

  const valid = items.filter((it) => it.foodName.trim() && it.caloriesKcal != null);

  const save = useMutation({
    mutationFn: () =>
      api.logMeal({
        mealType,
        inputMethod: 'manual',
        items: valid.map((it) => ({
          foodName: it.foodName.trim(),
          caloriesKcal: it.caloriesKcal ?? 0,
          proteinG: it.proteinG ?? undefined,
          fatG: it.fatG ?? undefined,
          carbsG: it.carbsG ?? undefined,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today'] });
      onSaved();
    },
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {MEAL_TYPES.map((mt) => (
          <button
            type="button"
            key={mt.id}
            onClick={() => setMealType(mt.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
              mealType === mt.id ? 'bg-ink text-card' : 'bg-card text-muted border border-line'
            }`}
          >
            {mt.label}
          </button>
        ))}
      </div>

      {items.map((it) => (
        <ItemCard
          key={it.key}
          item={it}
          onChange={(p) => update(it.key, p)}
          onRemove={() => remove(it.key)}
          canRemove={items.length > 1}
        />
      ))}

      <button
        type="button"
        onClick={() => setItems((p) => [...p, newItem()])}
        className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-line py-2.5 text-sm font-semibold text-muted"
      >
        <Plus className="h-4 w-4" /> 品目を追加
      </button>

      <div className="flex items-center justify-around rounded-2xl bg-ink px-4 py-3 text-card">
        <M label="kcal" v={Math.round(total.kcal)} />
        <M label="P" v={Math.round(total.p)} />
        <M label="F" v={Math.round(total.f)} />
        <M label="C" v={Math.round(total.c)} />
      </div>

      <button
        type="button"
        disabled={valid.length === 0 || save.isPending}
        onClick={() => save.mutate()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-card shadow-[0_8px_24px_-8px] shadow-accent/60 transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
      >
        {save.isPending ? (
          '保存中…'
        ) : (
          <>
            <Check className="h-5 w-5" strokeWidth={3} /> 食事を記録
          </>
        )}
      </button>
      {save.error && (
        <p className="text-center text-sm text-accent-ink">{(save.error as Error).message}</p>
      )}
      <p className="text-center text-[11px] text-faint">
        写真からの自動栄養計算は Claude(MCP)経由。ここは手入力 + 過去食の補完。
      </p>
    </div>
  );
}

function ItemCard({
  item,
  onChange,
  onRemove,
  canRemove,
}: {
  item: Item;
  onChange: (p: Partial<Item>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [suggest, setSuggest] = useState<FoodSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // food_name のデバウンス・オートコンプリート(過去のPFCを引く)。
  useEffect(() => {
    const q = item.foodName.trim();
    if (q.length === 0) {
      setSuggest([]);
      return;
    }
    clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      try {
        const r = await api.foodAutocomplete(q);
        setSuggest(r.foods);
      } catch {
        setSuggest([]);
      }
    }, 200);
    return () => clearTimeout(tRef.current);
  }, [item.foodName]);

  function applySuggestion(s: FoodSuggestion) {
    onChange({
      foodName: s.food_name,
      caloriesKcal: Math.round(s.calories_kcal),
      proteinG: Math.round(s.protein_g),
      fatG: Math.round(s.fat_g),
      carbsG: Math.round(s.carbs_g),
    });
    setOpen(false);
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            value={item.foodName}
            onChange={(e) => {
              onChange({ foodName: e.target.value });
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="食品名(例: 鶏胸肉)"
            className="w-full border-b border-line bg-transparent pb-1 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-faint focus:border-accent"
          />
          {open && suggest.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-card shadow-lg">
              {suggest.map((s) => (
                <li key={s.food_name}>
                  <button
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper"
                  >
                    <span>{s.food_name}</span>
                    <span className="tnum text-xs text-faint">
                      {Math.round(s.calories_kcal)}kcal
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            aria-label="品目を削除"
            onClick={onRemove}
            className="p-1 text-faint hover:text-accent"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Field
          label="kcal"
          value={item.caloriesKcal}
          onChange={(v) => onChange({ caloriesKcal: v })}
        />
        <Field label="P" value={item.proteinG} onChange={(v) => onChange({ proteinG: v })} />
        <Field label="F" value={item.fatG} onChange={(v) => onChange({ fatG: v })} />
        <Field label="C" value={item.carbsG} onChange={(v) => onChange({ carbsG: v })} />
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-center text-[10px] font-bold uppercase tracking-wide text-faint">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full rounded-lg border border-line bg-paper px-1 py-2 text-center text-sm font-semibold tnum outline-none focus:border-accent focus:bg-card"
      />
    </label>
  );
}

function M({ label, v }: { label: string; v: number }) {
  return (
    <div className="text-center">
      <div className="stat text-xl leading-none">{v}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-card/60">
        {label}
      </div>
    </div>
  );
}

function defaultMealType(): string {
  const h = new Date(Date.now() + 9 * 3600_000).getUTCHours();
  if (h < 10) return 'Breakfast';
  if (h < 15) return 'Lunch';
  if (h < 21) return 'Dinner';
  return 'Anytime';
}
