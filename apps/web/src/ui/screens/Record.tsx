import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '../components/Card';
import { api, type Exercise } from '../lib/api';
import { fmtKg } from '../lib/units';

interface SetRow {
  key: string;
  setType: 'warmup' | 'main' | 'drop' | 'backoff' | 'amrap' | 'failure';
  entryValue: number | null;
  reps: number | null;
  rpe: number | null;
}
interface LoggedExercise {
  key: string;
  exercise: Exercise;
  sets: SetRow[];
}

const newSet = (init?: Partial<SetRow>): SetRow => ({
  key: crypto.randomUUID(),
  setType: 'main',
  entryValue: null,
  reps: null,
  rpe: null,
  ...init,
});

export function RecordScreen({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [title, setTitle] = useState('');
  const [bodyweight, setBodyweight] = useState<number | null>(null);
  const [items, setItems] = useState<LoggedExercise[]>([]);
  const [search, setSearch] = useState('');

  // settings 読込後に主単位を初期化。
  if (
    settings.data &&
    unit !== settings.data.settings.unit_preference &&
    items.length === 0 &&
    !search
  ) {
    // 一度だけ反映(items/search が空のうち)。
    setUnit(settings.data.settings.unit_preference);
  }

  const found = useQuery({
    queryKey: ['ex-search', search],
    queryFn: () => api.searchExercises(search),
    enabled: search.trim().length > 0,
  });

  async function addExercise(ex: Exercise) {
    setSearch('');
    // 前回値プレフィル(直近の main セット)。
    let prefill: SetRow[] = [newSet()];
    try {
      const h = await api.exerciseHistory(ex.id);
      const lastMain = h.sets.find((s) => s.set_type === 'main');
      if (lastMain) {
        const v = unit === lastMain.entry_unit ? lastMain.entry_value : null;
        prefill = [newSet({ entryValue: v, reps: lastMain.reps })];
      }
    } catch {
      /* 履歴なしは無視 */
    }
    setItems((prev) => [...prev, { key: crypto.randomUUID(), exercise: ex, sets: prefill }]);
  }

  function updateSet(ei: number, si: number, patch: Partial<SetRow>) {
    setItems((prev) =>
      prev.map((it, i) =>
        i !== ei ? it : { ...it, sets: it.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })) },
      ),
    );
  }
  function addSet(ei: number) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== ei) return it;
        const last = it.sets[it.sets.length - 1];
        return {
          ...it,
          sets: [
            ...it.sets,
            newSet(
              last ? { setType: last.setType, entryValue: last.entryValue, reps: last.reps } : {},
            ),
          ],
        };
      }),
    );
  }
  function removeExercise(ei: number) {
    setItems((prev) => prev.filter((_, i) => i !== ei));
  }

  const save = useMutation({
    mutationFn: () =>
      api.saveWorkout({
        title: title || undefined,
        bodyweightKg: bodyweight,
        startedAtSec: Math.floor(Date.now() / 1000) - 3600,
        endedAtSec: Math.floor(Date.now() / 1000),
        exercises: items.map((it) => ({
          exerciseId: it.exercise.id,
          sets: it.sets.map((s) => ({
            setType: s.setType,
            entryValue: s.entryValue,
            entryUnit: unit,
            reps: s.reps,
            rpe: s.rpe,
          })),
        })),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['muscle-volume', 7] });
      alert(
        `保存: ${r.totalVolumeKg}kg${r.newPrs.length ? ` / 🎉PR更新 ${r.newPrs.length}件` : ''}`,
      );
      onSaved();
    },
  });

  const totalVol = '—'; // 保存時にサーバ計算(プレビューは簡略)

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">ワークアウト記録</h1>
        <UnitToggle unit={unit} onChange={setUnit} />
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="タイトル(例: 胸の日)"
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
      />

      {items.map((it, ei) => (
        <Card key={it.key}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{it.exercise.name_ja ?? it.exercise.name_en}</span>
            <button
              type="button"
              onClick={() => removeExercise(ei)}
              className="text-xs text-rose-400"
            >
              削除
            </button>
          </div>
          <div className="space-y-1">
            <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 text-[10px] text-gray-500">
              <span>#</span>
              <span>重量({unit})</span>
              <span>レップ</span>
              <span>RPE</span>
            </div>
            {it.sets.map((s, si) => (
              <div key={s.key} className="grid grid-cols-[2rem_1fr_1fr_1fr] items-center gap-2">
                <span className="text-xs text-gray-400">{si + 1}</span>
                <NumInput
                  value={s.entryValue}
                  onChange={(v) => updateSet(ei, si, { entryValue: v })}
                  step={unit === 'kg' ? 2.5 : 5}
                />
                <NumInput
                  value={s.reps}
                  onChange={(v) => updateSet(ei, si, { reps: v })}
                  step={1}
                />
                <NumInput
                  value={s.rpe}
                  onChange={(v) => updateSet(ei, si, { rpe: v })}
                  step={0.5}
                />
              </div>
            ))}
            {it.sets[0]?.entryValue != null && (
              <div className="pt-1 text-[11px] text-gray-500">
                例:{' '}
                {fmtKg(
                  unit === 'kg' ? it.sets[0].entryValue : (it.sets[0].entryValue ?? 0) * 0.45359237,
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => addSet(ei)}
            className="mt-2 text-sm text-emerald-400"
          >
            ＋ セット追加
          </button>
        </Card>
      ))}

      <Card title="種目を追加">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="種目名で検索(例: ベンチ)"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
        {found.data && search && (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {found.data.exercises.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => addExercise(ex)}
                  className="w-full rounded-md bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
                >
                  {ex.name_ja ?? ex.name_en}
                  <span className="ml-2 text-[11px] text-gray-500">{ex.equipment}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">体重</span>
        <NumInput value={bodyweight} onChange={setBodyweight} step={0.1} />
        <span className="text-xs text-gray-500">{unit}</span>
      </div>

      <button
        type="button"
        disabled={items.length === 0 || save.isPending}
        onClick={() => save.mutate()}
        className="w-full rounded-xl bg-emerald-600 py-3 font-semibold disabled:opacity-40"
      >
        {save.isPending ? '保存中…' : 'セッションを終了して保存'}
      </button>
      {save.error && <p className="text-sm text-rose-300">{(save.error as Error).message}</p>}
      <p className="text-center text-[11px] text-gray-600">
        総ボリューム {totalVol}(保存時にサーバ計算)
      </p>
    </div>
  );
}

function UnitToggle({ unit, onChange }: { unit: 'kg' | 'lb'; onChange: (u: 'kg' | 'lb') => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-white/10 text-xs">
      {(['kg', 'lb'] as const).map((u) => (
        <button
          type="button"
          key={u}
          onClick={() => onChange(u)}
          className={`px-3 py-1 ${unit === u ? 'bg-emerald-600 text-white' : 'text-gray-400'}`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  step,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step: number;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-center text-sm"
    />
  );
}
