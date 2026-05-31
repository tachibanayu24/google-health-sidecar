import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api } from '../lib/api';
import { ErrorBox, Loading } from './Today';

export function SettingsScreen() {
  const q = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { settings, nutritionTarget } = q.data!;

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-lg font-bold">設定</h1>
      <Card title="単位・計算">
        <Row label="主単位" value={settings.unit_preference.toUpperCase()} />
        <Row label="1RM式" value={settings.e1rm_formula} />
        <Row label="ロケール" value={settings.locale} />
      </Card>
      {nutritionTarget && (
        <Card title="栄養目標">
          <Row label="フェーズ" value={nutritionTarget.phase} />
          <Row label="カロリー" value={`${Math.round(nutritionTarget.target_kcal)} kcal`} />
          <Row
            label="PFC"
            value={`P${Math.round(nutritionTarget.target_protein_g)} / F${Math.round(
              nutritionTarget.target_fat_g,
            )} / C${Math.round(nutritionTarget.target_carbs_g)} g`}
          />
        </Card>
      )}
      <p className="text-xs text-gray-500">※ 編集UIは次段で結線(現状は表示)。</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-white/5 py-2 text-sm last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
