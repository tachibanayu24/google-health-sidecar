import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';

/** recharts 共通ヘルパ(トレーニング/からだ画面で共有)。色は @theme トークンに対応。 */
export const CHART = {
  ink: '#19160f',
  accent: '#df4a26',
  carb: '#1d6f6f',
  fat: '#b7791f',
  line: '#e6e1d5',
  faint: '#a8a294',
};

export const axisTick = { fill: CHART.faint, fontSize: 10 };

export const mmdd = (d: string) => d.slice(5).replace('-', '/');

export function ChartFrame({ children, h = 'h-44' }: { children: ReactElement; h?: string }) {
  return (
    <div className={`${h} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** 単系列ツールチップ。 */
export function TT({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; color?: string }>;
  label?: string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-faint">{label}</div>
      {payload.map((p) => (
        <div key={p.name ?? unit} className="tnum font-bold" style={{ color: p.color }}>
          {Math.round(p.value * 10) / 10} {unit}
        </div>
      ))}
    </div>
  );
}
