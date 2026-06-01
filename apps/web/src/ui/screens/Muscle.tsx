import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import Model, { type IExerciseData, type Muscle } from 'react-body-highlighter';
import { Card } from '../components/Card';
import { api, type MuscleVolume } from '../lib/api';
import { ErrorBox, Loading } from './Home';

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
  const [sel, setSel] = useState<string | null>(null);
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
      <div>
        <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          直近7日の刺激
        </div>
        <div className="stat text-2xl">
          {worked}
          <span className="ml-1 text-base text-muted">/ 16 部位</span>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-2 [&_svg]:h-auto [&_svg]:max-h-[40vh] [&_svg]:w-full">
          <Figure label="前面" type="anterior" data={data} />
          <Figure label="背面" type="posterior" data={data} />
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <span>刺激 少</span>
          <div
            className="h-2 flex-1 rounded-full"
            style={{ background: `linear-gradient(90deg, ${BASE_BODY}, ${RAMP.join(',')})` }}
          />
          <span>多</span>
        </div>
        <p className="mt-2 text-[10px] leading-snug text-faint">
          ※
          図は概略表示。中部三角筋は前部と同じ位置に、脊柱起立筋は背面下部に近似して塗っています。正確な部位別数値は下のリストを参照。
        </p>
      </Card>

      <Card title="部位別ボリューム">
        <p className="mb-2 text-[11px] text-faint">部位をタップ → 種目を表示</p>
        <ul className="space-y-2">
          {sorted.map((m) => (
            <MuscleRow
              key={m.muscle}
              m={m}
              selected={sel === m.muscle}
              onSelect={() => setSel((cur) => (cur === m.muscle ? null : m.muscle))}
            />
          ))}
        </ul>
      </Card>

      {sel && <MuscleExercises muscle={sel} name={NAME_JA[sel] ?? sel} />}
    </div>
  );
}

function MuscleExercises({ muscle, name }: { muscle: string; name: string }) {
  const q = useQuery({
    queryKey: ['ex-by-muscle', muscle],
    queryFn: () => api.searchExercises('', muscle),
  });
  return (
    <Card title={`「${name}」の種目`}>
      {q.isLoading && <p className="py-2 text-sm text-faint">読み込み中…</p>}
      {q.data?.exercises.length === 0 && <p className="py-2 text-sm text-faint">該当なし</p>}
      <ul className="space-y-1">
        {q.data?.exercises.map((ex) => (
          <li
            key={ex.id}
            className="flex items-center justify-between rounded-lg px-1 py-2 text-sm"
          >
            <span className="font-medium">{ex.name_ja ?? ex.name_en}</span>
            <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-faint">
              {ex.equipment}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Figure({
  label,
  type,
  data,
}: {
  label: string;
  type: 'anterior' | 'posterior';
  data: IExerciseData[];
}) {
  return (
    <div className="flex flex-col items-center">
      <Model type={type} data={data} highlightedColors={RAMP} bodyColor={BASE_BODY} />
      <span className="mt-1 text-[11px] font-semibold text-faint">{label}</span>
    </div>
  );
}

function MuscleRow({
  m,
  selected,
  onSelect,
}: {
  m: MuscleVolume;
  selected: boolean;
  onSelect: () => void;
}) {
  const b = bucket(m.stimulus);
  const color = b === 0 ? BASE_BODY : RAMP[b - 1];
  const pct = Math.round(m.stimulus * 100);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-lg py-1 text-left ${selected ? 'bg-accent-soft' : ''}`}
      >
        <span className="flex w-24 shrink-0 items-center gap-1 text-sm">
          <ChevronRight
            className={`h-3 w-3 text-faint transition-transform ${selected ? 'rotate-90' : ''}`}
          />
          {NAME_JA[m.muscle] ?? m.muscle}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="tnum w-16 shrink-0 text-right text-xs text-muted">
          {m.actual_sets}set{m.target_sets ? `/${m.target_sets}` : ''}
        </span>
      </button>
    </li>
  );
}
