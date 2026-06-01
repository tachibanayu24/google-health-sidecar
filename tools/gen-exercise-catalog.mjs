/**
 * 種目カタログ拡充マイグレーション生成(0004)。フリーウェイト+マシン(Hammer Strength 含む)の定番を
 * 正確な部位マッピング(primary=1.0/secondary=0.5/stabilizer=0.25)付きで INSERT OR IGNORE。
 * load_basis: total(バーベル/片手DB/両側マシン) / per_limb(両手DB=片手入力×2) / per_side(Hammer iso=片側入力×2)
 * 出力: packages/core/src/db/migrations/0004_exercise_catalog.sql 用 SQL(stdout)。
 */
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

// [id, en, ja, category, equipment, pattern, laterality, load_basis, is_bodyweight, repRange, muscles]
// muscles: [muscle_group_id, role, contribution]
const P = (m) => [m, 'primary', 1.0];
const S = (m) => [m, 'secondary', 0.5];
const ST = (m) => [m, 'stabilizer', 0.25];

const EX = [
  // ===== CHEST =====
  ['dumbbell-bench-press', 'Dumbbell Bench Press', 'ダンベルベンチプレス', 'compound', 'dumbbell', 'horizontal_press', 'bilateral', 'per_limb', 0, '8-12', [P('chest'), S('front_delts'), S('triceps')]],
  ['incline-barbell-bench-press', 'Incline Barbell Bench Press', 'インクラインベンチプレス', 'compound', 'barbell', 'incline_press', 'bilateral', 'total', 0, '6-10', [P('chest'), S('front_delts'), S('triceps')]],
  ['incline-dumbbell-press', 'Incline Dumbbell Press', 'インクラインダンベルプレス', 'compound', 'dumbbell', 'incline_press', 'bilateral', 'per_limb', 0, '8-12', [P('chest'), S('front_delts'), S('triceps')]],
  ['dumbbell-fly', 'Dumbbell Fly', 'ダンベルフライ', 'isolation', 'dumbbell', 'horizontal_adduction', 'bilateral', 'per_limb', 0, '10-15', [P('chest'), ST('front_delts')]],
  ['cable-crossover', 'Cable Crossover', 'ケーブルクロスオーバー', 'isolation', 'cable', 'horizontal_adduction', 'bilateral', 'per_limb', 0, '12-15', [P('chest'), ST('front_delts')]],
  ['machine-chest-press', 'Machine Chest Press', 'マシンチェストプレス', 'compound', 'machine', 'horizontal_press', 'bilateral', 'total', 0, '8-12', [P('chest'), S('front_delts'), S('triceps')]],
  ['push-up', 'Push-Up', 'プッシュアップ', 'compound', 'bodyweight', 'horizontal_press', 'bilateral', 'total', 1, '10-20', [P('chest'), S('front_delts'), S('triceps')]],
  // Hammer Strength(backfill と同 id・INSERT OR IGNORE で重複なし)
  ['hs-iso-incline-press', 'Hammer Strength Iso-Lateral Incline Press', 'アイソラテラルインクラインプレス', 'compound', 'machine', 'incline_press', 'unilateral', 'per_side', 0, '8-12', [P('chest'), S('front_delts'), S('triceps')]],
  ['hs-iso-wide-chest', 'Hammer Strength Iso-Lateral Wide Chest', 'アイソラテラルワイドチェスト', 'compound', 'machine', 'horizontal_press', 'unilateral', 'per_side', 0, '8-12', [P('chest'), S('front_delts'), S('triceps')]],
  ['pec-deck-fly', 'Machine Pec Fly (Pec Deck)', 'ペックフライ', 'isolation', 'machine', 'horizontal_adduction', 'bilateral', 'total', 0, '12-15', [P('chest'), ST('front_delts')]],

  // ===== BACK =====
  ['barbell-row', 'Barbell Bent-Over Row', 'ベントオーバーロウ', 'compound', 'barbell', 'horizontal_pull', 'bilateral', 'total', 0, '6-10', [P('lats'), S('traps'), S('rear_delts'), S('biceps'), ST('lower_back')]],
  ['dumbbell-row', 'One-Arm Dumbbell Row', 'ワンハンドダンベルロウ', 'compound', 'dumbbell', 'horizontal_pull', 'unilateral', 'total', 0, '8-12', [P('lats'), S('traps'), S('rear_delts'), S('biceps')]],
  ['t-bar-row', 'T-Bar Row', 'ティーバーロー', 'compound', 'barbell', 'horizontal_pull', 'bilateral', 'total', 0, '8-12', [P('lats'), S('traps'), S('rear_delts'), S('biceps'), ST('lower_back')]],
  ['seated-cable-row', 'Seated Cable Row', 'シーテッドロウ', 'compound', 'cable', 'horizontal_pull', 'bilateral', 'total', 0, '8-12', [P('lats'), S('traps'), S('rear_delts'), S('biceps')]],
  ['pull-up', 'Pull-Up', 'プルアップ(懸垂)', 'compound', 'bodyweight', 'vertical_pull', 'bilateral', 'total', 1, '5-12', [P('lats'), S('biceps'), S('rear_delts')]],
  ['chin-up', 'Chin-Up', 'チンアップ', 'compound', 'bodyweight', 'vertical_pull', 'bilateral', 'total', 1, '5-12', [P('lats'), S('biceps')]],
  ['face-pull', 'Face Pull', 'フェイスプル', 'isolation', 'cable', 'horizontal_pull', 'bilateral', 'total', 0, '12-20', [P('rear_delts'), S('traps')]],
  ['straight-arm-pulldown', 'Straight-Arm Pulldown', 'ストレートアームプルダウン', 'isolation', 'cable', 'vertical_pull', 'bilateral', 'total', 0, '12-15', [P('lats')]],
  ['hs-iso-wide-pulldown', 'Hammer Strength Iso-Lateral Wide Pulldown', 'アイソラテラルワイドプルダウン', 'compound', 'machine', 'vertical_pull', 'unilateral', 'per_side', 0, '8-12', [P('lats'), S('biceps'), S('rear_delts')]],
  ['hs-iso-low-row', 'Hammer Strength Iso-Lateral Low Row', 'アイソラテラルローロウ', 'compound', 'machine', 'horizontal_pull', 'unilateral', 'per_side', 0, '8-12', [P('lats'), S('traps'), S('rear_delts'), S('biceps')]],

  // ===== SHOULDERS =====
  ['overhead-press', 'Overhead Press', 'オーバーヘッドプレス', 'compound', 'barbell', 'vertical_press', 'bilateral', 'total', 0, '5-8', [P('front_delts'), S('side_delts'), S('triceps')]],
  ['dumbbell-shoulder-press', 'Dumbbell Shoulder Press', 'ダンベルショルダープレス', 'compound', 'dumbbell', 'vertical_press', 'bilateral', 'per_limb', 0, '8-12', [P('front_delts'), S('side_delts'), S('triceps')]],
  ['arnold-press', 'Arnold Press', 'アーノルドプレス', 'compound', 'dumbbell', 'vertical_press', 'bilateral', 'per_limb', 0, '8-12', [P('front_delts'), S('side_delts'), S('triceps')]],
  ['lateral-raise', 'Dumbbell Lateral Raise', 'サイドレイズ', 'isolation', 'dumbbell', 'abduction', 'bilateral', 'per_limb', 0, '12-20', [P('side_delts')]],
  ['cable-lateral-raise', 'Cable Lateral Raise', 'ケーブルサイドレイズ', 'isolation', 'cable', 'abduction', 'unilateral', 'total', 0, '12-20', [P('side_delts')]],
  ['rear-delt-fly', 'Rear Delt Fly', 'リアレイズ', 'isolation', 'dumbbell', 'horizontal_abduction', 'bilateral', 'per_limb', 0, '12-20', [P('rear_delts')]],
  ['machine-shoulder-press', 'Machine Shoulder Press', 'マシンショルダープレス', 'compound', 'machine', 'vertical_press', 'bilateral', 'total', 0, '8-12', [P('front_delts'), S('side_delts'), S('triceps')]],

  // ===== ARMS =====
  ['barbell-curl', 'Barbell Curl', 'バーベルカール', 'isolation', 'barbell', 'elbow_flexion', 'bilateral', 'total', 0, '8-12', [P('biceps'), ST('forearms')]],
  ['dumbbell-curl', 'Dumbbell Curl', 'ダンベルカール', 'isolation', 'dumbbell', 'elbow_flexion', 'bilateral', 'per_limb', 0, '8-12', [P('biceps'), ST('forearms')]],
  ['hammer-curl', 'Hammer Curl', 'ハンマーカール', 'isolation', 'dumbbell', 'elbow_flexion', 'bilateral', 'per_limb', 0, '10-12', [P('biceps'), S('forearms')]],
  ['preacher-curl', 'Preacher Curl', 'プリーチャーカール', 'isolation', 'machine', 'elbow_flexion', 'bilateral', 'total', 0, '10-12', [P('biceps')]],
  ['cable-curl', 'Cable Curl', 'ケーブルカール', 'isolation', 'cable', 'elbow_flexion', 'bilateral', 'total', 0, '10-15', [P('biceps')]],
  ['triceps-pushdown', 'Triceps Pushdown', 'トライセプスプレスダウン', 'isolation', 'cable', 'elbow_extension', 'bilateral', 'total', 0, '10-15', [P('triceps')]],
  ['overhead-triceps-extension', 'Overhead Triceps Extension', 'オーバーヘッドエクステンション', 'isolation', 'dumbbell', 'elbow_extension', 'bilateral', 'total', 0, '10-15', [P('triceps')]],
  ['skull-crusher', 'Skull Crusher', 'スカルクラッシャー', 'isolation', 'barbell', 'elbow_extension', 'bilateral', 'total', 0, '8-12', [P('triceps')]],
  ['close-grip-bench-press', 'Close-Grip Bench Press', 'ナローベンチプレス', 'compound', 'barbell', 'horizontal_press', 'bilateral', 'total', 0, '6-10', [P('triceps'), S('chest'), S('front_delts')]],

  // ===== LEGS =====
  ['back-squat', 'Barbell Back Squat', 'バーベルスクワット', 'compound', 'barbell', 'squat', 'bilateral', 'total', 0, '5-8', [P('quads'), S('glutes'), S('hamstrings'), ST('lower_back')]],
  ['front-squat', 'Front Squat', 'フロントスクワット', 'compound', 'barbell', 'squat', 'bilateral', 'total', 0, '5-8', [P('quads'), S('glutes'), ST('abs')]],
  ['leg-press', 'Leg Press', 'レッグプレス', 'compound', 'machine', 'squat', 'bilateral', 'total', 0, '8-15', [P('quads'), S('glutes'), S('hamstrings')]],
  ['hack-squat', 'Hack Squat', 'ハックスクワット', 'compound', 'machine', 'squat', 'bilateral', 'total', 0, '8-12', [P('quads'), S('glutes')]],
  ['romanian-deadlift', 'Romanian Deadlift', 'ルーマニアンデッドリフト', 'compound', 'barbell', 'hinge', 'bilateral', 'total', 0, '6-10', [P('hamstrings'), S('glutes'), S('lower_back')]],
  ['leg-extension', 'Leg Extension', 'レッグエクステンション', 'isolation', 'machine', 'knee_extension', 'bilateral', 'total', 0, '12-15', [P('quads')]],
  ['leg-curl', 'Leg Curl', 'レッグカール', 'isolation', 'machine', 'knee_flexion', 'bilateral', 'total', 0, '10-15', [P('hamstrings')]],
  ['bulgarian-split-squat', 'Bulgarian Split Squat', 'ブルガリアンスクワット', 'compound', 'dumbbell', 'lunge', 'unilateral', 'total', 0, '8-12', [P('quads'), S('glutes'), S('hamstrings')]],
  ['walking-lunge', 'Walking Lunge', 'ウォーキングランジ', 'compound', 'dumbbell', 'lunge', 'unilateral', 'total', 0, '10-12', [P('quads'), S('glutes'), S('hamstrings')]],
  ['calf-raise', 'Calf Raise', 'カーフレイズ', 'isolation', 'machine', 'ankle_extension', 'bilateral', 'total', 0, '12-20', [P('calves')]],
  ['hip-thrust', 'Barbell Hip Thrust', 'ヒップスラスト', 'compound', 'barbell', 'hinge', 'bilateral', 'total', 0, '8-12', [P('glutes'), S('hamstrings')]],

  // ===== CORE =====
  ['hanging-leg-raise', 'Hanging Leg Raise', 'ハンギングレッグレイズ', 'isolation', 'bodyweight', 'trunk_flexion', 'bilateral', 'total', 1, '10-20', [P('abs'), S('obliques')]],
  ['cable-crunch', 'Cable Crunch', 'ケーブルクランチ', 'isolation', 'cable', 'trunk_flexion', 'bilateral', 'total', 0, '12-20', [P('abs')]],
  ['russian-twist', 'Russian Twist', 'ロシアンツイスト', 'isolation', 'bodyweight', 'trunk_rotation', 'bilateral', 'total', 1, '15-30', [P('obliques'), S('abs')]],
];

const lines = [
  '-- 0004: 種目カタログ拡充(フリーウェイト+マシン定番。生成: tools/gen-exercise-catalog.mjs)',
  '-- INSERT OR IGNORE: 既存 id(0002 seed / backfill)は温存。',
];
for (const [id, en, ja, cat, eq, pat, lat, basis, bw, rep, muscles] of EX) {
  lines.push(
    `INSERT OR IGNORE INTO exercises (id,name_en,name_ja,category,equipment,movement_pattern,laterality,load_basis,is_bodyweight,default_rep_range,gh_exercise_type,is_custom) ` +
      `VALUES (${q(id)},${q(en)},${q(ja)},${q(cat)},${q(eq)},${q(pat)},${q(lat)},${q(basis)},${bw},${q(rep)},'STRENGTH_TRAINING',0);`,
  );
  for (const [mg, role, contrib] of muscles) {
    lines.push(
      `INSERT OR IGNORE INTO exercise_muscles (exercise_id,muscle_group_id,role,contribution) VALUES (${q(id)},${q(mg)},${q(role)},${contrib});`,
    );
  }
}
console.error(`生成: ${EX.length} 種目`);
console.log(lines.join('\n'));
