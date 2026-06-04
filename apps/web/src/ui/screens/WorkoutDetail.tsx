import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Pencil, Share2, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { Card, StatTile } from '../components/Card';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { Empty, Loading } from '../components/state';
import { WorkoutReport } from '../components/WorkoutReport';
import { api, type RecentSession } from '../lib/api';
import { formatDateForDisplay } from '../lib/datetime';
import { invalidateWorkouts } from '../lib/invalidate';
import { MUSCLE_JA, MUSCLE_TO_SLUGS, stimulusBucket } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';

const RAMP = HEATMAP_RAMP;
const BASE_BODY = '#c2b8a6';

type DetailSet = {
  setType: string;
  entryValue: number | null;
  entryUnit: string;
  reps: number | null;
  rpe: number | null;
};

/** ワークアウト詳細(行タップで開く)。人体ヒートマップ + 種目×セット + メモ + 共有/編集/削除。 */
export function WorkoutDetail({
  id,
  onBack,
  onEdit,
}: {
  id: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['workout', id], queryFn: () => api.getWorkout(id) });
  const [confirm, setConfirm] = useState(false);
  const [report, setReport] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  const del = useMutation({
    mutationFn: () => api.deleteWorkout(id),
    onSuccess: () => {
      invalidateWorkouts(qc);
      onBack();
    },
  });
  const saveNote = useMutation({
    mutationFn: (note: string) => api.setWorkoutNote(id, note),
    onSuccess: () => {
      setEditingNote(false);
      qc.invalidateQueries({ queryKey: ['workout', id] });
    },
  });

  if (detail.isLoading) return <Loading />;
  const d = detail.data;
  const session = d?.session;
  const exercises = d?.exercises ?? [];
  const muscles = d?.muscles ?? [];

  if (!session) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <BackHeader title="ワークアウト" onBack={onBack} />
        <Card>
          <Empty note="このワークアウトは見つかりませんでした。" />
        </Card>
      </div>
    );
  }

  const setCount = exercises.reduce((a, ex) => a + ex.sets.length, 0);
  // 共有画像(WorkoutReport)へ渡す RecentSession 形。
  const recentSession: RecentSession = {
    id: session.id,
    date: session.date,
    title: session.title,
    total_volume_kg: session.totalVolumeKg,
    est_calories: session.estCalories,
    exercises: exercises.length,
    sets: setCount,
  };

  // 人体図データ: intensity を 5 段にバケットし slug 単位で最大値を採用。
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
    const b = stimulusBucket(m.intensity);
    for (const slug of MUSCLE_TO_SLUGS[m.muscle] ?? []) {
      if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
    }
  }
  const bodyData: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));
  const primary = muscles.filter((m) => m.sets > 0).slice(0, 6);
  const isAi = session.noteAuthor === 'ai';

  return (
    <div className="mx-auto max-w-md space-y-4">
      <BackHeader title={session.title || 'ワークアウト'} onBack={onBack}>
        <button
          type="button"
          aria-label="画像で保存"
          onClick={() => setReport(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <Share2 className="h-4 w-4" strokeWidth={2.2} />
        </button>
        <span className="text-sm font-semibold text-muted">
          {formatDateForDisplay(session.date)}
        </span>
      </BackHeader>

      {/* スタッツ */}
      <Card>
        <div className="flex items-center justify-around rounded-2xl bg-ink px-4 py-3 text-card">
          <StatTile label="種目" value={exercises.length} />
          <StatTile label="セット" value={setCount} />
          <StatTile label="総量(kg)" value={Math.round(session.totalVolumeKg).toLocaleString()} />
        </div>
      </Card>

      {/* メモ(UI=あなた / MCP=AIラベル。最大200文字・単一欄) */}
      <Card title="メモ">
        {editingNote ? (
          <div>
            <textarea
              value={noteDraft}
              maxLength={200}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="このワークアウトのメモ(最大200文字)"
              className="h-20 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent focus:bg-card"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-faint">{noteDraft.length}/200</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingNote(false)}
                  className="rounded-lg px-3 py-1 text-xs font-semibold text-muted"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={saveNote.isPending}
                  onClick={() => saveNote.mutate(noteDraft)}
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-bold text-card disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : session.note ? (
          <div>
            {isAi && (
              <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent">
                <Sparkles className="h-3 w-3" strokeWidth={2.4} /> AI コメント
              </span>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{session.note}</p>
            <button
              type="button"
              onClick={() => {
                setNoteDraft(session.note ?? '');
                setEditingNote(true);
              }}
              className="mt-1 text-[11px] font-semibold text-accent"
            >
              編集
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNoteDraft('');
              setEditingNote(true);
            }}
            className="text-sm font-semibold text-accent"
          >
            ＋ メモを追加
          </button>
        )}
      </Card>

      {/* 人体図 + 効かせた部位 */}
      {muscles.length > 0 && (
        <Card title="効かせた部位">
          <div className="grid grid-cols-2 gap-1 [&_svg]:h-auto [&_svg]:max-h-[34vh] [&_svg]:w-full">
            <Model type="anterior" data={bodyData} highlightedColors={RAMP} bodyColor={BASE_BODY} />
            <Model
              type="posterior"
              data={bodyData}
              highlightedColors={RAMP}
              bodyColor={BASE_BODY}
            />
          </div>
          {primary.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {primary.map((m) => {
                const c = RAMP[stimulusBucket(m.intensity) - 1] ?? RAMP[4];
                return (
                  <span
                    key={m.muscle}
                    className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-[11px] font-bold ring-1 ring-line/70"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
                    {MUSCLE_JA[m.muscle] ?? m.muscle}
                    <span className="tnum text-faint">{m.sets}</span>
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 種目内訳(重量×レップ) */}
      <Card title="内訳">
        {exercises.map((ex) => {
          const { groups, warm, top } = summarizeSets(ex.sets);
          return (
            <div key={ex.exerciseId} className="mt-2.5 first:mt-0">
              <div className="text-sm font-semibold text-ink">{ex.name_ja ?? ex.name_en}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {groups.flatMap((g, gi) => {
                  const isTop = g.value != null && g.value === top;
                  return g.reps.map((r, ri) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト
                      key={`${gi}-${ri}`}
                      className={`tnum inline-flex items-baseline gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] leading-none ${
                        isTop
                          ? 'bg-accent-soft font-bold text-ink'
                          : 'bg-paper font-semibold text-muted'
                      }`}
                    >
                      <span>
                        {g.value ?? 'BW'}
                        {g.unit}
                      </span>
                      <span className="text-faint">×</span>
                      <span>{r ?? '—'}</span>
                    </span>
                  ));
                })}
              </div>
              {warm.length > 0 && (
                <div className="tnum mt-0.5 text-[11px] text-faint">
                  <span className="mr-1 rounded bg-paper px-1 text-[9px] font-bold">W</span>
                  {warm
                    .map((w) => `${w.entryValue ?? 'BW'}${w.entryUnit}×${w.reps ?? '—'}`)
                    .join('  ')}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* 編集 / 削除 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onEdit(id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-line py-3 text-sm font-semibold text-muted"
        >
          <Pencil className="h-4 w-4" strokeWidth={2.2} /> 編集
        </button>
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-muted active:text-accent"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2.2} /> 削除
        </button>
      </div>

      {confirm && (
        <DeleteConfirmModal
          kind="workout"
          targetLabel={`${formatDateForDisplay(session.date)} ${session.title || 'ワークアウト'}(${exercises.length}種目 ${setCount}set)`}
          isPending={del.isPending}
          onConfirm={() => del.mutate()}
          onCancel={() => setConfirm(false)}
        />
      )}
      {report && <WorkoutReport session={recentSession} onClose={() => setReport(false)} />}
    </div>
  );
}

function BackHeader({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="戻る"
        onClick={onBack}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight">
        {title}
      </h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** 種目のセット列を表示用に圧縮: main は重量ごとに reps をまとめ(80kg ×8,8,7)、warmup は別。top=最大重量。 */
function summarizeSets(sets: DetailSet[]) {
  const main = sets.filter((s) => s.setType !== 'warmup');
  const warm = sets.filter((s) => s.setType === 'warmup');
  const groups: Array<{ value: number | null; unit: string; reps: Array<number | null> }> = [];
  for (const s of main) {
    const last = groups[groups.length - 1];
    if (last && last.value === s.entryValue && last.unit === s.entryUnit) last.reps.push(s.reps);
    else groups.push({ value: s.entryValue, unit: s.entryUnit, reps: [s.reps] });
  }
  const top = main.reduce((m, s) => Math.max(m, s.entryValue ?? 0), 0);
  return { groups, warm, top };
}
