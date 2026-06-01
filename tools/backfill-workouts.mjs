/**
 * 既存トレーニングログのバックフィル用 SQL 生成(D1のみ・GH非push)。
 * - 不足種目を custom exercise として INSERT OR IGNORE(英語正式名・Hammer Strength はプロダクト名)
 * - 2セッション(5/31 背中 / 5/30 胸)を workout_sessions/exercises/sets に投入
 * - gh_sync_state は作らない(=GHミラーしない・cron も拾わない)
 * 出力: 標準出力に SQL。`wrangler d1 execute ghsidecar --remote --file=...` で適用。
 */
import { randomUUID } from 'node:crypto';

const sql = [];
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const n = (v) => (v == null ? 'NULL' : String(v));

// ---- 種目メタ(load_basis: total | per_side、is_bodyweight)----
const EX = {
  // 既存(catalog)
  'conventional-deadlift': { basis: 'total', bw: 0 },
  'barbell-bench-press': { basis: 'total', bw: 0 },
  dip: { basis: 'total', bw: 1 },
  // 新規(custom)
  't-bar-row': {
    basis: 'total',
    bw: 0,
    create: {
      name_en: 'T-Bar Row',
      name_ja: 'ティーバーロー',
      category: 'compound',
      equipment: 'barbell',
      movement: 'horizontal_pull',
      laterality: 'bilateral',
      muscles: [
        ['lats', 'primary', 1.0],
        ['traps', 'secondary', 0.5],
        ['rear_delts', 'secondary', 0.5],
        ['biceps', 'secondary', 0.5],
        ['lower_back', 'stabilizer', 0.25],
      ],
    },
  },
  'hs-iso-wide-pulldown': {
    basis: 'per_side',
    bw: 0,
    create: {
      name_en: 'Hammer Strength Iso-Lateral Wide Pulldown',
      name_ja: 'アイソラテラルワイドプルダウン',
      category: 'compound',
      equipment: 'machine',
      movement: 'vertical_pull',
      laterality: 'unilateral',
      muscles: [
        ['lats', 'primary', 1.0],
        ['biceps', 'secondary', 0.5],
        ['rear_delts', 'secondary', 0.5],
      ],
    },
  },
  'hs-iso-low-row': {
    basis: 'per_side',
    bw: 0,
    create: {
      name_en: 'Hammer Strength Iso-Lateral Low Row',
      name_ja: 'アイソラテラルローロウ',
      category: 'compound',
      equipment: 'machine',
      movement: 'horizontal_pull',
      laterality: 'unilateral',
      muscles: [
        ['lats', 'primary', 1.0],
        ['traps', 'secondary', 0.5],
        ['rear_delts', 'secondary', 0.5],
        ['biceps', 'secondary', 0.5],
      ],
    },
  },
  'hs-iso-incline-press': {
    basis: 'per_side',
    bw: 0,
    create: {
      name_en: 'Hammer Strength Iso-Lateral Incline Press',
      name_ja: 'アイソラテラルインクラインプレス',
      category: 'compound',
      equipment: 'machine',
      movement: 'incline_press',
      laterality: 'unilateral',
      muscles: [
        ['chest', 'primary', 1.0],
        ['front_delts', 'secondary', 0.5],
        ['triceps', 'secondary', 0.5],
      ],
    },
  },
  'hs-iso-wide-chest': {
    basis: 'per_side',
    bw: 0,
    create: {
      name_en: 'Hammer Strength Iso-Lateral Wide Chest',
      name_ja: 'アイソラテラルワイドチェスト',
      category: 'compound',
      equipment: 'machine',
      movement: 'horizontal_press',
      laterality: 'unilateral',
      muscles: [
        ['chest', 'primary', 1.0],
        ['front_delts', 'secondary', 0.5],
        ['triceps', 'secondary', 0.5],
      ],
    },
  },
  'pec-deck-fly': {
    basis: 'total',
    bw: 0,
    create: {
      name_en: 'Machine Pec Fly (Pec Deck)',
      name_ja: 'ペックフライ',
      category: 'isolation',
      equipment: 'machine',
      movement: 'horizontal_adduction',
      laterality: 'bilateral',
      muscles: [
        ['chest', 'primary', 1.0],
        ['front_delts', 'stabilizer', 0.25],
      ],
    },
  },
};

