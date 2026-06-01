import { createPortal } from 'react-dom';

/**
 * 削除確認モーダル(食事/ワークアウト共通)。App.tsx の DiscardGuard と同一スタイルの双子。
 * 各画面がローカル state で開閉を持ち、これを render する(グローバル Context 不要)。
 * ※ document.body へ portal する。画面は .rise(transform アニメ)配下にあり、transform は
 *   position:fixed の containing-block を作るため、portal しないとオーバーレイが画面全体を覆えない。
 */
export function DeleteConfirmModal({
  kind,
  targetLabel,
  isPending,
  onConfirm,
  onCancel,
}: {
  kind: 'meal' | 'workout';
  targetLabel: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-8">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onCancel}
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="rise relative w-full max-w-xs rounded-2xl bg-card p-5 text-center shadow-[0_20px_50px_-12px] shadow-ink/40">
        <h2 className="font-display text-base font-bold">{targetLabel} を削除しますか?</h2>
        <p className="mt-1.5 text-sm text-muted">
          {kind === 'workout'
            ? 'セットや自己ベストの記録も削除され、復元できません。'
            : 'この操作は取り消せません。'}
        </p>
        <div className="mt-4 flex gap-2">
          {/* キャンセルは常に押せる(処理が固まっても閉じられる)。閉じても進行中の削除は中断しない=無害。 */}
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold text-muted"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-card disabled:opacity-50"
          >
            削除する
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
