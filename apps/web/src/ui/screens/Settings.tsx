import { useQuery } from '@tanstack/react-query';
import { Gauge, Ruler, Target } from 'lucide-react';
import { Card } from '../components/Card';
import { api } from '../lib/api';
import { ErrorBox, Loading } from './Today';

export function SettingsScreen() {
  const q = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { settings, nutritionTarget } = q.data!;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card title="単位・計算" right={<Ruler className="h-4 w-4 text-faint" strokeWidth={2.2} />}>
        <Row label="主単位" value={settings.unit_preference.toUpperCase()} />
        <Row label="1RM 推定式" value={settings.e1rm_formula} />
        <Row label="ロケール" value={settings.locale} />
      </Card>
      {nutritionTarget && (
        <Card title="栄養目標" right={<Target className="h-4 w-4 text-faint" strokeWidth={2.2} />}>
          <Row label="フェーズ" value={nutritionTarget.phase} />
          <Row label="カロリー" value={`${Math.round(nutritionTarget.target_kcal)} kcal`} />
          <Row
            label="PFC"
            value={`P${Math.round(nutritionTarget.target_protein_g)} · F${Math.round(
              nutritionTarget.target_fat_g,
            )} · C${Math.round(nutritionTarget.target_carbs_g)} g`}
          />
          <Row label="食塩相当量" value={`< ${nutritionTarget.target_salt_g} g`} />
        </Card>
      )}
      <Card title="連携" right={<Gauge className="h-4 w-4 text-faint" strokeWidth={2.2} />}>
        <p className="text-sm text-muted">
          Google Health 連携(体重・睡眠の取り込み / ワークアウト・食事の書き出し)は OAuth
          接続後に有効化。
        </p>
      </Card>
      <p className="px-1 text-[11px] text-faint">※ 編集UIは次段で結線(現状は表示のみ)。</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
