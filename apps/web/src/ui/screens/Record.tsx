import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Link2, Plus, Search, Trophy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Model, { type IExerciseData } from 'react-body-highlighter';
import { Card } from '../components/Card';
import { api, type Exercise } from '../lib/api';
import { MUSCLE_GROUPS, MUSCLE_TO_SLUG, SLUG_TO_MUSCLE } from '../lib/muscles';

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
  supersetGroup: number | null;
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

// セット種別: タップで循環。warmup は volume 非加算(§8.x)。
const SET_TYPE_CYCLE: SetRow['setType'][] = ['main', 'warmup', 'drop', 'failure'];
const SET_TYPE_META: Record<SetRow['setType'], { abbr: string; cls: string }> = {
  main: { abbr: 'M', cls: 'bg-ink text-card' },
  warmup: { abbr: 'W', cls: 'bg-paper text-faint border border-line' },
  drop: { abbr: 'D', cls: 'bg-carb text-card' },
  failure: { abbr: 'F', cls: 'bg-accent text-card' },
  backoff: { abbr: 'B', cls: 'bg-paper text-muted border border-line' },
  amrap: { abbr: 'A', cls: 'bg-paper text-muted border border-line' },
};

export function RecordScreen({
  onSaved,
  editWorkoutId,
}: {
  onSaved: () => void;
  editWorkoutId?: string | null;
}) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [title, setTitle] = useState('');
  const [bodyweight, setBodyweight] = useState<number | null>(null);
  const [items, setItems] = useState<LoggedExercise[]>([]);
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string | null>(null);

  // 編集モード: 既存セッションを読み込みプレフィル(保存時は旧削除+再記録で置換)。
  const editQ = useQuery({
    queryKey: ['workout', editWorkoutId],
    queryFn: () => api.getWorkout(editWorkoutId!),
    enabled: !!editWorkoutId,
  });
  useEffect(() => {
    if (!editQ.data) return;
    setTitle(editQ.data.session.title ?? '');
    setBodyweight(editQ.data.session.bodyweightKg ?? null);
    setEditDate(editQ.data.session.date);
    setItems(
      editQ.data.exercises.map((ex) => ({
        key: crypto.randomUUID(),
        exercise: {
          id: ex.exerciseId,
          name_en: ex.name_en,
          name_ja: ex.name_ja,
          category: '',
          equipment: null,
          load_basis: 'total',
          is_bodyweight: false,
          bw_factor: 1,
          default_rep_range: null,
        },
        supersetGroup: ex.supersetGroup,
        sets: ex.sets.map((s) =>
          newSet({
            setType: s.setType as SetRow['setType'],
            entryValue: s.entryValue,
            reps: s.reps,
            rpe: s.rpe,
          }),
        ),
      })),
    );
  }, [editQ.data]);

  // 主単位は settings 読込後に「一度だけ」初期化(ユーザー操作後は上書きしない)。
  const unitInit = useRef(false);
  useEffect(() => {
    if (!unitInit.current && settings.data) {
      setUnit(settings.data.settings.unit_preference);
      unitInit.current = true;
    }
  }, [settings.data]);

  // テキスト検索 or 部位チップ のどちらかが指定されたら候補を引く(部位タップで種目候補, 要望)。
  const found = useQuery({
    queryKey: ['ex-search', search, muscle],
    queryFn: () => api.searchExercises(search, muscle ?? undefined),
    enabled: search.trim().length > 0 || muscle != null,
  });

  async function addExercise(ex: Exercise) {
    setSearch('');
    setMuscle(null);
    let prefill: SetRow[] = [newSet()];
    let last: string | undefined;
    try {
      const h = await api.exerciseHistory(ex.id, { limit: 50 });
      const lastMain = h.sets.find((s) => s.set_type === 'main');
      if (lastMain) {
        const v = unit === lastMain.entry_unit ? lastMain.entry_value : null;
        prefill = [newSet({ entryValue: v, reps: lastMain.reps })];
        last = `前回 ${lastMain.entry_value}${lastMain.entry_unit} × ${lastMain.reps} (${lastMain.session_date.slice(5)})`;
      }
    } catch {
      /* 履歴なしは無視 */
    }
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), exercise: ex, last, supersetGroup: null, sets: prefill },
    ]);
  }

  function moveExercise(ei: number, dir: -1 | 1) {
    setItems((prev) => {
      const j = ei + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[ei], next[j]] = [next[j]!, next[ei]!];
      return next;
    });
  }
  function cycleSuperset(ei: number) {
    // null → 1 → 2 → 3 → null(同一番号の隣接種目がスーパーセット)。
    setItems((prev) =>
      prev.map((it, i) =>
        i !== ei
          ? it
          : {
              ...it,
              supersetGroup:
                it.supersetGroup == null ? 1 : it.supersetGroup >= 3 ? null : it.supersetGroup + 1,
            },
      ),
    );
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

  const reqId = useState(() => crypto.randomUUID())[0]; // 冪等キー(このセッションドラフト1回ぶん)
  const save = useMutation({
    mutationFn: async () => {
      // 編集 = 旧セッション削除(GH datapoint も)→ 元の日付で再記録。
      if (editWorkoutId) await api.deleteWorkout(editWorkoutId);
      // ライブタイマーは持たないので、所要時間はセット数から概算(1セット≈3分、最低5分)。
      const now = Math.floor(Date.now() / 1000);
      const estDurationSec = Math.max(300, totalSets * 180);
      return api.saveWorkout({
        title: title || undefined,
        date: editDate ?? undefined,
        bodyweightKg: bodyweight,
        startedAtSec: now - estDurationSec,
        endedAtSec: now,
        clientRequestId: editWorkoutId ? undefined : reqId,
        exercises: items.map((it) => ({
          exerciseId: it.exercise.id,
          supersetGroup: it.supersetGroup,
          sets: it.sets.map((s) => ({
            setType: s.setType,
            entryValue: s.entryValue,
            entryUnit: unit,
            reps: s.reps,
            rpe: s.rpe,
          })),
        })),
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['muscle-volume'] });
      qc.invalidateQueries({ queryKey: ['trends'] });
      qc.invalidateQueries({ queryKey: ['recent-workouts'] });
      // PR があれば祝福を一瞬見せてから Home へ。無ければ即遷移(alert は使わない)。
      if (r.newPrs.length > 0) setTimeout(onSaved, 1600);
      else onSaved();
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
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {it.supersetGroup != null && (
                  <span className="flex items-center gap-0.5 rounded bg-carb px-1.5 py-0.5 text-[10px] font-bold text-card">
                    <Link2 className="h-3 w-3" strokeWidth={2.6} />
                    SS{it.supersetGroup}
                  </span>
                )}
                <div className="truncate font-display text-base font-bold tracking-tight">
                  {it.exercise.name_ja ?? it.exercise.name_en}
                </div>
              </div>
              {it.last && <div className="mt-0.5 text-[11px] text-faint">{it.last}</div>}
            </div>
            <div className="flex shrink-0 items-center text-faint">
              <button
                type="button"
                aria-label="スーパーセット"
                onClick={() => cycleSuperset(ei)}
                className={`rounded-md p-1 ${it.supersetGroup != null ? 'text-carb' : 'hover:text-ink'}`}
              >
                <Link2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="上へ"
                onClick={() => moveExercise(ei, -1)}
                disabled={ei === 0}
                className="rounded-md p-1 hover:text-ink disabled:opacity-25"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="下へ"
                onClick={() => moveExercise(ei, 1)}
                disabled={ei === items.length - 1}
                className="rounded-md p-1 hover:text-ink disabled:opacity-25"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="種目を削除"
                onClick={() => removeExercise(ei)}
                className="rounded-md p-1 hover:text-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-[1.6rem_1fr_1fr_1fr] gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-faint">
            <span>型</span>
            <span>{unit}</span>
            <span>Reps</span>
            <span>RPE</span>
          </div>
          <div className="mt-1 space-y-1.5">
            {it.sets.map((s, si) => (
              <div key={s.key} className="grid grid-cols-[1.6rem_1fr_1fr_1fr] items-center gap-2">
                <button
                  type="button"
                  aria-label="セット種別を変更"
                  onClick={() =>
                    updateSet(ei, si, {
                      setType:
                        SET_TYPE_CYCLE[
                          (SET_TYPE_CYCLE.indexOf(s.setType) + 1) % SET_TYPE_CYCLE.length
                        ],
                    })
                  }
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold ${SET_TYPE_META[s.setType].cls}`}
                >
                  {SET_TYPE_META[s.setType].abbr}
                </button>
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
        {/* 部位タップ起点(要望#5): 身体図をタップ → その部位の種目を表示 */}
        <p className="mb-1 text-[11px] text-faint">
          {muscle
            ? `${MUSCLE_GROUPS.find((m) => m.id === muscle)?.ja ?? ''}の種目`
            : '部位をタップして種目を選ぶ'}
        </p>
        <BodyPicker
          selected={muscle}
          onSelect={(id) => setMuscle((cur) => (cur === id ? null : id))}
        />

        {/* 代替: 部位チップ(図が押しにくい時) */}
        <div className="mt-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {MUSCLE_GROUPS.map((mg) => (
            <button
              type="button"
              key={mg.id}
              onClick={() => setMuscle((cur) => (cur === mg.id ? null : mg.id))}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                muscle === mg.id ? 'bg-accent text-card' : 'bg-paper text-muted border border-line'
              }`}
            >
              {mg.ja}
            </button>
          ))}
        </div>

        {/* 名前検索(副次) */}
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="または名前で探す(例: ベンチ)"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>

        {(search.trim() || muscle) && (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {found.isLoading && <li className="px-3 py-2 text-sm text-faint">検索中…</li>}
            {found.data?.exercises.length === 0 && (
              <li className="px-3 py-2 text-sm text-faint">該当なし(種目シードは順次拡充)</li>
            )}
            {found.data?.exercises.map((ex) => (
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
            <Check className="h-5 w-5" strokeWidth={3} /> {editWorkoutId ? '更新する' : '保存する'}
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

// 身体図ピッカー(前面/背面)。タップで部位を選択 → 親が種目候補を絞る(要望#5)。
function BodyPicker({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const slug = selected ? MUSCLE_TO_SLUG[selected] : undefined;
  const data: IExerciseData[] = slug
    ? [{ name: 'sel', muscles: [slug] as IExerciseData['muscles'], frequency: 1 }]
    : [];
  const onClick = (s: { muscle: string }) => {
    const id = SLUG_TO_MUSCLE[s.muscle];
    if (id) onSelect(id);
  };
  return (
    <div className="grid grid-cols-2 gap-2 [&_svg]:h-auto [&_svg]:max-h-[26vh] [&_svg]:w-full">
      <Model
        type="anterior"
        data={data}
        highlightedColors={['#df4a26']}
        bodyColor="#e6e1d5"
        onClick={onClick}
      />
      <Model
        type="posterior"
        data={data}
        highlightedColors={['#df4a26']}
        bodyColor="#e6e1d5"
        onClick={onClick}
      />
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
