import type { ReactNode } from 'react';

export function Card({
  title,
  right,
  children,
  accent,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border p-4 shadow-[0_1px_2px_rgba(25,22,15,0.04),0_8px_24px_-16px_rgba(25,22,15,0.18)] ${
        accent ? 'border-accent/30 bg-accent-soft' : 'border-line bg-card'
      }`}
    >
      {(title || right) && (
        <div className="mb-2.5 flex items-center justify-between">
          {title && (
            <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
              {title}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** 大きな tabular 数字 + 単位 + ラベルの統計表示。 */
export function Stat({
  value,
  unit,
  label,
  sub,
}: {
  value: ReactNode;
  unit?: string;
  label?: string;
  sub?: ReactNode;
}) {
  return (
    <div>
      {label && (
        <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
          {label}
        </div>
      )}
      <div className="flex items-baseline gap-1">
        <span className="stat text-3xl leading-none">{value}</span>
        {unit && <span className="text-sm font-semibold text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
