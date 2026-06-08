import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/Card';
import { axisTick, CHART, ChartFrame, TT } from '../../components/chart';
import { Empty } from '../../components/state';
import { api, type LandmarkZone, type MuscleVolume } from '../../lib/api';
import { formatDateForDisplay } from '../../lib/datetime';
import { stimulusBucket as bucket, MUSCLE_JA } from '../../lib/muscles';
import { HEATMAP_RAMP } from '../../lib/theme';

const RAMP = HEATMAP_RAMP;
const BASE_BODY = '#e6e1d5';

// ============ ボリュームタブ(90日 日次 bar + 部位別) ============
export function VolumeTab({
  volumeDaily,
  muscles,
}: {
  volumeDaily: Array<{ date: string; volume_kg: number }>;
  muscles: MuscleVolume[];
}) {
  const [sel, setSel] = useState<string | null>(null);
  const sorted = [...muscles].sort((a, b) => b.stimulus - a.stimulus);
  return (
    <>
      <Card
        title="日次ボリューム"
        right={<span className="text-[11px] text-faint">90日 · kg</span>}
      >
        {volumeDaily.length ? (
          <ChartFrame>
            <BarChart data={volumeDaily} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={CHART.line} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateForDisplay}
                tick={axisTick}
                stroke={CHART.line}
                minTickGap={28}
              />
              <YAxis tick={axisTick} stroke={CHART.line} width={48} />
              <Tooltip content={<TT unit="kg" />} cursor={{ fill: 'rgba(223,74,38,0.08)' }} />
              <Bar dataKey="volume_kg" fill={CHART.accent} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        ) : (
          <Empty note="ワークアウトを記録するとここに推移が出ます。" />
        )}
      </Card>
      <Card title="部位別ボリューム">
        <p className="mb-2 text-[11px] leading-snug text-faint">
          帯=週間セット数の目安(緑=MAV域 最も伸びやすい / 縦線=MEV最低ライン)。
          研究ベースのガイドライン(RP)で個人差あり・出発点。間接関与は0.5・補助0.25で加重した実効セット。部位をタップ→種目。
        </p>
        <ul className="space-y-2">
          {sorted.map((m) => (
            <MuscleRow
              key={m.muscle}
              m={m}
              selected={sel === m.muscle}
              onSelect={() => setSel((c) => (c === m.muscle ? null : m.muscle))}
            />
          ))}
        </ul>
      </Card>
    </>
  );
}
// ボリュームランドマーク帯のゾーン表示(§8.9)。色=信号、ラベル=帯の位置。
const ZONE_META: Record<LandmarkZone, { label: string; color: string }> = {
  under: { label: '不足', color: '#6b86c9' },
  building: { label: '育成', color: '#4c9aa0' },
  optimal: { label: '最適', color: '#2f9e6e' },
  high: { label: '多め', color: '#c98a2b' },
  over: { label: '超過', color: '#e0521f' },
};

function MuscleRow({
  m,
  selected,
  onSelect,
}: {
  m: MuscleVolume;
  selected: boolean;
  onSelect: () => void;
}) {
  const zoneMeta = m.landmark_zone ? ZONE_META[m.landmark_zone] : null;
  const hasLandmarks = m.landmarks.mrv != null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 py-1 text-left [-webkit-tap-highlight-color:transparent]"
      >
        <span className="flex w-24 shrink-0 items-center gap-1 text-sm">
          <ChevronRight
            className={`h-3 w-3 text-faint transition-transform ${selected ? 'rotate-90' : ''}`}
          />
          {MUSCLE_JA[m.muscle] ?? m.muscle}
        </span>
        {hasLandmarks ? (
          <LandmarkBar
            sets={m.effective_sets}
            l={m.landmarks}
            color={zoneMeta?.color ?? BASE_BODY}
          />
        ) : (
          <StimulusBar stimulus={m.stimulus} />
        )}
        <span className="flex w-[4.5rem] shrink-0 items-center justify-end gap-1 text-xs">
          <span className="tnum text-muted">{m.effective_sets}</span>
          {zoneMeta ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
              style={{ color: zoneMeta.color, backgroundColor: `${zoneMeta.color}1f` }}
            >
              {zoneMeta.label}
            </span>
          ) : (
            <span className="text-faint">set</span>
          )}
        </span>
      </button>
      {/* 行の直下にアコーディオンで「にゅっと」展開(grid-rows 0fr→1fr)。別カードにしない。 */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${selected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <MuscleExercisesInline muscle={m.muscle} open={selected} />
        </div>
      </div>
    </li>
  );
}

function StimulusBar({ stimulus }: { stimulus: number }) {
  const b = bucket(stimulus);
  const color = b === 0 ? BASE_BODY : RAMP[b - 1];
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.round(stimulus * 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

/** 週間セット数を MEV〜MAV(sweet spot)〜MRV の帯に位置づける。塗り=現在量、緑帯=最も伸びやすいMAV域。 */
function LandmarkBar({
  sets,
  l,
  color,
}: {
  sets: number;
  l: MuscleVolume['landmarks'];
  color: string;
}) {
  const scaleMax = Math.max((l.mrv ?? 1) * 1.1, sets * 1.05, 1);
  const pos = (v: number | null) => (v == null ? 0 : Math.min(100, (v / scaleMax) * 100));
  const sweetL = pos(l.mav_low);
  const sweetW = Math.max(0, pos(l.mav_high) - sweetL);
  return (
    <div
      className="relative h-2 flex-1 overflow-hidden rounded-full bg-line"
      title={`MEV ${l.mev} / MAV ${l.mav_low}–${l.mav_high} / MRV ${l.mrv}(週間セット, 目安)`}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${pos(sets)}%`, backgroundColor: color, opacity: 0.82 }}
      />
      {/* MAV sweet spot 帯(最も伸びやすい量) */}
      <div
        className="absolute inset-y-0 border-x border-carb/50 bg-carb/10"
        style={{ left: `${sweetL}%`, width: `${sweetW}%` }}
      />
      {/* MEV 目盛 */}
      <div className="absolute inset-y-0 w-px bg-faint/70" style={{ left: `${pos(l.mev)}%` }} />
    </div>
  );
}
/** 選択部位の種目をインライン展開(別カードにせず行の下に従属表示)。open のときだけ取得。 */
function MuscleExercisesInline({ muscle, open }: { muscle: string; open: boolean }) {
  const q = useQuery({
    queryKey: ['ex-by-muscle', muscle],
    queryFn: () => api.searchExercises('', muscle),
    enabled: open,
  });
  return (
    <div className="mb-1 ml-7 border-l border-line/70 pl-3">
      {q.isLoading && <p className="py-1.5 text-xs text-faint">読み込み中…</p>}
      {q.error && (
        <button
          type="button"
          onClick={() => q.refetch()}
          className="py-1.5 text-xs font-semibold text-accent-ink underline"
        >
          読み込みに失敗。タップで再試行
        </button>
      )}
      {q.data?.exercises.length === 0 && <p className="py-1.5 text-xs text-faint">該当なし</p>}
      <ul>
        {q.data?.exercises.map((ex) => (
          <li key={ex.id} className="flex items-center justify-between gap-2 py-1 text-xs">
            <span className="min-w-0 truncate font-medium">{ex.name_ja}</span>
            <span className="shrink-0 rounded-full bg-paper px-1.5 py-0.5 text-[10px] font-semibold text-faint">
              {ex.equipment}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
