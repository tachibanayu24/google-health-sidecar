import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/Card';
import { api, type MuscleVolume } from '../lib/api';
import { ErrorBox, Loading } from './Today';

const NAME_JA: Record<string, string> = {
  chest: '胸',
  lats: '広背筋',
  traps: '僧帽筋',
  front_delts: '前部三角筋',
  side_delts: '中部三角筋',
  rear_delts: '後部三角筋',
  biceps: '上腕二頭筋',
  triceps: '上腕三頭筋',
  forearms: '前腕',
  abs: '腹直筋',
  obliques: '腹斜筋',
  quads: '大腿四頭筋',
  hamstrings: 'ハムストリング',
  glutes: '臀筋',
  calves: 'ふくらはぎ',
  lower_back: '脊柱起立筋',
};

/** stimulus(0..1)→ 青→緑→黄→赤 のヒートマップ色(§8.3)。 */
function heatColor(s: number): string {
  if (s <= 0) return 'rgb(31,41,55)'; // 不足=グレー寄り
  const hue = 210 - s * 210; // 210(青)→0(赤)
  return `hsl(${hue}, 75%, ${30 + s * 20}%)`;
}

export function MuscleScreen() {
  const q = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const muscles = [...q.data!.muscles].sort((a, b) => b.stimulus - a.stimulus);

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-lg font-bold">
        部位ヒートマップ <span className="text-xs font-normal text-gray-400">直近7日</span>
      </h1>
      <p className="text-xs text-gray-500">
        ※ 人体SVG(body-highlighter)描画は次段。まずは刺激量(stimulus)を色と量で可視化。
      </p>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          {muscles.map((m) => (
            <MuscleCell key={m.muscle} m={m} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function MuscleCell({ m }: { m: MuscleVolume }) {
  return (
    <div className="rounded-xl p-3" style={{ background: heatColor(m.stimulus) }}>
      <div className="text-sm font-semibold">{NAME_JA[m.muscle] ?? m.muscle}</div>
      <div className="text-[11px] text-white/80">
        {m.actual_sets}セット
        {m.target_sets ? ` / 目標${m.target_sets}` : ''}
      </div>
      <div className="text-[11px] text-white/70">{Math.round(m.volume_kg)}kg</div>
    </div>
  );
}
