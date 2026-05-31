import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
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

/** 我々の muscle id → react-body-highlighter の Muscle slug。 */
const TO_SLUG: Record<string, Muscle> = {
  chest: 'chest',
  lats: 'upper-back',
  traps: 'trapezius',
  front_delts: 'front-deltoids',
  side_delts: 'front-deltoids', // libに side が無いので前部で近似
  rear_delts: 'back-deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm',
  abs: 'abs',
  obliques: 'obliques',
  quads: 'quadriceps',
  hamstrings: 'hamstring',
  glutes: 'gluteal',
  calves: 'calves',
  lower_back: 'lower-back',
};

// 刺激量 0..1 を 5 段にバケット。色は light テーマの暖色ランプ(黄→朱)。
const RAMP = ['#f6e7b0', '#f3c97a', '#ef9f53', '#e96f38', '#df4a26'];
const BASE_BODY = '#e6e1d5';

function bucket(s: number): number {
  if (s <= 0.02) return 0;
  return Math.min(5, Math.max(1, Math.ceil(s * 5)));
}

export function MuscleScreen() {
  const q = useQuery({ queryKey: ['muscle-volume', 7], queryFn: () => api.muscleVolume(7) });
  const [side, setSide] = useState<'anterior' | 'posterior'>('anterior');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const muscles = q.data!.muscles;
  const worked = muscles.filter((m) => m.actual_sets > 0).length;

  // slug 単位で最大バケットを採る(side_delts/front_delts が同一 slug に当たる二重加算を回避)。
  const slugBucket = new Map<Muscle, number>();
  for (const m of muscles) {
    const slug = TO_SLUG[m.muscle];
    if (!slug) continue;
    const b = bucket(m.stimulus);
    if (b > (slugBucket.get(slug) ?? 0)) slugBucket.set(slug, b);
  }
  // バケットごとに slug をまとめ、frequency=バケット で塗り分け(index=freq-1)。
  const data: IExerciseData[] = [1, 2, 3, 4, 5].map((b) => ({
    name: `level-${b}`,
    muscles: [...slugBucket.entries()].filter(([, bb]) => bb === b).map(([slug]) => slug),
    frequency: b,
  }));

  const sorted = [...muscles].sort((a, b) => b.stimulus - a.stimulus);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
            直近7日の刺激
          </div>
          <div className="stat text-2xl">
            {worked}
            <span className="ml-1 text-base text-muted">/ 16 部位</span>
          </div>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-line text-xs font-bold">
          {(['anterior', 'posterior'] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSide(s)}
              className={`px-3 py-1.5 transition-colors ${
                side === s ? 'bg-ink text-card' : 'bg-card text-faint'
              }`}
            >
              {s === 'anterior' ? '前面' : '背面'}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-h-[46vh] [&_svg]:w-auto">
          <Model
            type={side}
            data={data}
            highlightedColors={RAMP}
            bodyColor={BASE_BODY}
            style={{ width: '62%' }}
          />
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span>少</span>
          <div
            className="h-2 flex-1 rounded-full"
            style={{ background: `linear-gradient(90deg, ${BASE_BODY}, ${RAMP.join(',')})` }}
          />
          <span>多</span>
        </div>
      </Card>

      <Card title="部位別ボリューム">
        <ul className="space-y-2">
          {sorted.map((m) => (
            <MuscleRow key={m.muscle} m={m} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function MuscleRow({ m }: { m: MuscleVolume }) {
  const b = bucket(m.stimulus);
  const color = b === 0 ? BASE_BODY : RAMP[b - 1];
  const pct = Math.round(m.stimulus * 100);
  return (
    <li className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm">{NAME_JA[m.muscle] ?? m.muscle}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tnum w-16 shrink-0 text-right text-xs text-muted">
        {m.actual_sets}set{m.target_sets ? `/${m.target_sets}` : ''}
      </span>
    </li>
  );
}
