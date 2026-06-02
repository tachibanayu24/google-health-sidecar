import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { invalidateBody } from '../lib/invalidate';
import { Sheet } from './Overlay';

/** 体重(+任意で体脂肪)の記録 Sheet。中央+ボタンから開く。GH へ best-effort push(§5.2)。 */
export function WeightLogSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [w, setW] = useState<number | null>(null);
  const [bf, setBf] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.logWeight({ entryValue: w, entryUnit: 'kg', bodyFatPct: bf ?? undefined }),
    onSuccess: () => {
      invalidateBody(qc);
      onClose();
    },
  });
  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 font-display text-base font-bold">体重を記録</div>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-[11px] font-semibold text-faint">体重 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            // biome-ignore lint/a11y/noAutofocus: シート展開直後の主入力にフォーカスは妥当
            autoFocus
            value={w ?? ''}
            onChange={(e) => setW(e.target.value === '' ? null : Number(e.target.value))}
            className="tnum w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold outline-none focus:border-accent focus:bg-card"
          />
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-[11px] font-semibold text-faint">体脂肪 (%) 任意</span>
          <input
            type="number"
            inputMode="decimal"
            value={bf ?? ''}
            onChange={(e) => setBf(e.target.value === '' ? null : Number(e.target.value))}
            className="tnum w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold outline-none focus:border-accent focus:bg-card"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={w == null || save.isPending}
        onClick={() => save.mutate()}
        className="mt-4 w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-card disabled:opacity-40"
      >
        {save.isPending ? '保存中…' : '保存'}
      </button>
    </Sheet>
  );
}
