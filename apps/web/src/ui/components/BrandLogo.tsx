/**
 * ブランドのボックスロゴ。SUPREME 風のステッカー = バーミリオン単色の角箱(角丸なし)に
 * Futura(無ければ Jost)の大文字・斜体ワードマーク。ダンベルアイコンは廃止。
 */
export function BrandLogo({
  size = 'sm',
  className = '',
}: {
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'px-3 py-1' : 'px-2 py-[3px]';
  const type = size === 'lg' ? 'text-[22px]' : 'text-[15px]';
  return (
    <span className={`inline-flex items-center bg-accent ring-1 ring-black/5 ${box} ${className}`}>
      <span className={`logo-wordmark text-card ${type}`}>LOGBOOK</span>
    </span>
  );
}
