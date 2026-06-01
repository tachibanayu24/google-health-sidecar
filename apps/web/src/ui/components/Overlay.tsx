import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 全画面オーバーレイの共通土台。すべてのモーダル/シートはこれを使う(複製禁止)。
 * - document.body へ portal: 画面は .rise(transform アニメ)配下にあり、transform は
 *   position:fixed の containing-block を作る → portal しないと全画面を覆えず中央にも来ない。
 * - 背景タップで onClose(任意)。中身は子に委ねる。
 */
function Backdrop({
  align,
  onClose,
  children,
}: {
  align: 'center' | 'bottom';
  onClose?: () => void;
  children: ReactNode;
}) {
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center ${
        align === 'bottom' ? 'items-end' : 'items-center px-8'
      }`}
    >
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />
      {children}
    </div>,
    document.body,
  );
}

/** 中央モーダル(確認ダイアログ等)。 */
export function Modal({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  return (
    <Backdrop align="center" onClose={onClose}>
      <div className="rise relative w-full max-w-xs rounded-2xl bg-card p-5 shadow-[0_20px_50px_-12px] shadow-ink/40">
        {children}
      </div>
    </Backdrop>
  );
}

/** ボトムシート(入力フォーム等)。上部にドラッグハンドル。 */
export function Sheet({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  return (
    <Backdrop align="bottom" onClose={onClose}>
      <div className="rise relative w-full max-w-md rounded-t-3xl bg-card px-5 pb-8 pt-5 shadow-[0_-12px_40px_-12px] shadow-ink/30">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" />
        {children}
      </div>
    </Backdrop>
  );
}
