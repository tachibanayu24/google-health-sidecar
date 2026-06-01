import { Modal } from './Overlay';

/**
 * 削除確認モーダル(食事/ワークアウト共通)。共通 Modal(body へ portal)を使う。
 * キャンセル/背景は常に閉じられる。確定のみ pending 中 disabled(二重実行防止)。
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
  return (
    <Modal onClose={onCancel}>
      <div className="text-center">
        <h2 className="font-display text-base font-bold">{targetLabel} を削除しますか?</h2>
        <p className="mt-1.5 text-sm text-muted">
          {kind === 'workout'
            ? 'セットや自己ベストの記録も削除され、復元できません。'
            : 'この操作は取り消せません。'}
        </p>
        <div className="mt-4 flex gap-2">
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
    </Modal>
  );
}
