import { toPng } from 'html-to-image';
import { Download, Loader2, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandLogo } from './BrandLogo';

/**
 * シェア画像の共通台紙(ワークアウト/食事で共有)。
 * ウォームクリームのカードを html-to-image で PNG 化し、画像ダウンロードで保存する。
 * ヘッダはブランドのボックスロゴ + headerRight(日付など)。本文は children に差す。
 */
export function ShareImageModal({
  heading,
  filename,
  headerRight,
  onClose,
  disabled = false,
  children,
}: {
  heading: string;
  filename: string;
  headerRight?: ReactNode;
  onClose: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function downloadImage() {
    const node = cardRef.current;
    if (!node) return;
    setBusy(true);
    setErr(false);
    try {
      // 埋め込みフォントが確実に乗るまで待つ(画質のため)。
      if (document.fonts?.ready) await document.fonts.ready;
      const dataUrl = await toPng(node, {
        pixelRatio: 3,
        cacheBust: true,
        backgroundColor: '#f4f1ea',
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/55 backdrop-blur-[2px]"
      />
      <div className="relative mx-auto flex h-full w-full max-w-md flex-col px-4 pb-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-sm font-bold text-card">{heading}</span>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-card/15 text-card active:bg-card/25"
          >
            <X className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl">
          {/* ===== ここからキャプチャ対象(シェア画像) ===== */}
          <div
            ref={cardRef}
            className="rise relative overflow-hidden rounded-3xl px-6 pb-7 pt-6 text-ink shadow-[0_24px_60px_-16px] shadow-ink/50"
            style={{
              background: 'linear-gradient(162deg, #fffdf8 0%, #f6ece2 52%, #f1dbce 100%)',
            }}
          >
            {/* 右下のバーミリオン・グロー(さりげない奥行き) */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(120% 90% at 88% 102%, rgba(223,74,38,0.16) 0%, rgba(223,74,38,0) 60%)',
              }}
            />
            <div className="relative">
              {/* ヘッダ: ロゴ + headerRight(日付等) */}
              <div className="flex items-center justify-between">
                <BrandLogo size="sm" />
                {headerRight}
              </div>
              {children}
            </div>
          </div>
          {/* ===== キャプチャ対象ここまで ===== */}
        </div>

        {/* アクション */}
        <div className="mt-3 shrink-0">
          {err && (
            <p className="mb-2 text-center text-[12px] font-semibold text-card/90">
              画像の生成に失敗しました。もう一度お試しください。
            </p>
          )}
          <button
            type="button"
            onClick={downloadImage}
            disabled={busy || disabled}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-bold text-card shadow-lg shadow-accent/40 transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
            ) : (
              <Download className="h-5 w-5" strokeWidth={2.4} />
            )}
            {busy ? '生成中…' : '画像を保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** レポート内の中央寄せスタッツ(大きな tabular 数字 + 単位 + ラベル)。 */
export function ReportStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-0.5 flex items-baseline justify-center gap-0.5">
        <span className="stat text-xl leading-none">{value}</span>
        {unit && <span className="text-[11px] font-semibold text-muted">{unit}</span>}
      </div>
    </div>
  );
}
