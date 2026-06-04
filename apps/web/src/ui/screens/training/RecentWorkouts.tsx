import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../../components/Card';
import { DeleteConfirmModal } from '../../components/DeleteConfirmModal';
import { Empty } from '../../components/state';
import { WorkoutReport } from '../../components/WorkoutReport';
import { api, type RecentSession } from '../../lib/api';
import { formatDateForDisplay } from '../../lib/datetime';
import { invalidateWorkouts } from '../../lib/invalidate';

// ============ 最近のワークアウト(展開で種目×セット読取 + 削除確認) ============
export function RecentWorkouts({ onEdit }: { onEdit: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['recent-workouts'], queryFn: api.recentWorkouts });
  const [confirm, setConfirm] = useState<{ id: string; label: string } | null>(null);
  const del = useMutation({
    mutationFn: api.deleteWorkout,
    onSuccess: () => {
      setConfirm(null);
      invalidateWorkouts(qc);
    },
  });
  const sessions = q.data?.sessions ?? [];
  return (
    <div className="space-y-3">
      <h2 className="px-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
        最近のワークアウト
      </h2>
      {sessions.length === 0 ? (
        <Card>
          <Empty note="ワークアウトを記録するとここに一覧が出ます。" />
        </Card>
      ) : (
        sessions.map((s, i) => (
          <WorkoutSessionRow
            key={s.id}
            session={s}
            initiallyOpen={i === 0}
            onEdit={onEdit}
            onAskDelete={(sess) =>
              setConfirm({
                id: sess.id,
                label: `${formatDateForDisplay(sess.date)} ${sess.title || 'ワークアウト'}(${sess.exercises}種目 ${sess.sets}set)`,
              })
            }
          />
        ))
      )}
      {confirm && (
        <DeleteConfirmModal
          kind="workout"
          targetLabel={confirm.label}
          isPending={del.isPending}
          onConfirm={() => del.mutate(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/** 種目のセット列を表示用に圧縮: main は重量ごとに reps をまとめ(80kg ×8,8,7)、warmup は別。top=最大重量。 */
function summarizeSets(
  sets: Array<{
    setType: string;
    entryValue: number | null;
    entryUnit: string;
    reps: number | null;
    rpe: number | null;
  }>,
) {
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

function WorkoutSessionRow({
  session: s,
  initiallyOpen,
  onEdit,
  onAskDelete,
}: {
  session: RecentSession;
  initiallyOpen: boolean;
  onEdit: (id: string) => void;
  onAskDelete: (s: RecentSession) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [report, setReport] = useState(false);
  const detail = useQuery({
    queryKey: ['workout', s.id],
    queryFn: () => api.getWorkout(s.id),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="font-display font-bold tracking-tight">{s.title || 'ワークアウト'}</span>
          <span className="mt-0.5 block text-[11px] text-faint">
            {formatDateForDisplay(s.date)} · {s.exercises}種目 {s.sets}set ·{' '}
            {Math.round(s.total_volume_kg).toLocaleString()}kg
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
        )}
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-line/50 pl-3">
          {detail.isLoading && <p className="text-[11px] text-faint">読み込み中…</p>}
          {detail.error && (
            <button
              type="button"
              onClick={() => detail.refetch()}
              className="text-[11px] font-semibold text-accent-ink underline"
            >
              読み込みに失敗。タップで再試行
            </button>
          )}
          {detail.data?.exercises.map((ex) => {
            const { groups, warm, top } = summarizeSets(ex.sets);
            return (
              <div key={ex.exerciseId} className="mt-2.5 first:mt-0">
                <div className="text-sm font-semibold text-ink">{ex.name_ja ?? ex.name_en}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {groups.flatMap((g, gi) => {
                    const isTop = g.value != null && g.value === top;
                    return g.reps.map((r, ri) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト(並べ替えなし)
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
          <div className="mt-2.5 flex items-center gap-1">
            <button
              type="button"
              aria-label="シェア画像"
              onClick={() => setReport(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted active:text-accent"
            >
              <Share2 className="h-3.5 w-3.5" strokeWidth={2.2} /> シェア
            </button>
            <button
              type="button"
              aria-label="編集"
              onClick={() => onEdit(s.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted active:text-accent"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} /> 編集
            </button>
            <button
              type="button"
              aria-label="削除"
              onClick={() => onAskDelete(s)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-muted active:text-accent"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} /> 削除
            </button>
          </div>
        </div>
      )}
      {report && <WorkoutReport session={s} onClose={() => setReport(false)} />}
    </Card>
  );
}
