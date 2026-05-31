import { Card } from '../components/Card';

export function HistoryScreen() {
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-lg font-bold">履歴・トレンド</h1>
      <Card>
        <p className="text-sm text-gray-400">
          体重・ボリューム・PFC のトレンドと PR タイムラインをここに(Recharts, 次段)。 現状は Today
          / 図鑑 / 記録 が実APIに接続済み。
        </p>
      </Card>
    </div>
  );
}
