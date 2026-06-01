/** 画面共通のローディング/エラー表示(各 screen から参照、循環依存を避けるため独立モジュール)。 */
export function Loading() {
  return <div className="py-24 text-center text-sm text-faint">読み込み中…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm text-accent-ink">
      エラー: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Empty({ note }: { note: string }) {
  return <p className="py-3 text-center text-sm text-faint">{note}</p>;
}
