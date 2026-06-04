import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Moon, Share2, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { Card } from '../components/Card';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { ReportStat, ShareImageModal } from '../components/ShareImageModal';
import { Empty, ErrorBox, Loading } from '../components/state';
import { api, type RoutineDay, type RoutineDetail } from '../lib/api';
import { stimulusBucket as bucket, MUSCLE_JA, MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';

const RAMP = HEATMAP_RAMP;
const BASE_BODY = '#c2b8a6';

type RMuscle = { muscle: string; sets: number; intensity: number };

/** muscles[] → 5段バケットの body-highlighter データ(anterior/posterior 共用)。 */
function bodyData(muscles: RMuscle[]): IExerciseData[] {
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
    const b = bucket(m.intensity);
    for (const slug of MUSCLE_TO_SLUGS[m.muscle] ?? []) {
      if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
    }
  }
  return [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));
}

/** サイクル全日の部位を合算して再正規化(全体像の人体図用)。 */
function combineMuscles(days: RoutineDay[]): RMuscle[] {
  const acc = new Map<string, { sets: number; intensity: number }>();
  for (const d of days)
    for (const m of d.muscles) {
      const a = acc.get(m.muscle) ?? { sets: 0, intensity: 0 };
      a.sets += m.sets;
      a.intensity += m.intensity;
      acc.set(m.muscle, a);
    }
  const max = Math.max(1, ...[...acc.values()].map((v) => v.intensity));
  return [...acc]
    .map(([muscle, a]) => ({ muscle, sets: a.sets, intensity: a.intensity / max }))
    .sort((x, y) => y.intensity - x.intensity);
}

function BodyFigure({ muscles }: { muscles: RMuscle[] }) {
  const data = bodyData(muscles);
  return (
    <div className="grid grid-cols-2 gap-1 [&_svg]:h-auto [&_svg]:max-h-44 [&_svg]:w-full">
      <Model type="anterior" data={data} highlightedColors={RAMP} bodyColor={BASE_BODY} />
      <Model type="posterior" data={data} highlightedColors={RAMP} bodyColor={BASE_BODY} />
    </div>
  );
}

