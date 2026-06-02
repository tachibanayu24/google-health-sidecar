import { useQuery } from '@tanstack/react-query';
import { toPng } from 'html-to-image';
import { Download, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { createPortal } from 'react-dom';
import { api, type RecentSession } from '../lib/api';
import { formatDateLong } from '../lib/datetime';
import { MUSCLE_JA, MUSCLE_TO_SLUGS } from '../lib/muscles';
import { HEATMAP_RAMP } from '../lib/theme';
import { BrandLogo } from './BrandLogo';

// 人体図グラデーションは theme の単一ソース(Training の Heatmap と共有)。
const RAMP = HEATMAP_RAMP;
// シェア画像の人体ベース色。カード背景(ウォームクリーム)に埋もれないよう本体より濃いめ。
const BASE_BODY = '#c2b8a6';

function bucket(i: number): number {
  if (i <= 0.02) return 0;
  return Math.min(5, Math.max(1, Math.ceil(i * 5)));
}

/** 同一重量×単位の連続セットをまとめる(BW=自重)。warmup は除外。top=最大重量。 */
function workingSets(
  sets: Array<{
    setType: string;
    entryValue: number | null;
    entryUnit: string;
    reps: number | null;
  }>,
) {
  const main = sets.filter((s) => s.setType !== 'warmup');
  const top = main.reduce((m, s) => Math.max(m, s.entryValue ?? 0), 0);
  return { main, top };
}

/**
 * ワークアウトのシェアレポート(SNS 投稿品質の画像を出力)。
 * 人体図で効かせた部位を可視化 + 種目ごとの重量×レップを chip 表示。
 * カード DOM を html-to-image で PNG 化し、Web Share API(対応端末)or ダウンロードで保存。
 */
export function WorkoutReport({
  session,
  onClose,
}: {
  session: RecentSession;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const detail = useQuery({
    queryKey: ['workout', session.id],
    queryFn: () => api.getWorkout(session.id),
    staleTime: 5 * 60_000,
  });

  const muscles = detail.data?.muscles ?? [];
  const exercises = detail.data?.exercises ?? [];

  // 人体図データ: intensity を 5 段にバケットし slug 単位で最大値を採用。
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
    const b = bucket(m.intensity);
    for (const slug of MUSCLE_TO_SLUGS[m.muscle] ?? []) {
      if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
    }
  }
  const bodyData: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));
  // 「効かせた主働部位」: primary セットがある部位を多い順に。
  const primary = muscles.filter((m) => m.sets > 0).slice(0, 6);

  async function downloadImage() {
    const node = cardRef.current;
    if (!node) return;
    setBusy(true);
    setErr(false);
    try {
      // 埋め込みフォントが確実に乗るまで待つ(画質のため)。
      if (document.fonts?.ready) await document.fonts.ready;
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: true,
        backgroundColor: '#f4f1ea',
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `logbook-${session.date}.png`;
      a.click();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/55 backdrop-blur-[2px]"
      />
      <div className="relative mx-auto flex h-full w-full max-w-md flex-col px-4 pb-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-sm font-bold text-card">シェア用レポート</span>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-card/15 text-card active:bg-card/25"
          >
            <X className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl">
          {/* ===== ここからキャプチャ対象(シェア画像) ===== */}
          <div
            ref={cardRef}
            className="rise relative overflow-hidden rounded-3xl px-6 pb-7 pt-6 text-ink shadow-[0_24px_60px_-16px] shadow-ink/50"
            style={{
              background: 'linear-gradient(162deg, #fffdf8 0%, #f6ece2 52%, #f1dbce 100%)',
            }}
          >
            {/* 右下のバーミリオン・グロー(さりげない奥行き) */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(120% 90% at 88% 102%, rgba(223,74,38,0.16) 0%, rgba(223,74,38,0) 60%)',
              }}
            />
            <div className="relative">
              {/* ヘッダ: ロゴ + 日付 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrandLogo size="sm" />
                </div>
                <span className="tnum whitespace-nowrap text-[12px] font-semibold text-muted">
                  {formatDateLong(session.date)}
                </span>
              </div>

              {/* タイトル */}
              <div className="mt-4">
                <div className="font-display text-[26px] font-extrabold leading-tight tracking-tight">
                  {session.title || 'ワークアウト'}
                </div>
              </div>

              {/* スタッツ */}
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-line/70 bg-card/70 px-3 py-3">
                <Stat
                  label="総ボリューム"
                  value={Math.round(session.total_volume_kg).toLocaleString()}
                  unit="kg"
                />
                <Stat label="セット" value={String(session.sets)} unit="set" />
                <Stat label="種目" value={String(session.exercises)} unit="" />
              </div>

              {/* 人体図 + 効かせた部位 */}
              {detail.isLoading ? (
                <div className="mt-4 h-44 animate-pulse rounded-2xl bg-line/40" />
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-1 [&_svg]:h-auto [&_svg]:max-h-[30vh] [&_svg]:w-full">
                    <Model
                      type="anterior"
                      data={bodyData}
                      highlightedColors={RAMP}
                      bodyColor={BASE_BODY}
                    />
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
                        const c = RAMP[bucket(m.intensity) - 1] ?? RAMP[4];
                        return (
                          <span
                            key={m.muscle}
                            className="inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1 text-[11px] font-bold ring-1 ring-line/70"
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
                            {MUSCLE_JA[m.muscle] ?? m.muscle}
                            <span className="tnum text-faint">{m.sets}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* 種目内訳(重量 × レップを chip 表示) */}
              {exercises.length > 0 && (
                <div className="mt-5 space-y-3">
                  {exercises.map((ex) => {
                    const { main, top } = workingSets(ex.sets);
                    if (main.length === 0) return null;
                    return (
                      <div key={ex.exerciseId}>
                        <div className="text-[13px] font-bold text-ink">{ex.name_en}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {main.map((s, i) => {
                            const isTop = s.entryValue != null && s.entryValue === top;
                            return (
                              <span
                                // biome-ignore lint/suspicious/noArrayIndexKey: 読み取り専用の静的リスト
                                key={i}
                                className={`tnum inline-flex items-baseline gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] leading-none ${
                                  isTop
                                    ? 'bg-accent-soft font-bold text-ink'
                                    : 'bg-card/80 font-semibold text-muted ring-1 ring-line/60'
                                }`}
                              >
                                <span>
                                  {s.entryValue ?? 'BW'}
                                  {s.entryUnit}
                                </span>
                                <span className="text-faint">×</span>
                                <span>{s.reps ?? '—'}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {/* ===== キャプチャ対象ここまで ===== */}
        </div>

        {/* アクション */}
        <div className="mt-3 shrink-0">
          {err && (
            <p className="mb-2 text-center text-[12px] font-semibold text-card/90">
              画像の生成に失敗しました。もう一度お試しください。
            </p>
          )}
          <button
            type="button"
            onClick={downloadImage}
            disabled={busy || detail.isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-bold text-card shadow-lg shadow-accent/40 transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
            ) : (
              <Download className="h-5 w-5" strokeWidth={2.4} />
            )}
            {busy ? '生成中…' : '画像を保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-0.5 flex items-baseline justify-center gap-0.5">
        <span className="stat text-xl leading-none">{value}</span>
        {unit && <span className="text-[11px] font-semibold text-muted">{unit}</span>}
      </div>
    </div>
  );
}
