import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Clock, Plus, Search, Trophy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Model, { type IExerciseData } from 'react-body-highlighter';
import { Card } from '../components/Card';
import { api, type Exercise } from '../lib/api';
import {
  datetimeLocalToEpochSec,
  datetimeLocalToJstDate,
  epochToDatetimeLocal,
  nowDatetimeLocal,
} from '../lib/datetime';
import { invalidateWorkouts } from '../lib/invalidate';
import { MUSCLE_GROUPS, MUSCLE_TO_SLUG, SLUG_TO_MUSCLE } from '../lib/muscles';

interface SetRow {
  key: string;
  setType: 'warmup' | 'main';
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

// セット種別は「本番 / ウォームアップ」の2状態のみ(本番チェックで表現)。warmup は総量・PR から除外(§8.x)。

export function RecordScreen({
  onSaved,
  editWorkoutId,
  onDirty,
}: {
  onSaved: () => void;
  editWorkoutId?: string | null;
  onDirty?: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [bodyweight, setBodyweight] = useState<number | null>(null);
  const [items, setItems] = useState<LoggedExercise[]>([]);
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [when, setWhen] = useState<string>(nowDatetimeLocal()); // 登録日時(JST壁時計, datetime-local)

  // 編集モード: 既存セッションを読み込みプレフィル(保存時は旧削除+再記録で置換)。
  const editQ = useQuery({
    queryKey: ['workout', editWorkoutId],
    queryFn: () => api.getWorkout(editWorkoutId!),
    enabled: !!editWorkoutId,
  });
  useEffect(() => {
    if (!editQ.data) return;
    // セッション名は保存時に内容から再命名するため prefill しない。
    setBodyweight(editQ.data.session.bodyweightKg ?? null);
    // 登録日時は元の started_at(無ければ日付の正午)を JST 壁時計で prefill。
    setWhen(
      editQ.data.session.startedAt != null
        ? epochToDatetimeLocal(editQ.data.session.startedAt)
        : `${editQ.data.session.date}T12:00`,
    );
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
        // 旧データの drop/failure 等は本番に集約(種別は本番/W の2状態のみ)。
        sets: ex.sets.map((s) =>
          newSet({
            setType: s.setType === 'warmup' ? 'warmup' : 'main',
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

  // 新規記録は最新体重を初期値に(自重種目の挙上重量・消費カロリー算出に使う。毎回入力する摩擦を解消)。
  // 編集時は既存セッションの体重を尊重するため自動入力しない。
  const bodyQ = useQuery({
    queryKey: ['today'],
    queryFn: () => api.today(),
    enabled: !editWorkoutId,
  });
  const bwInit = useRef(false);
  useEffect(() => {
    if (editWorkoutId || bwInit.current || !bodyQ.data) return;
    const latest = bodyQ.data.body.weightKg ?? bodyQ.data.body.prevWeightKg;
    if (latest != null) setBodyweight(Math.round(latest * 10) / 10);
    bwInit.current = true;
  }, [bodyQ.data, editWorkoutId]);

  // 部位選択(身体図/チップ連動)時、選択チップが横スクロールで画面外なら中央へ寄せる。
  const selectedChipRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (muscle)
      selectedChipRef.current?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'smooth',
      });
  }, [muscle]);

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
    setItems((prev) => [...prev, { key: crypto.randomUUID(), exercise: ex, last, sets: prefill }]);
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
      // 登録日時(JST壁時計)を終了時刻とし、所要時間はセット数から概算(1セット≈3分、最低5分)。
      const endedAtSec = datetimeLocalToEpochSec(when);
      const estDurationSec = Math.max(300, totalSets * 180);
      return api.saveWorkout({
        // title は送らない: サービス側が内容(主働筋の部位)から自動命名する。
        date: datetimeLocalToJstDate(when),
        bodyweightKg: bodyweight,
        startedAtSec: endedAtSec - estDurationSec,
        endedAtSec,
        clientRequestId: editWorkoutId ? undefined : reqId,
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
      });
    },
    onSuccess: (r) => {
      invalidateWorkouts(qc);
      // PR があれば祝福を一瞬見せてから Home へ。無ければ即遷移(alert は使わない)。
      if (r.newPrs.length > 0) setTimeout(onSaved, 1600);
      else onSaved();
    },
  });

