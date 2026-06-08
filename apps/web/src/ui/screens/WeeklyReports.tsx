import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/Card';
import { ReportStat, ShareImageModal } from '../components/ShareImageModal';
import { Empty, ErrorBox, Loading } from '../components/state';
import { api, type WeeklyReportDetail, type WeeklyReportSummary } from '../lib/api';
import { formatDateForDisplay, formatDateLong } from '../lib/datetime';

// スコア帯(0-100)→ ラベルと色。NULL=未採点はグレー「—」(偽スコアを出さない)。
const BANDS = [
  { min: 85, label: '優秀', color: '#2f9e6e' },
  { min: 70, label: '良好', color: '#4c9aa0' },
  { min: 50, label: '要改善', color: '#c98a2b' },
  { min: 0, label: '立て直し', color: '#e0521f' },
] as const;
function band(score: number | null): { label: string; color: string } {
  if (score == null) return { label: '—', color: '#9b9486' };
  return BANDS.find((b) => score >= b.min) ?? BANDS[3];
}

const DIMS = [
  { key: 'training', label: 'トレ' },
  { key: 'nutrition', label: '栄養' },
  { key: 'recovery', label: '回復' },
  { key: 'body', label: 'からだ' },
] as const;

const weekRange = (start: string, end: string) =>
  `${formatDateForDisplay(start)}–${formatDateForDisplay(end)}`;

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  const b = band(score);
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] font-semibold text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/70">
        <div
          className="h-full rounded-full"
          style={{ width: `${score ?? 0}%`, backgroundColor: b.color }}
        />
      </div>
      <span className="w-8 text-right text-xs tnum font-bold" style={{ color: b.color }}>
        {score ?? '—'}
      </span>
    </div>
  );
}

