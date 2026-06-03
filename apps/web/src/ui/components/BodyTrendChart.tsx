import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDateForDisplay } from '../lib/datetime';
import { axisTick, CHART, ChartFrame } from './chart';

export interface BodyTrendPoint {
  date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
}

/**
 * 体重(左軸)+ 体脂肪(右軸)のデュアル軸トレンド。スケールが違うので軸を分ける。
 * Home から lazy 読み込み(recharts を初期=eager バンドルに入れない。Training/Recovery と同じ非同期チャンク)。
 */
export function BodyTrendChart({ data }: { data: BodyTrendPoint[] }) {
  return (
    <ChartFrame h="h-36">
      <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={CHART.line} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateForDisplay}
          tick={axisTick}
          stroke={CHART.line}
          minTickGap={32}
        />
        {/* 軸ラベルは出さず(トレンドが分かれば十分)、スケール分離のためだけに hide で軸を保持。 */}
        <YAxis yAxisId="w" hide domain={['dataMin - 0.5', 'dataMax + 0.5']} />
        <YAxis yAxisId="f" orientation="right" hide domain={['dataMin - 0.5', 'dataMax + 0.5']} />
        <Tooltip content={<BodyTT />} />
        <Line
          yAxisId="w"
          type="monotone"
          dataKey="weight_kg"
          stroke={CHART.ink}
          strokeWidth={2.4}
          dot={false}
          connectNulls
          name="体重"
          unit="kg"
        />
        <Line
          yAxisId="f"
          type="monotone"
          dataKey="body_fat_pct"
          stroke={CHART.fat}
          strokeWidth={2.4}
          dot={false}
          connectNulls
          name="体脂肪"
          unit="%"
        />
      </LineChart>
    </ChartFrame>
  );
}

function BodyTT({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; color?: string; unit?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-faint">{label ? formatDateForDisplay(label) : ''}</div>
      {payload.map((p) => (
        <div key={p.name} className="tnum font-bold" style={{ color: p.color }}>
          {p.name} {Math.round(p.value * 10) / 10}
          {p.unit}
        </div>
      ))}
    </div>
  );
}
