import { LineChart } from 'lucide-react';
import { Card } from '../components/Card';

export function HistoryScreen() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card title="トレンド" right={<LineChart className="h-4 w-4 text-faint" strokeWidth={2.2} />}>
        <p className="text-sm text-muted">
          体重・週間ボリューム・PFC のトレンドと PR タイムラインをここに(Recharts, 次段)。
        </p>
        <p className="mt-2 text-[11px] text-faint">
          現状は Today / Muscle Map / Log が実APIに接続済み。
        </p>
      </Card>
    </div>
  );
}
