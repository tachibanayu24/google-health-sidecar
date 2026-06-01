import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Check, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Card } from '../components/Card';
import { api, type FoodSuggestion, type MealPreset } from '../lib/api';
import { jstHourNow } from '../lib/datetime';
import { round, saltFromSodiumMg, sodiumMgFromSalt } from '../lib/units';

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
  saltG: number | null; // 食塩相当量(g)。保存時に sodium(mg)へ換算。
}
const newItem = (init?: Partial<Item>): Item => ({
  key: crypto.randomUUID(),
  foodName: '',
  caloriesKcal: null,
  proteinG: null,
  fatG: null,
  carbsG: null,
  saltG: null,
  ...init,
});

export function MealScreen({
  onSaved,
  editMealId,
  onDirty,
}: {
  onSaved: () => void;
  editMealId?: string | null;
  onDirty?: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const [mealType, setMealType] = useState<string>(defaultMealType());
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [editMeta, setEditMeta] = useState<{ date: string; loggedAtSec: number } | null>(null);

  const presets = useQuery({ queryKey: ['meal-presets'], queryFn: api.mealPresets });

  // 編集モード: 既存の食事を読み込んでプレフィル(保存時は旧削除+新記録で置換)。
  const editQ = useQuery({
    queryKey: ['meal', editMealId],
    queryFn: () => api.getMeal(editMealId!),
    enabled: !!editMealId,
  });
  useEffect(() => {
    if (!editQ.data) return;
    setMealType(editQ.data.meal.meal_type);
    setEditMeta({ date: editQ.data.meal.date, loggedAtSec: editQ.data.meal.logged_at });
    setItems(
      editQ.data.items.map((i) =>
        newItem({
          foodName: i.food_name,
          caloriesKcal: Math.round(i.calories_kcal),
          proteinG: Math.round(i.protein_g),
          fatG: Math.round(i.fat_g),
          carbsG: Math.round(i.carbs_g),
          saltG: i.sodium_mg != null ? round(saltFromSodiumMg(i.sodium_mg), 1) : null,
        }),
      ),
    );
  }, [editQ.data]);

  const update = (k: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === k ? { ...it, ...patch } : it)));
  const remove = (k: string) => setItems((prev) => prev.filter((it) => it.key !== k));

  function applyPreset(p: MealPreset) {
    setMealType(p.defaultMealType);
    setPresetId(p.id);
    setItems(
      p.items.map((i) =>
        newItem({
          foodName: i.foodName,
          caloriesKcal: Math.round(i.caloriesKcal),
          proteinG: i.proteinG != null ? Math.round(i.proteinG) : null,
          fatG: i.fatG != null ? Math.round(i.fatG) : null,
          carbsG: i.carbsG != null ? Math.round(i.carbsG) : null,
          saltG: i.sodiumMg != null ? round(saltFromSodiumMg(i.sodiumMg), 1) : null,
        }),
      ),
    );
  }

  const total = items.reduce(
    (a, it) => ({
      kcal: a.kcal + (it.caloriesKcal ?? 0),
      p: a.p + (it.proteinG ?? 0),
      f: a.f + (it.fatG ?? 0),
      c: a.c + (it.carbsG ?? 0),
      salt: a.salt + (it.saltG ?? 0),
    }),
    { kcal: 0, p: 0, f: 0, c: 0, salt: 0 },
  );

  const valid = items.filter((it) => it.foodName.trim() && it.caloriesKcal != null);

  const itemInputs = () =>
    valid.map((it) => ({
      foodName: it.foodName.trim(),
      caloriesKcal: it.caloriesKcal ?? 0,
      proteinG: it.proteinG ?? undefined,
      fatG: it.fatG ?? undefined,
      carbsG: it.carbsG ?? undefined,
      sodiumMg: it.saltG != null ? Math.round(sodiumMgFromSalt(it.saltG)) : undefined,
    }));

  const reqId = useState(() => crypto.randomUUID())[0]; // 冪等キー(この記録ドラフト1回ぶん)
  const save = useMutation({
    mutationFn: async () => {
      // 編集 = 旧 meal を削除(GH datapoint も)→ 元の日時で再記録(GH anonymous food は immutable, §5.2)。
      if (editMealId) await api.deleteMeal(editMealId);
      return api.logMeal({
        mealType,
        date: editMeta?.date,
        loggedAtSec: editMeta?.loggedAtSec,
        inputMethod: presetId ? 'preset' : 'manual',
        items: itemInputs(),
        presetId: presetId ?? undefined,
        clientRequestId: editMealId ? undefined : reqId, // 新規記録のみ冪等(編集は毎回新規mealId)
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['trends'] });
      onSaved();
    },
  });

  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const savePreset = useMutation({
    mutationFn: (name: string) =>
      api.saveMealPreset({ name, defaultMealType: mealType, items: itemInputs() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meal-presets'] });
      setPresetOpen(false);
      setPresetName('');
    },
  });
  const delPreset = useMutation({
    mutationFn: api.deleteMealPreset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-presets'] }),
  });

  // 未保存の入力があるか(離脱時の破棄ガード用)。
  useEffect(() => {
    const dirty =
      !save.isSuccess && items.some((it) => it.foodName.trim() !== '' || it.caloriesKcal != null);
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [items, save.isSuccess, onDirty]);

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

      {presets.data && presets.data.presets.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {presets.data.presets.map((p) => (
            <span
              key={p.id}
              className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-card py-1 pl-3 pr-1.5 text-xs font-semibold"
            >
              <button
                type="button"
                onClick={() => applyPreset(p)}
                className="flex items-center gap-1"
              >
                <Bookmark className="h-3 w-3 text-accent" strokeWidth={2.4} />
                {p.name}
              </button>
              <button
                type="button"
                aria-label="プリセット削除"
                onClick={() => delPreset.mutate(p.id)}
                className="text-faint active:text-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

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

      {/* 合計: kcal を別格に大きく、PFC・塩は従属表示 */}
      <div className="flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-card">
        <div className="flex items-baseline gap-1">
          <span className="stat text-3xl leading-none">{Math.round(total.kcal)}</span>
          <span className="text-xs font-semibold text-card/55">kcal</span>
        </div>
        <div className="flex gap-3.5">
          <M label="P" v={Math.round(total.p)} />
          <M label="F" v={Math.round(total.f)} />
          <M label="C" v={Math.round(total.c)} />
          <M label="塩g" v={round(total.salt, 1)} />
        </div>
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
            <Check className="h-5 w-5" strokeWidth={3} /> {editMealId ? '食事を更新' : '食事を記録'}
          </>
        )}
      </button>
      {save.error && (
        <p className="text-center text-sm text-accent-ink">{(save.error as Error).message}</p>
      )}

      {valid.length > 0 && (
        <button
          type="button"
          onClick={() => setPresetOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-sm font-semibold text-muted"
        >
          <Bookmark className="h-4 w-4" strokeWidth={2.2} />
          プリセットとして保存
        </button>
      )}

      <p className="text-center text-[11px] text-faint">
        写真からの自動栄養計算は Claude(MCP)経由。ここは手入力 + 過去食の補完。
      </p>

      {presetOpen && (
        <PresetSaveSheet
          name={presetName}
          onName={setPresetName}
          onClose={() => setPresetOpen(false)}
          onSave={() => presetName.trim() && savePreset.mutate(presetName.trim())}
          pending={savePreset.isPending}
          count={valid.length}
        />
      )}
    </div>
  );
}

/** プリセット名入力のボトムシート(window.prompt 置換)。 */
function PresetSaveSheet({
  name,
  onName,
  onClose,
  onSave,
  pending,
  count,
}: {
  name: string;
  onName: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  pending: boolean;
  count: number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div className="rise relative w-full max-w-md rounded-t-3xl bg-card px-5 pb-8 pt-5 shadow-[0_-12px_40px_-12px] shadow-ink/30">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" />
        <div className="mb-1 flex items-center gap-2 font-display text-base font-bold">
          <Bookmark className="h-4 w-4 text-accent" strokeWidth={2.4} /> プリセットとして保存
        </div>
        <p className="mb-3 text-xs text-muted">現在の{count}品をまとめて呼び出せるようにします。</p>
        <input
          // biome-ignore lint/a11y/noAutofocus: ボトムシートを開いた直後に名前入力へフォーカスするのは妥当
          autoFocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSave()}
          placeholder="プリセット名(例: 朝の定番)"
          className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-faint focus:border-accent focus:bg-card"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold text-muted"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!name.trim() || pending}
            onClick={onSave}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-card disabled:opacity-40"
          >
            {pending ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
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
      saltG: s.sodium_mg != null ? round(saltFromSodiumMg(s.sodium_mg), 1) : null,
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
            onBlur={() => setTimeout(() => setOpen(false), 150)}
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
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        <Field
          label="kcal"
          value={item.caloriesKcal}
          onChange={(v) => onChange({ caloriesKcal: v })}
        />
        <Field label="P" value={item.proteinG} onChange={(v) => onChange({ proteinG: v })} />
        <Field label="F" value={item.fatG} onChange={(v) => onChange({ fatG: v })} />
        <Field label="C" value={item.carbsG} onChange={(v) => onChange({ carbsG: v })} />
        <Field label="塩g" value={item.saltG} onChange={(v) => onChange({ saltG: v })} />
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
  const h = jstHourNow();
  if (h < 10) return 'Breakfast';
  if (h < 15) return 'Lunch';
  if (h < 21) return 'Dinner';
  return 'Anytime';
}