function MuscleChips({ muscles, limit = 6 }: { muscles: RMuscle[]; limit?: number }) {
  const shown = muscles.filter((m) => m.intensity > 0.02).slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((m) => {
        const c = RAMP[bucket(m.intensity) - 1] ?? RAMP[4];
        return (
          <span
            key={m.muscle}
            className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[11px] font-bold ring-1 ring-line/70"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
            {MUSCLE_JA[m.muscle] ?? m.muscle}
            {m.sets > 0 && <span className="tnum text-faint">{m.sets}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** セット/レップ範囲を "4-5" / "4" 形式に。両 null は null。 */
function rangeLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const lo = min ?? max;
  const hi = max ?? min;
  return lo === hi ? `${lo}` : `${lo}-${hi}`;
}

function ExerciseRow({ e }: { e: RoutineDay['exercises'][number] }) {
  const sets = rangeLabel(e.sets_min, e.sets_max);
  const reps = rangeLabel(e.reps_min, e.reps_max);
  return (
    <li className="py-1.5">
      <div className="flex items-start gap-2">
        {/* 種目名 + 代替 + note を左カラムに入れ子にし、note は名前直下へ(右側メトリクスの高さに引きずられない)。 */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-ink">{e.exercise_name ?? e.exercise_id}</span>
          {e.alt_exercise_name && (
            <span className="ml-1.5 text-[11px] font-normal text-muted">
              or {e.alt_exercise_name}
            </span>
          )}
          {e.note && <p className="mt-0.5 text-[11px] leading-snug text-faint">{e.note}</p>}
        </div>
        {/* セット/レップは slash でなく改行スタックにし、種目名の左スペースを広く取る。 */}
        <span className="tnum flex shrink-0 flex-col items-end text-[11px] font-semibold leading-tight text-muted">
          {sets && <span>{sets}セット</span>}
          {reps && <span>{reps}レップ</span>}
          {e.target_load && <span className="text-accent-ink">{e.target_load}</span>}
        </span>
      </div>
    </li>
  );
}

function DayCard({ day }: { day: RoutineDay }) {
  if (day.is_rest) {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <Moon className="h-4 w-4 text-carb" strokeWidth={2.2} />
          <span className="text-sm font-bold text-muted">
            {day.label ?? `Day ${day.position}`} · {day.title || 'レスト'}
          </span>
        </div>
        {day.note && <div className="mt-1 text-[11px] text-faint">{day.note}</div>}
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-baseline gap-2">
        {day.label && (
          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">
            {day.label}
          </span>
        )}
        <span className="font-display text-base font-bold tracking-tight">{day.title}</span>
      </div>
      {day.aim && <div className="mt-0.5 text-[11px] text-muted">{day.aim}</div>}
      {day.muscles.length > 0 && (
        <>
          <div className="mt-2">
            <BodyFigure muscles={day.muscles} />
          </div>
          <MuscleChips muscles={day.muscles} />
        </>
      )}
      <ul className="mt-3 divide-y divide-line/50 border-t border-line/50">
        {day.exercises.map((e) => (
          <ExerciseRow key={e.id} e={e} />
        ))}
      </ul>
      {day.note && (
        <div className="mt-2 rounded-lg bg-paper px-2.5 py-2 text-[11px] leading-snug text-muted">
          {day.note}
        </div>
      )}
    </Card>
  );
}

// ============ 一覧 ============
export function RoutinesListScreen({
  onOpen,
  onBack,
}: {
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const q = useQuery({ queryKey: ['routines'], queryFn: api.routines });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const routines = q.data?.routines ?? [];
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="戻る"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <h1 className="font-display text-lg font-bold tracking-tight">ルーティン</h1>
      </div>
      {routines.length === 0 ? (
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div className="text-sm leading-relaxed text-muted">
              <p className="font-bold text-ink">ルーティンはまだありません</p>
              <p className="mt-1">
                ルーティンは Claude(AIトレーナー)が作ってここに保存します。Claude
                とのチャットで、例えばこう頼んでください:
              </p>
              <p className="mt-2 rounded-lg bg-paper px-2.5 py-2 text-[12px] text-ink">
                「減量フェーズ向けに、胸・肩を強化する6日サイクルのルーティンを作って Logbook
                に保存して」
              </p>
              <p className="mt-2 text-[11px] text-faint">
                ※ Claude の連携(MCP
                コネクタ)が必要です。種目は登録済みカタログから選ばれ、各日の人体図つきでここに表示されます。
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {routines.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="block w-full text-left [-webkit-tap-highlight-color:transparent]"
              >
                <Card>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <Sparkles className="h-5 w-5" strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-display text-base font-bold tracking-tight">
                          {r.name}
                        </span>
                        {r.is_active && (
                          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-card">
                            運用中
                          </span>
                        )}
                      </div>
                      {r.goal && <div className="truncate text-[11px] text-muted">{r.goal}</div>}
                      <div className="mt-0.5 text-[10px] text-faint">{r.day_count}日サイクル</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
                  </div>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============ 詳細 ============
export function RoutineDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['routine', id], queryFn: () => api.routine(id) });
  const [share, setShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteRoutine(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routines'] });
      onBack();
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  if (!r) return <Empty note="ルーティンが見つかりません。" />;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="戻る"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <h1 className="truncate font-display text-lg font-bold tracking-tight">{r.name}</h1>
        <button
          type="button"
          aria-label="画像で共有"
          onClick={() => setShare(true)}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-faint active:bg-line/60"
        >
          <Share2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label="ルーティンを削除"
          onClick={() => setConfirmDelete(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-faint active:bg-line/60 hover:text-accent"
        >
          <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </div>

      {r.goal && <p className="-mt-2 px-1 text-sm text-muted">{r.goal}</p>}

      {/* サイクル概観 */}
      <Card title="サイクル概観">
        <ul className="space-y-1.5">
          {r.days.map((d) => (
            <li key={d.id} className="flex items-baseline gap-2 text-sm">
              <span className="w-12 shrink-0 text-[11px] font-semibold text-faint">
                {d.label ?? `Day ${d.position}`}
              </span>
              <span className={`font-semibold ${d.is_rest ? 'text-faint' : 'text-ink'}`}>
                {d.title || 'レスト'}
              </span>
              {d.main_lift && (
                <span className="ml-auto text-[11px] text-accent-ink">{d.main_lift}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* 各日 */}
      {r.days.map((d) => (
        <DayCard key={d.id} day={d} />
      ))}

      {/* 運用ルール(プレーンテキスト整形) */}
      {r.notes && (
        <Card title="運用ルール">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{r.notes}</p>
        </Card>
      )}

      {share && <RoutineReport routine={r} onClose={() => setShare(false)} />}
      {confirmDelete && (
        <DeleteConfirmModal
          kind="routine"
          targetLabel={r.name}
          isPending={del.isPending}
          onConfirm={() => del.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ============ 画像エクスポート ============
function RoutineReport({ routine, onClose }: { routine: RoutineDetail; onClose: () => void }) {
  const combined = combineMuscles(routine.days);
  const trainingDays = routine.days.filter((d) => !d.is_rest).length;
  return (
    <ShareImageModal
      heading="ルーティン"
      filename={`logbook-routine-${routine.id}.png`}
      onClose={onClose}
    >
      <div className="mt-4">
        <div className="font-display text-[24px] font-extrabold leading-tight tracking-tight">
          {routine.name}
        </div>
        {routine.goal && <div className="mt-1 text-[12px] text-muted">{routine.goal}</div>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
        <ReportStat label="サイクル" value={String(routine.days.length)} unit="日" />
        <ReportStat label="トレ日" value={String(trainingDays)} unit="日" />
        <ReportStat label="部位" value={String(combined.filter((m) => m.sets > 0).length)} />
      </div>

      <div className="mt-4">
        <BodyFigure muscles={combined} />
        <MuscleChips muscles={combined} limit={8} />
      </div>

      <div className="mt-5 space-y-3">
        {routine.days.map((d) => (
          <div key={d.id}>
            <div className="flex items-baseline gap-1.5 text-[13px] font-bold text-ink">
              <span className="text-faint">{d.label ?? `Day ${d.position}`}</span>
              <span>{d.title || 'レスト'}</span>
            </div>
            {!d.is_rest && (
              <ul className="mt-0.5 space-y-0.5">
                {d.exercises.map((e) => {
                  const sets = rangeLabel(e.sets_min, e.sets_max);
                  const reps = rangeLabel(e.reps_min, e.reps_max);
                  return (
                    <li key={e.id} className="flex items-baseline gap-2 text-[11px]">
                      <span className="font-semibold text-muted">
                        {e.exercise_name ?? e.exercise_id}
                      </span>
                      <span className="tnum ml-auto text-faint">
                        {sets && `${sets}×`}
                        {reps ?? ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </ShareImageModal>
  );
}
