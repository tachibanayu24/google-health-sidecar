import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/Card';
import { Empty } from '../../components/state';
import { api } from '../../lib/api';
import { DOW_JA, formatDateForDisplay, shiftDate, todayJst } from '../../lib/datetime';

/** カレンダー表示用の部位グルーピング(16筋群 → 6行)。トレーニング分割の粒度で「何の日か」を示す。 */
const REGION_GROUPS: Array<{ key: string; label: string; color: string; muscles: string[] }> = [
  { key: 'chest', label: '胸', color: '#df4a26', muscles: ['chest'] },
  { key: 'back', label: '背', color: '#1d6f6f', muscles: ['lats', 'traps'] },
  {
    key: 'shoulders',
    label: '肩',
    color: '#b7791f',
    muscles: ['front_delts', 'side_delts', 'rear_delts'],
  },
  { key: 'biceps', label: '二頭', color: '#7c5cad', muscles: ['biceps'] },
  { key: 'triceps', label: '三頭', color: '#a36fd0', muscles: ['triceps'] },
  { key: 'forearms', label: '前腕', color: '#9c8255', muscles: ['forearms'] },
  {
    key: 'legs',
    label: '脚',
    color: '#2f6fb0', // 背(ティール)と紛れないよう青系へ
    muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
  },
  { key: 'core', label: '体幹', color: '#9c6b4a', muscles: ['abs', 'obliques', 'lower_back'] },
];

// ============ トレーニング・カレンダー(週グリッド: 日付×部位文字で「いつ・何の日」を読む) ============
const WEEK_LABELS = ['今週', '先週', '2週前', '3週前'];

/** ISO日付の曜日。日=0 … 土=6(週は日曜始まり)。 */
function isoDow(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getDay();
}

