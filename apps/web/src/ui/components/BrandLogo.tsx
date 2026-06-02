/**
 * ブランドのボックスロゴ。SUPREME 風のステッカー = 角箱 + Futura(無ければ Jost)の斜体ワードマーク。
 * variant='box'(バーミリオン箱+クリーム字, 明るい背景用) / 'light'(クリーム箱+バーミリオン字, 濃い背景用)。
 */
export function BrandLogo({
  size = 'sm',
  variant = 'box',
  className = '',
}: {
  size?: 'sm' | 'lg';
  variant?: 'box' | 'light';
  className?: string;
}) {
  const box = size === 'lg' ? 'px-3 py-1' : 'px-2 py-[3px]';
  const type = size === 'lg' ? 'text-[22px]' : 'text-[15px]';
  const skin = variant === 'light' ? 'bg-card text-accent' : 'bg-accent text-card';
  return (
    <span className={`inline-flex items-center ring-1 ring-black/5 ${skin} ${box} ${className}`}>
      <span className={`logo-wordmark ${type}`}>Logbook</span>
    </span>
  );
}
