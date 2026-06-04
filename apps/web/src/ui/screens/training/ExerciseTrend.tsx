import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/Card';
import { axisTick, CHART, ChartFrame, TT } from '../../components/chart';
import { Empty } from '../../components/state';
import { api, type Exercise } from '../../lib/api';
import { formatDateForDisplay } from '../../lib/datetime';

// ============ 種目別 e1RM 推移 ============
export function ExerciseTrend() {
  const [q, setQ] = useState('');
  const [ex, setEx] = useState<Exercise | null>(null);
  const found = useQuery({
    queryKey: ['ex-search', q],
    queryFn: () => api.searchExercises(q),
    enabled: q.trim().length > 0 && !ex,
  });
  const hist = useQuery({
    queryKey: ['ex-hist', ex?.id],
    queryFn: () => api.exerciseHistory(ex!.id, { limit: 200 }),
    enabled: !!ex,
  });
  const series = (() => {
    const m = new Map<string, number>();
    for (const s of hist.data?.sets ?? []) {
      if (s.e1rm_kg == null) continue;
      m.set(s.session_date, Math.max(m.get(s.session_date) ?? 0, s.e1rm_kg));
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e1rm]) => ({ date, e1rm: Math.round(e1rm * 10) / 10 }));
  })();
  return (
    <Card title="種目別 e1RM 推移">
      {ex ? (
        <button
          type="button"
          onClick={() => {
            setEx(null);
            setQ('');
          }}
          className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-accent"
        >
          {ex.name_ja} <span className="text-xs text-faint">× 変更</span>
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="種目を検索(例: デッドリフト)"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
      )}
      {!ex && q.trim() && (
        <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
          {found.data?.exercises.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setEx(e)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"
              >
                {e.name_ja}
              </button>
            </li>
          ))}
        </ul>
      )}
      {ex &&
        (series.length >= 2 ? (
          <ChartFrame>
            <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={CHART.line} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateForDisplay}
                tick={axisTick}
                stroke={CHART.line}
                minTickGap={28}
              />
              <YAxis
                tick={axisTick}
                stroke={CHART.line}
                width={40}
                domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]}
              />
              <Tooltip content={<TT unit="kg" />} />
              <Line
                type="monotone"
                dataKey="e1rm"
                stroke={CHART.accent}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="2セッション以上記録すると推移が出ます。" />
        ))}
    </Card>
  );
}