// ---- 新規種目の INSERT(idempotent)----
for (const [id, meta] of Object.entries(EX)) {
  if (!meta.create) continue;
  const c = meta.create;
  sql.push(
    `INSERT OR IGNORE INTO exercises (id,name_en,name_ja,category,equipment,movement_pattern,laterality,load_basis,is_bodyweight,gh_exercise_type,is_custom) ` +
      `VALUES (${q(id)},${q(c.name_en)},${q(c.name_ja)},${q(c.category)},${q(c.equipment)},${q(c.movement)},${q(c.laterality)},${q(meta.basis)},${meta.bw},'STRENGTH_TRAINING',1);`,
  );
  for (const [mg, role, contrib] of c.muscles) {
    sql.push(
      `INSERT OR IGNORE INTO exercise_muscles (exercise_id,muscle_group_id,role,contribution) VALUES (${q(id)},${q(mg)},${q(role)},${contrib});`,
    );
  }
}

// ---- セット定義: [entryValue(片側/総), reps]。bodyweight は entry=null ----
const sessions = [
  {
    date: '2026-05-31',
    title: '背中',
    note: 'バックフィル投入(マシンは全て Hammer Strength)',
    startLocal: '2026-05-31T18:00:00+09:00',
    durationMin: 90,
    bw: 71.6,
    items: [
      { ex: 't-bar-row', sets: [[20, 12], [30, 8], [30, 10]] },
      { ex: 'hs-iso-wide-pulldown', sets: [[20, 10], [30, 10], [30, 10]] },
      { ex: 'conventional-deadlift', sets: [[60, 8], [100, 3], [100, 4], [100, 4]] },
      { ex: 'hs-iso-low-row', sets: [[20, 10], [20, 10], [20, 10]] },
    ],
  },
  {
    date: '2026-05-30',
    title: '胸',
    note: 'バックフィル投入。ストレッチ10分。マシンは全て Hammer Strength',
    startLocal: '2026-05-30T18:00:00+09:00',
    durationMin: 85,
    bw: 71.6,
    items: [
      { ex: 'dip', mode: 'bodyweight', sets: [[null, 8], [null, 4]] },
      { ex: 'hs-iso-incline-press', sets: [[20, 8], [20, 6], [20, 6]] },
      { ex: 'barbell-bench-press', sets: [[20, 10], [40, 5], [40, 4], [20, 10]] },
      { ex: 'hs-iso-wide-chest', sets: [[20, 10], [25, 8], [20, 10]] },
      { ex: 'pec-deck-fly', sets: [[26, 8], [26, 10]] },
    ],
  },
];

const mult = (basis) => (basis === 'per_side' || basis === 'per_limb' ? 2 : 1);
const estCal = (bw, durSec, met = 5.0) => Math.round(((met * 3.5 * bw) / 200) * (durSec / 60));

let summary = '';
for (const s of sessions) {
  const startedAt = Math.floor(Date.parse(s.startLocal) / 1000);
  const durSec = s.durationMin * 60;
  const endedAt = startedAt + durSec;
  const sessionId = `wk_${randomUUID()}`;
  let totalVol = 0;

  s.items.forEach((it, exIdx) => {
    const meta = EX[it.ex];
    const weId = `we_${randomUUID()}`;
    sql.push(
      `INSERT INTO workout_exercises (id,session_id,exercise_id,order_index,note) VALUES (${q(weId)},${q(sessionId)},${q(it.ex)},${exIdx},NULL);`,
    );
    it.sets.forEach(([entry, reps], setIdx) => {
      const loadMode = it.mode ?? (meta.bw ? 'bodyweight' : 'weighted');
      const weightKg = entry == null ? 'NULL' : entry; // 全て kg 入力
      // 負荷: bodyweight は bw×factor(=bw)、weighted は entry×mult
      const loadKg = loadMode === 'bodyweight' ? s.bw : (entry ?? 0) * mult(meta.basis);
      totalVol += loadKg * reps;
      sql.push(
        `INSERT INTO workout_sets (id,workout_exercise_id,set_index,set_type,load_mode,entry_value,entry_unit,weight_kg,reps,is_completed) ` +
          `VALUES (${q(`st_${randomUUID()}`)},${q(weId)},${setIdx},'main',${q(loadMode)},${n(entry)},'kg',${weightKg},${reps},1);`,
      );
    });
  });

  totalVol = Math.round(totalVol * 100) / 100;
  const cal = estCal(s.bw, durSec);
  sql.unshift(
    `INSERT INTO workout_sessions (id,date,started_at,ended_at,title,note,bodyweight_kg,total_volume_kg,active_duration_sec,est_calories,status,source) ` +
      `VALUES (${q(sessionId)},${q(s.date)},${startedAt},${endedAt},${q(s.title)},${q(s.note)},${s.bw},${totalVol},${durSec},${cal},'completed','app');`,
  );
  summary += `  ${s.date} ${s.title}: ${s.items.length}種目 / volume ${totalVol}kg / ${cal}kcal\n`;
}

console.error('=== 投入サマリ ===\n' + summary);
// D1 は明示 BEGIN/COMMIT 不可(--file 内の複数文を自動でアトミックにバッチ実行)。
for (const line of sql) console.log(line);
