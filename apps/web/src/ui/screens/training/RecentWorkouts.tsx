import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../../components/Card';
import { Empty } from '../../components/state';
import { api } from '../../lib/api';
import { formatDateForDisplay } from '../../lib/datetime';

/**
 * 最近のワークアウト = 食事ログと同じメンタルモデルの「常時サマリのフラット一覧」。
 * Accordion はやめ、各行は要約のみ表示し、タップで詳細(/workout/:id)へ。最新10件 + もっと見る。
 * 共有/編集/削除・人体ヒートマップ等の詳細データは詳細画面側に置く。
 */
export function RecentWorkouts({ onOpen }: { onOpen: (id: string) => void }) {
  const [limit, setLimit] = useState(10);
  const q = useQuery({
    queryKey: ['recent-workouts', limit],
    queryFn: () => api.recentWorkouts(limit),
  });
  const sessions = q.data?.sessions ?? [];
  return (
    <div className="space-y-2">
      <h2 className="px-1 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
        最近のワークアウト
      </h2>
      {sessions.length === 0 ? (
        <Card>
          <Empty note="ワークアウトを記録するとここに一覧が出ます。" />
        </Card>
      ) : (
        <>
          <Card>
            <div className="divide-y divide-line/60">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left first:pt-1 last:pb-1 [-webkit-tap-highlight-color:transparent]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold tracking-tight">
                      {s.title || 'ワークアウト'}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-faint">
                      {formatDateForDisplay(s.date)} · {s.exercises}種目 {s.sets}set ·{' '}
                      {Math.round(s.total_volume_kg).toLocaleString()}kg
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.4} />
                </button>
              ))}
            </div>
          </Card>
          {sessions.length >= limit && limit < 60 && (
            <button
              type="button"
              onClick={() => setLimit((l) => Math.min(60, l + 20))}
              className="w-full rounded-2xl border border-line py-2.5 text-sm font-semibold text-muted active:bg-line/40"
            >
              もっと見る
            </button>
          )}
        </>
      )}
    </div>
  );
}