export function TrainingCalendar() {
  const WEEKS = 4;
  const days = WEEKS * 7;
  const cal = useQuery({
    queryKey: ['training-calendar', days],
    queryFn: () => api.muscleCalendar(days),
  });
  const today = todayJst();

  // muscle(16筋群) → 表示グループ(6区分)、date → (region → セット数) を集計。
  const muscleToRegion = new Map<string, string>();
  for (const g of REGION_GROUPS) for (const m of g.muscles) muscleToRegion.set(m, g.key);
  const byDate = new Map<string, Map<string, number>>();
  for (const cell of cal.data?.cells ?? []) {
    const region = muscleToRegion.get(cell.muscle);
    if (!region) continue;
    let row = byDate.get(cell.date);
    if (!row) {
      row = new Map();
      byDate.set(cell.date, row);
    }
    row.set(region, (row.get(region) ?? 0) + cell.sets);
  }
  const sessionDates = new Set(cal.data?.sessionDates ?? []);

  // 今週の日曜から過去 WEEKS 週(各週 日→土, weeks[0]=今週)。
  const weekStart = shiftDate(today, -isoDow(today));
  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => shiftDate(shiftDate(weekStart, -7 * w), i)),
  );

  const oldest = weeks[WEEKS - 1]![0]!;
  const trainedDays = [...sessionDates].filter((d) => d >= oldest && d <= today).length;

  return (
    <Card
      title="部位カレンダー"
      right={
        <span className="text-[11px] text-faint">
          直近{WEEKS}週 · <span className="font-semibold text-muted">{trainedDays}</span>日実施
        </span>
      }
    >
      {cal.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-line/40" />
      ) : trainedDays === 0 ? (
        <Empty note="この期間のワークアウト記録がありません。" />
      ) : (
        <>
          {/* 曜日ヘッダ */}
          <div className="flex items-center gap-1">
            <span className="w-9 shrink-0" />
            <div className="grid flex-1 grid-cols-7 gap-1 text-center text-[10px] font-semibold text-faint">
              {DOW_JA.map((d, i) => (
                <span
                  key={d}
                  className={i === 0 ? 'text-accent' : i === 6 ? 'text-fiber' : undefined}
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
          {/* 週グリッド(上=今週) */}
          <div className="mt-1 space-y-1">
            {weeks.map((week, wi) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 固定長の週行(並べ替えなし)
              <div key={wi} className="flex items-center gap-1">
                <span className="w-9 shrink-0 text-[10px] font-semibold text-faint">
                  {WEEK_LABELS[wi]}
                </span>
                <div className="grid flex-1 grid-cols-7 gap-1">
                  {week.map((date) => (
                    <DayCell
                      key={date}
                      date={date}
                      regions={REGION_GROUPS.filter((g) => (byDate.get(date)?.get(g.key) ?? 0) > 0)}
                      sets={byDate.get(date)}
                      isToday={date === today}
                      isFuture={date > today}
                      rested={sessionDates.has(date)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

type Region = { key: string; label: string; color: string };
const regionLabel = (r: Region) => (r.label === '体幹' ? '幹' : r.label);

/**
 * セル内の部位ラベルを行に詰める。1文字(胸/背/肩/脚/幹)は1行2つまで(色で区別するので空白なし)、
 * 2文字(二頭/三頭/前腕)はその行で単独。1文字を先頭行に寄せ、2文字を後ろの行へ。
 */
function chunkRegionRows(regions: Region[]): Region[][] {
  const rows: Region[][] = [];
  let cur: Region[] = [];
  for (const r of [...regions].sort((a, b) => regionLabel(a).length - regionLabel(b).length)) {
    if (regionLabel(r).length >= 2) {
      if (cur.length) {
        rows.push(cur);
        cur = [];
      }
      rows.push([r]);
    } else {
      cur.push(r);
      if (cur.length === 2) {
        rows.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

function DayCell({
  date,
  regions,
  sets,
  isToday,
  isFuture,
  rested,
}: {
  date: string;
  regions: Array<{ key: string; label: string; color: string }>;
  sets: Map<string, number> | undefined;
  isToday: boolean;
  isFuture: boolean;
  rested: boolean;
}) {
  const day = Number(date.slice(8, 10));
  // 日付色は曜日基準(日=朱 / 土=青 / 平日=ink)。トレ無し日・未来は透明度で弱める。
  const dow = isoDow(date);
  const dowColor = dow === 0 ? 'text-accent' : dow === 6 ? 'text-fiber' : 'text-ink';
  const trained = regions.length > 0;
  // 未来日: カレンダーとして日付だけ薄く置く(部位なし)。
  if (isFuture) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md">
        <span className={`stat text-lg italic leading-none ${dowColor} opacity-30`}>{day}</span>
      </div>
    );
  }
  const title = trained
    ? `${formatDateForDisplay(date)} ${regions.map((r) => `${r.label}${sets?.get(r.key) ?? 0}`).join(' ')}`
    : rested
      ? `${formatDateForDisplay(date)} 実施(補助のみ)`
      : `${formatDateForDisplay(date)} レスト`;
  return (
    <div
      title={title}
      className={`relative flex aspect-square items-center justify-center rounded-md border ${
        isToday ? 'ring-2 ring-ink/30' : ''
      } ${trained ? 'border-line/50 bg-card' : 'border-line/40 bg-line/15'}`}
    >
      {/* 日付は薄地で背面に置き、トレ日は部位ラベルを上に重ねる。 */}
      <span
        className={`stat text-lg italic leading-none ${dowColor} ${trained ? 'opacity-25' : 'opacity-40'}`}
      >
        {day}
      </span>
      {trained && (
        // 縮小せず一定サイズ(12px)。1文字は1行2つ詰め(色で区別=空白なし)、2文字(二頭/三頭/前腕)は単独行。
        <div className="absolute inset-0 flex flex-col items-center justify-center text-[12px] font-bold leading-none">
          {chunkRegionRows(regions).map((row) => (
            <div key={row.map((r) => r.key).join()} className="flex">
              {row.map((r) => (
                <span key={r.key} style={{ color: r.color }}>
                  {regionLabel(r)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {!trained && rested && (
        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-faint/50" />
      )}
    </div>
  );
}
