import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/Card';
import { api, type Exercise } from '../lib/api';

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
  last?: string;
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

  if (
    settings.data &&
    unit !== settings.data.settings.unit_preference &&
    items.length === 0 &&
    !search
  ) {
    setUnit(settings.data.settings.unit_preference);
  }

  const found = useQuery({
    queryKey: ['ex-search', search],
    queryFn: () => api.searchExercises(search),
    enabled: search.trim().length > 0,
  });

  async function addExercise(ex: Exercise) {
    setSearch('');
    let prefill: SetRow[] = [newSet()];
    let last: string | undefined;
    try {
      const h = await api.exerciseHistory(ex.id);
      const lastMain = h.sets.find((s) => s.set_type === 'main');
      if (lastMain) {
        const v = unit === lastMain.entry_unit ? lastMain.entry_value : null;
        prefill = [newSet({ entryValue: v, reps: lastMain.reps })];
        last = `前回 ${lastMain.entry_value}${lastMain.entry_unit} × ${lastMain.reps} (${lastMain.session_date.slice(5)})`;
      }
    } catch {
      /* 履歴なしは無視 */
    }
    setItems((prev) => [...prev, { key: crypto.randomUUID(), exercise: ex, last, sets: prefill }]);
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
  const removeExercise = (ei: number) => setItems((prev) => prev.filter((_, i) => i !== ei));

  const totalVolume = items.reduce(
    (a, it) =>
      a +
      it.sets.reduce(
        (b, s) => (s.setType !== 'warmup' ? b + (s.entryValue ?? 0) * (s.reps ?? 0) : b),
        0,
      ),
    0,
  );
  const totalSets = items.reduce((a, it) => a + it.sets.length, 0);

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
      onSaved();
      if (r.newPrs.length) alert(`保存 ${r.totalVolumeKg}kg · 🎉 PR更新 ${r.newPrs.length}件`);
    },
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="セッション名(例: Push A)"
          className="min-w-0 flex-1 border-b border-line bg-transparent pb-1 font-display text-lg font-bold tracking-tight outline-none placeholder:text-faint focus:border-accent"
        />
        <UnitToggle unit={unit} onChange={setUnit} />
      </div>

      {items.map((it, ei) => (
        <Card key={it.key}>
          <div className="mb-1 flex items-start justify-between">
            <div>
              <div className="font-display text-base font-bold tracking-tight">
                {it.exercise.name_ja ?? it.exercise.name_en}
              </div>
              {it.last && <div className="mt-0.5 text-[11px] text-faint">{it.last}</div>}
            </div>
            <button
              type="button"
              aria-label="種目を削除"
              onClick={() => removeExercise(ei)}
              className="rounded-md p-1 text-faint hover:text-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-[1.6rem_1fr_1fr_1fr] gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-faint">
            <span>Set</span>
            <span>{unit}</span>
            <span>Reps</span>
            <span>RPE</span>
          </div>
          <div className="mt-1 space-y-1.5">
            {it.sets.map((s, si) => (
              <div key={s.key} className="grid grid-cols-[1.6rem_1fr_1fr_1fr] items-center gap-2">
                <span className="text-center text-xs font-bold text-faint tnum">{si + 1}</span>
                <NumInput
                  value={s.entryValue}
                  onChange={(v) => updateSet(ei, si, { entryValue: v })}
                />
                <NumInput value={s.reps} onChange={(v) => updateSet(ei, si, { reps: v })} />
                <NumInput value={s.rpe} onChange={(v) => updateSet(ei, si, { rpe: v })} />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => addSet(ei)}
            className="mt-2.5 flex items-center gap-1 text-sm font-semibold text-accent"
          >
            <Plus className="h-4 w-4" /> セット追加
          </button>
        </Card>
      ))}

      <Card title="種目を追加">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="種目名で検索(例: ベンチ)"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
        {found.data && search && (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {found.data.exercises.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => addExercise(ex)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-paper"
                >
                  <span className="font-medium">{ex.name_ja ?? ex.name_en}</span>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-faint">
                    {ex.equipment}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-3">
        <span className="text-sm text-muted">体重({unit})</span>
        <div className="w-24">
          <NumInput value={bodyweight} onChange={setBodyweight} />
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex items-center justify-around rounded-2xl bg-ink px-4 py-3 text-card">
          <Metric label="種目" value={items.length} />
          <Metric label="セット" value={totalSets} />
          <Metric label={`総量(${unit})`} value={Math.round(totalVolume).toLocaleString()} />
        </div>
      )}

      <button
        type="button"
        disabled={items.length === 0 || save.isPending}
        onClick={() => save.mutate()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-card shadow-[0_8px_24px_-8px] shadow-accent/60 transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
      >
        {save.isPending ? (
          '保存中…'
        ) : (
          <>
            <Check className="h-5 w-5" strokeWidth={3} /> 保存する
          </>
        )}
      </button>
      {save.data?.newPrs.length ? (
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-accent-ink">
          <Trophy className="h-4 w-4" /> PR更新 {save.data.newPrs.length}件
        </p>
      ) : null}
      {save.error && (
        <p className="text-center text-sm text-accent-ink">{(save.error as Error).message}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center">
      <div className="stat text-xl leading-none">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-card/60">
        {label}
      </div>
    </div>
  );
}

function UnitToggle({ unit, onChange }: { unit: 'kg' | 'lb'; onChange: (u: 'kg' | 'lb') => void }) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-line text-xs font-bold">
      {(['kg', 'lb'] as const).map((u) => (
        <button
          type="button"
          key={u}
          onClick={() => onChange(u)}
          className={`px-3 py-1.5 uppercase transition-colors ${
            unit === u ? 'bg-ink text-card' : 'bg-card text-faint'
          }`}
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
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-center text-sm font-semibold tnum outline-none focus:border-accent focus:bg-card"
    />
  );
}
