import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Gauge, Ruler, Target } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { ErrorBox, Loading } from '../components/state';
import { api } from '../lib/api';

type Phase = 'bulk' | 'cut' | 'maintain';

export function SettingsScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { settings, nutritionTarget } = q.data!;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <UnitsCard
        unit={settings.unit_preference}
        formula={settings.e1rm_formula}
        onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })}
      />
      <TargetsCard
        target={nutritionTarget}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['settings'] });
          qc.invalidateQueries({ queryKey: ['today'] });
        }}
      />
      <Card title="連携" right={<Gauge className="h-4 w-4 text-faint" strokeWidth={2.2} />}>
        <p className="text-sm text-muted">
          Google Health 連携(体重・睡眠の取り込み / ワークアウト・食事の書き出し)は接続済み。
          5分毎に同期します。
        </p>
      </Card>
    </div>
  );
}

// ============ 単位・計算(タップで即保存) ============
function UnitsCard({
  unit,
  formula,
  onSaved,
}: {
  unit: 'kg' | 'lb';
  formula: 'epley' | 'brzycki';
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const m = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    },
  });
  const save = (next: { unitPreference?: 'kg' | 'lb'; e1rmFormula?: 'epley' | 'brzycki' }) =>
    m.mutate({
      unitPreference: next.unitPreference ?? unit,
      e1rmFormula: next.e1rmFormula ?? formula,
    });

  return (
    <Card
      title="単位・計算"
      right={
        saved ? (
          <Check className="h-4 w-4 text-accent" strokeWidth={3} />
        ) : (
          <Ruler className="h-4 w-4 text-faint" strokeWidth={2.2} />
        )
      }
    >
      <Field label="主単位">
        <Segmented
          options={[
            { value: 'kg', label: 'KG' },
            { value: 'lb', label: 'LB' },
          ]}
          value={unit}
          onChange={(v) => save({ unitPreference: v as 'kg' | 'lb' })}
        />
      </Field>
      <Field label="1RM 推定式">
        <Segmented
          options={[
            { value: 'epley', label: 'Epley' },
            { value: 'brzycki', label: 'Brzycki' },
          ]}
          value={formula}
          onChange={(v) => save({ e1rmFormula: v as 'epley' | 'brzycki' })}
        />
      </Field>
    </Card>
  );
}

// ============ 栄養目標(フォーム + 保存) ============
const PHASES: Array<{ value: Phase; label: string }> = [
  { value: 'cut', label: '減量' },
  { value: 'maintain', label: '維持' },
  { value: 'bulk', label: '増量' },
];

function TargetsCard({
  target,
  onSaved,
}: {
  target: {
    phase: string;
    target_kcal: number;
    target_protein_g: number;
    target_fat_g: number;
    target_carbs_g: number;
    target_salt_g: number;
    target_fiber_g: number;
  } | null;
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>((target?.phase as Phase) ?? 'maintain');
  const [kcal, setKcal] = useState(String(Math.round(target?.target_kcal ?? 2000)));
  const [p, setP] = useState(String(Math.round(target?.target_protein_g ?? 150)));
  const [f, setF] = useState(String(Math.round(target?.target_fat_g ?? 60)));
  const [c, setC] = useState(String(Math.round(target?.target_carbs_g ?? 200)));
  const [salt, setSalt] = useState(String(target?.target_salt_g ?? 6));
  const [fiber, setFiber] = useState(String(target?.target_fiber_g ?? 20));
  const [saved, setSaved] = useState(false);

  // 別ソースで target が更新されたら同期。
  useEffect(() => {
    if (!target) return;
    setPhase((target.phase as Phase) ?? 'maintain');
    setKcal(String(Math.round(target.target_kcal)));
    setP(String(Math.round(target.target_protein_g)));
    setF(String(Math.round(target.target_fat_g)));
    setC(String(Math.round(target.target_carbs_g)));
    setSalt(String(target.target_salt_g));
    setFiber(String(target.target_fiber_g));
  }, [target]);

  const m = useMutation({
    mutationFn: api.setNutritionTarget,
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    },
  });

  // PFC から kcal 概算(P/C=4, F=9)。手動 kcal とのズレ確認の補助。
  const pfcKcal = (Number(p) || 0) * 4 + (Number(c) || 0) * 4 + (Number(f) || 0) * 9;

  const onSave = () =>
    m.mutate({
      phase,
      kcal: Number(kcal) || 0,
      proteinG: Number(p) || 0,
      fatG: Number(f) || 0,
      carbsG: Number(c) || 0,
      saltG: Number(salt) || 6,
      fiberG: Number(fiber) || 20,
    });

  return (
    <Card
      title="栄養目標"
      right={
        saved ? (
          <Check className="h-4 w-4 text-accent" strokeWidth={3} />
        ) : (
          <Target className="h-4 w-4 text-faint" strokeWidth={2.2} />
        )
      }
    >
      <Field label="フェーズ">
        <Segmented options={PHASES} value={phase} onChange={(v) => setPhase(v as Phase)} />
      </Field>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <NumField label="カロリー" unit="kcal" value={kcal} onChange={setKcal} />
        <NumField label="食塩相当量" unit="g" value={salt} onChange={setSalt} step="0.1" />
        <NumField label="タンパク質" unit="g" value={p} onChange={setP} />
        <NumField label="脂質" unit="g" value={f} onChange={setF} />
        <NumField label="炭水化物" unit="g" value={c} onChange={setC} />
        <NumField label="食物繊維" unit="g" value={fiber} onChange={setFiber} />
        <div className="flex flex-col justify-end pb-1">
          <span className="text-[11px] text-faint">PFC概算</span>
          <span className="tnum text-sm font-semibold text-muted">{Math.round(pfcKcal)} kcal</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={m.isPending}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3 font-display text-base font-bold text-card shadow-[0_8px_24px_-8px] shadow-accent/60 transition active:scale-[0.99] disabled:opacity-40"
      >
        {m.isPending ? '保存中…' : saved ? '保存しました' : '目標を保存'}
      </button>
      {m.error && <p className="mt-2 text-xs text-accent-ink">{String(m.error)}</p>}
    </Card>
  );
}

// ============ 小物 ============
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-bold transition ${
            value === o.value ? 'bg-ink text-card' : 'text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
  step,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-faint">
        {label} <span className="text-faint/70">({unit})</span>
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? '1'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-sm font-semibold tnum outline-none focus:border-accent focus:bg-card"
      />
    </label>
  );
}
