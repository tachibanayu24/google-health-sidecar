import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../components/Card';
import { api } from '../lib/api';
import { ErrorBox, Loading } from './Home';

const INK = '#19160f';
const ACCENT = '#df4a26';
const CARB = '#1d6f6f';
const LINE = '#e6e1d5';
const FAINT = '#a8a294';

const mmdd = (d: string) => d.slice(5).replace('-', '/');

export function HistoryScreen() {
  const q = useQuery({ queryKey: ['trends', 90], queryFn: () => api.trends(90) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const t = q.data!;
  const hasWeight = t.body.some((b) => b.weight_kg != null);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card title="体重トレンド" right={<span className="text-[11px] text-faint">90日</span>}>
        {hasWeight ? (
          <ChartFrame>
            <LineChart data={t.body} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis
                tick={axisTick}
                stroke={LINE}
                domain={['dataMin - 1', 'dataMax + 1']}
                width={40}
              />
              <Tooltip content={<TT unit="kg" />} />
              <Line
                type="monotone"
                dataKey="weight_kg"
                stroke={INK}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="体重は Google Health 同期で表示(トークン接続後)。" />
        )}
      </Card>

      <Card title="週間ボリューム(日次)" right={<span className="text-[11px] text-faint">kg</span>}>
        {t.volumeDaily.length ? (
          <ChartFrame>
            <BarChart data={t.volumeDaily} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis tick={axisTick} stroke={LINE} width={48} />
              <Tooltip content={<TT unit="kg" />} cursor={{ fill: 'rgba(223,74,38,0.08)' }} />
              <Bar dataKey="volume_kg" fill={ACCENT} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        ) : (
          <Empty note="ワークアウトを記録するとここに推移が出ます。" />
        )}
      </Card>

      <Card title="カロリー(日次)" right={<span className="text-[11px] text-faint">kcal</span>}>
        {t.pfcDaily.length ? (
          <ChartFrame>
            <LineChart data={t.pfcDaily} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={mmdd}
                tick={axisTick}
                stroke={LINE}
                minTickGap={28}
              />
              <YAxis tick={axisTick} stroke={LINE} width={48} />
              <Tooltip content={<TT unit="kcal" />} />
              <Line type="monotone" dataKey="kcal" stroke={CARB} strokeWidth={2} dot={false} />
            </LineChart>
          </ChartFrame>
        ) : (
          <Empty note="食事を記録するとここに推移が出ます。" />
        )}
      </Card>
    </div>
  );
}

const axisTick = { fill: FAINT, fontSize: 10 };

function ChartFrame({ children }: { children: React.ReactElement }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ note }: { note: string }) {
  return <p className="py-8 text-center text-sm text-faint">{note}</p>;
}

function TT({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-faint">{label}</div>
      <div className="tnum font-bold">
        {Math.round(payload[0]!.value)} {unit}
      </div>
    </div>
  );
}
