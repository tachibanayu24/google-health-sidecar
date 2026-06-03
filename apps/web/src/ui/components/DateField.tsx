import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * 日付ラベルをタップ → 専用ポップオーバー・カレンダーで日付選択(ネイティブ input は使わない)。
 * children=現在日付の表示(トリガ)。±1日は呼び出し側の前日/翌日ボタンが担当(週送りは持たない)。
 * max(=今日)より未来は選べない。外側クリック / Esc で閉じる。
 */
export function DateField({
  date,
  onPick,
  max,
  className,
  children,
}: {
  date: string;
  onPick: (date: string) => void;
  max?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => ym(date));
  const ref = useRef<HTMLDivElement>(null);

  // 開くたびに選択日の月を表示。
  useEffect(() => {
    if (open) setMonth(ym(date));
  }, [open, date]);

  // 外側クリック / Esc で閉じる。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (d: string) => {
    onPick(d);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label="日付を選択"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex [-webkit-tap-highlight-color:transparent] ${className ?? ''}`}
      >
        {children}
      </button>
      {open && (
        <CalendarPanel month={month} setMonth={setMonth} selected={date} max={max} onPick={pick} />
      )}
    </div>
  );
}

type Month = { year: number; month: number }; // month: 1-12
const pad = (n: number) => String(n).padStart(2, '0');
const ym = (date: string): Month => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
});
const dayStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function CalendarPanel({
  month,
  setMonth,
  selected,
  max,
  onPick,
}: {
  month: Month;
  setMonth: React.Dispatch<React.SetStateAction<Month>>;
  selected: string;
  max?: string;
  onPick: (date: string) => void;
}) {
  const { year, month: m } = month;
  const firstDow = new Date(year, m - 1, 1).getDay();
  const daysInMonth = new Date(year, m, 0).getDate();
  const shift = (delta: number) =>
    setMonth((p) => {
      const n = p.month + delta;
      return n < 1
        ? { year: p.year - 1, month: 12 }
        : n > 12
          ? { year: p.year + 1, month: 1 }
          : { ...p, month: n };
    });

  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-line bg-card p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="前の月"
          onClick={() => shift(-1)}
          className="rounded-md p-1 text-muted hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
        </button>
        <span className="font-display text-sm font-bold tracking-tight">
          {year}年{m}月
        </span>
        <button
          type="button"
          aria-label="次の月"
          onClick={() => shift(1)}
          className="rounded-md p-1 text-muted hover:text-ink"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-faint">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDow }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 月初の空セル(静的)
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = i + 1;
          const ds = dayStr(year, m, d);
          const isSelected = ds === selected;
          const isToday = ds === max;
          const isFuture = max != null && ds > max;
          return (
            <button
              key={ds}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(ds)}
              className={`flex h-8 items-center justify-center rounded-lg text-xs transition-colors ${
                isSelected
                  ? 'bg-accent font-bold text-card'
                  : isToday
                    ? 'font-semibold text-ink ring-1 ring-accent'
                    : isFuture
                      ? 'text-faint'
                      : 'text-ink hover:bg-paper'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
      {max != null && selected !== max && (
        <button
          type="button"
          onClick={() => onPick(max)}
          className="mt-2 w-full rounded-lg py-1.5 text-center text-[11px] font-semibold text-accent hover:bg-accent-soft"
        >
          今日へ
        </button>
      )}
    </div>
  );
}
