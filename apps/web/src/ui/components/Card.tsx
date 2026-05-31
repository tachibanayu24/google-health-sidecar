import type { ReactNode } from 'react';

export function Card({
  title,
  children,
  accent,
}: {
  title?: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border p-4 ${
        accent ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      {title && <h2 className="mb-2 text-xs font-medium text-gray-400">{title}</h2>}
      {children}
    </section>
  );
}
