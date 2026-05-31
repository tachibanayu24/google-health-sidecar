import { useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
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

/** stimulus(0..1)→ light 用の暖色ヒート(無刺激=ペーパー寄り → 朱)。 */
function heat(s: number): { bg: string; fg: string; border: string } {
  if (s <= 0.02) return { bg: '#efece4', fg: '#a8a294', border: '#e6e1d5' };
  // 黄(45) → 朱(12) を彩度・明度を上げながら
  const hue = 45 - s * 33;
  const light = 92 - s * 42;
  const sat = 70 + s * 20;
  return {
    bg: `hsl(${hue} ${sat}% ${light}%)`,
    fg: s > 0.55 ? '#fffefb' : '#5a3410',
    border: `hsl(${hue} ${sat}% ${light - 8}%)`,
  };
}

export function MuscleScreen() {
  const q = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const muscles = [...q.data!.muscles].sort((a, b) => b.stimulus - a.stimulus);
  const worked = muscles.filter((m) => m.actual_sets > 0).length;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
            直近7日
          </div>
          <div className="stat text-2xl">
            {worked}
            <span className="ml-1 text-base text-muted">/16 部位</span>
          </div>
        </div>
        <Flame className="h-6 w-6 text-accent" strokeWidth={2} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {muscles.map((m) => (
          <MuscleCell key={m.muscle} m={m} />
        ))}
      </div>

      <Card title="凡例">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>少</span>
          <div
            className="h-2 flex-1 rounded-full"
            style={{
              background: 'linear-gradient(90deg, #efece4, hsl(45 75% 80%), hsl(12 88% 55%))',
            }}
          />
          <span>多</span>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          色 = 刺激量(ボリューム × 効き係数 × 直近減衰)。人体SVG(body-highlighter)は次段で重ねる。
        </p>
      </Card>
    </div>
  );
}

function MuscleCell({ m }: { m: MuscleVolume }) {
  const c = heat(m.stimulus);
  const vsTarget = m.vs_target != null ? Math.round(m.vs_target * 100) : null;
  return (
    <div
      className="rounded-xl border p-3"
      style={{ background: c.bg, borderColor: c.border, color: c.fg }}
    >
      <div className="text-sm font-bold leading-tight">{NAME_JA[m.muscle] ?? m.muscle}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="stat text-xl leading-none">{m.actual_sets}</span>
        <span className="text-[11px] opacity-80">
          set{m.target_sets ? ` / ${m.target_sets}` : ''}
        </span>
      </div>
      {vsTarget != null && (
        <div className="mt-0.5 text-[10px] font-semibold opacity-80">目標 {vsTarget}%</div>
      )}
    </div>
  );
}
