import type { ReactNode } from 'react';

/**
 * 日付ラベルにネイティブ日付ピッカーを重ねる(長距離移動を1タップで)。
 * children に現在日付の表示、透明な input[type=date] を全面に重ねてタップで OS ピッカーを開く。
 * max=未来日を抑止。±1日は呼び出し側の前日/翌日ボタンが担当(週送りは持たない)。
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
  return (
    <label className={`relative inline-flex cursor-pointer ${className ?? ''}`}>
      {children}
      <input
        type="date"
        value={date}
        max={max}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
        aria-label="日付を選択"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [-webkit-tap-highlight-color:transparent]"
      />
    </label>
  );
}