  // 未保存の入力があるか(離脱時の破棄ガード用)。保存成功後は画面が遷移するので report 不要。
  useEffect(() => {
    const dirty = !save.isSuccess && items.length > 0;
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [items, save.isSuccess, onDirty]);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between gap-3">
        {/* セッション名は内容(主働筋の部位)から自動命名。手入力は廃止。 */}
        <h1 className="font-display text-lg font-bold tracking-tight">
          {editWorkoutId ? 'ワークアウトを編集' : 'ワークアウトを記録'}
        </h1>
        <UnitToggle unit={unit} onChange={setUnit} />
      </div>

      {/* 登録日時(デフォルト現在時刻・編集可)。過去のセッションも遡って記録できる。 */}
      <label className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5 text-sm">
        <Clock className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.2} />
        <span className="shrink-0 text-muted">日時</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="ml-auto bg-transparent text-right font-semibold tnum outline-none"
        />
      </label>

      {items.map((it, ei) => (
        <Card key={it.key}>
          <div className="mb-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-display text-base font-bold tracking-tight">
                {it.exercise.name_en}
              </div>
              {it.last && <div className="mt-0.5 text-[11px] text-faint">{it.last}</div>}
            </div>
            <div className="flex shrink-0 items-center text-faint">
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
            <span>本番</span>
            <span>{unit}</span>
            <span>Reps</span>
            <span>RPE</span>
          </div>
          <div className="mt-1 space-y-1.5">
            {it.sets.map((s, si) => (
              <div key={s.key} className="grid grid-cols-[1.6rem_1fr_1fr_1fr] items-center gap-2">
                {/* 本番セットのチェック。チェック=総量・PRに計上、外す=ウォームアップ。 */}
                <label
                  className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border transition-colors ${
                    s.setType === 'main'
                      ? 'border-ink bg-ink text-card'
                      : 'border-line text-transparent'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    aria-label="本番セット"
                    checked={s.setType === 'main'}
                    onChange={() =>
                      updateSet(ei, si, { setType: s.setType === 'main' ? 'warmup' : 'main' })
                    }
                  />
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </label>
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

      {items.length > 0 && (
        <p className="px-1 text-[11px] leading-snug text-muted">
          <span className="font-bold text-ink">本番</span> にチェックが入ったセットだけ総量・PR
          に計上します(外すとウォームアップ)。
        </p>
      )}

      <Card title="種目を追加">
        {/* 身体図 or チップをタップ → その部位の種目を表示。選択中はチップがハイライトされる。 */}
        <BodyPicker
          selected={muscle}
          onSelect={(id) => setMuscle((cur) => (cur === id ? null : id))}
        />

        {/* 部位チップ(横スクロール)。選択は身体図とも連動し、画面外なら中央へスクロールする。 */}
        <div className="mt-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {MUSCLE_GROUPS.map((mg) => (
            <button
              type="button"
              key={mg.id}
              ref={muscle === mg.id ? selectedChipRef : null}
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
            placeholder="または名前で探す"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>

        {(search.trim() || muscle) && (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {found.isLoading && <li className="px-3 py-2 text-sm text-faint">検索中…</li>}
            {found.data?.exercises.length === 0 && (
              <li className="px-3 py-2 text-sm text-faint">該当なし</li>
            )}
            {found.data?.exercises.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => addExercise(ex)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-paper"
                >
                  <span className="font-medium">{ex.name_en}</span>
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
        <span className="flex flex-col">
          <span className="text-sm text-muted">体重({unit})</span>
          {!editWorkoutId && bwInit.current && bodyweight != null && (
            <span className="text-[10px] text-faint">最新の記録から · 自重種目/消費kcalに使用</span>
          )}
        </span>
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
    <div className="grid grid-cols-2 gap-3 [&_svg]:h-auto [&_svg]:max-h-[32vh] [&_svg]:w-full">
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