// ============ 一覧 ============
export function WeeklyReportsScreen({
  onOpen,
  onBack,
}: {
  onOpen: (weekStart: string) => void;
  onBack: () => void;
}) {
  const q = useQuery({ queryKey: ['weekly-reports'], queryFn: api.weeklyReports });
  return (
    <div className="mx-auto max-w-md space-y-3">
      <BackHeader title="週次レポート" onBack={onBack} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (q.data?.reports.length ?? 0) === 0 ? (
        <Empty note="まだレポートがありません。トレーナーAI に「先週どうだった?」と聞くと、ヒアリングのうえ作成されます。" />
      ) : (
        <ul className="space-y-2.5">
          {q.data?.reports.map((r) => (
            <li key={r.week_start}>
              <ReportCard r={r} onOpen={() => onOpen(r.week_start)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ r, onOpen }: { r: WeeklyReportSummary; onOpen: () => void }) {
  const b = band(r.overall_score);
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left">
      <Card>
        <div className="flex items-start gap-3">
          <div className="shrink-0 text-center">
            <div className="stat text-2xl leading-none" style={{ color: b.color }}>
              {r.overall_score ?? '—'}
            </div>
            <div className="mt-0.5 text-[10px] font-bold" style={{ color: b.color }}>
              {b.label}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted">
                {weekRange(r.week_start, r.week_end)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{r.headline}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] tnum text-faint">
              {DIMS.map((d) => {
                const s = r[`${d.key}_score`];
                return (
                  <span key={d.key}>
                    {d.label} <span style={{ color: band(s).color }}>{s ?? '—'}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </button>
  );
}

// ============ 詳細 ============
export function WeeklyReportDetailScreen({
  weekStart,
  onBack,
}: {
  weekStart: string;
  onBack: () => void;
}) {
  const q = useQuery({
    queryKey: ['weekly-report', weekStart],
    queryFn: () => api.weeklyReport(weekStart),
  });
  const [share, setShare] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? new Error('not found')} />;
  const r = q.data;
  const b = band(r.overall_score);
  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="戻る"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <span className="text-sm font-semibold">
          {weekRange(r.week_start, r.week_end)} の振り返り
        </span>
        <button
          type="button"
          aria-label="画像に"
          onClick={() => setShare(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-line/60"
        >
          <Share2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </div>

      <Card>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="stat text-4xl leading-none" style={{ color: b.color }}>
              {r.overall_score ?? '—'}
            </div>
            <div className="text-[11px] font-bold" style={{ color: b.color }}>
              総合 · {b.label}
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {DIMS.map((d) => (
              <ScoreBar key={d.key} label={d.label} score={r[`${d.key}_score`]} />
            ))}
          </div>
        </div>
      </Card>

      <Card title="総評">
        <p className="text-sm leading-relaxed">{r.headline}</p>
      </Card>

      {DIMS.map((d) => {
        const note = r[`${d.key}_note`];
        if (!note) return null;
        const s = r[`${d.key}_score`];
        return (
          <Card key={d.key} title={d.label} right={<ScoreChip score={s} />}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{note}</p>
          </Card>
        );
      })}

      {r.subjective_context && (
        <Card title="ヒアリング(本人の声)">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {r.subjective_context}
          </p>
        </Card>
      )}

      {r.focus_next_week && (
        <Card title="来週のフォーカス">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.focus_next_week}</p>
        </Card>
      )}

      {r.metrics && <SnapshotCard m={r.metrics} />}

      {share && <WeeklyReportImage report={r} onClose={() => setShare(false)} />}
    </div>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  const b = band(score);
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[11px] font-bold tnum"
      style={{ color: b.color, backgroundColor: `${b.color}1f` }}
    >
      {score ?? '—'}
    </span>
  );
}

function SnapshotCard({ m }: { m: NonNullable<WeeklyReportDetail['metrics']> }) {
  return (
    <Card title="この週の実測(snapshot)">
      <div className="grid grid-cols-3 gap-y-3">
        <ReportStat label="セッション" value={`${m.training.sessions}`} />
        <ReportStat label="総挙上" value={`${Math.round(m.training.volumeKg / 1000)}`} unit="t" />
        <ReportStat label="自己ベスト" value={`${m.training.prs}`} />
        <ReportStat
          label="平均kcal"
          value={m.nutrition.daysLogged ? `${m.nutrition.avgKcal}` : '—'}
        />
        <ReportStat
          label="平均睡眠"
          value={m.recovery.avgSleepMin != null ? (m.recovery.avgSleepMin / 60).toFixed(1) : '—'}
          unit={m.recovery.avgSleepMin != null ? 'h' : undefined}
        />
        <ReportStat
          label="体重Δ"
          value={m.body.deltaKg != null ? `${m.body.deltaKg > 0 ? '+' : ''}${m.body.deltaKg}` : '—'}
          unit={m.body.deltaKg != null ? 'kg' : undefined}
        />
      </div>
    </Card>
  );
}

// ============ 画像エクスポート(高密度・MECE。可読性のため paper トーン) ============
function WeeklyReportImage({
  report,
  onClose,
}: {
  report: WeeklyReportDetail;
  onClose: () => void;
}) {
  const r = report;
  const b = band(r.overall_score);
  return (
    <ShareImageModal
      heading="週次レポート"
      filename={`weekly-${r.week_start}.png`}
      tone="paper"
      headerRight={
        <span className="text-[11px] font-semibold text-muted">
          {formatDateLong(r.week_start)} 〜 {formatDateForDisplay(r.week_end)}
        </span>
      }
      onClose={onClose}
    >
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="stat text-[2.75rem] leading-none" style={{ color: b.color }}>
              {r.overall_score ?? '—'}
            </div>
            <div className="text-[11px] font-bold" style={{ color: b.color }}>
              総合 · {b.label}
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {DIMS.map((d) => (
              <ScoreBar key={d.key} label={d.label} score={r[`${d.key}_score`]} />
            ))}
          </div>
        </div>

        <p className="text-sm font-semibold leading-snug">{r.headline}</p>

        <div className="space-y-2 border-t border-line/60 pt-2.5">
          {DIMS.map((d) => {
            const note = r[`${d.key}_note`];
            if (!note) return null;
            return (
              <div key={d.key} className="flex gap-2">
                <span className="w-12 shrink-0 text-[11px] font-bold text-faint">{d.label}</span>
                <p className="line-clamp-3 flex-1 text-[12px] leading-snug">{note}</p>
              </div>
            );
          })}
        </div>

        {r.focus_next_week && (
          <div className="rounded-xl bg-accent-soft px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-accent">
              来週のフォーカス
            </div>
            <p className="mt-0.5 line-clamp-3 text-[12px] font-medium leading-snug text-accent-ink">
              {r.focus_next_week}
            </p>
          </div>
        )}

        {r.metrics && (
          <div className="grid grid-cols-3 gap-y-2.5 border-t border-line/60 pt-3">
            <ReportStat label="セッション" value={`${r.metrics.training.sessions}`} />
            <ReportStat
              label="総挙上"
              value={`${Math.round(r.metrics.training.volumeKg / 1000)}`}
              unit="t"
            />
            <ReportStat label="自己ベスト" value={`${r.metrics.training.prs}`} />
          </div>
        )}
      </div>
    </ShareImageModal>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
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
      <span className="text-base font-bold">{title}</span>
    </div>
  );
}
