/**
 * 筋部位の表示名と並び(seed の muscle_groups.id に一致)。UI 共通の単一ソース。
 * ラベルは正式名(解剖学的)で全画面統一(Record チップ / Training ボリューム / シェア画像)。
 */
export const MUSCLE_GROUPS: Array<{ id: string; ja: string }> = [
  { id: 'chest', ja: '胸' },
  { id: 'front_delts', ja: '前部三角筋' },
  { id: 'side_delts', ja: '中部三角筋' },
  { id: 'triceps', ja: '上腕三頭筋' },
  { id: 'lats', ja: '広背筋' },
  { id: 'traps', ja: '僧帽筋' },
  { id: 'rear_delts', ja: '後部三角筋' },
  { id: 'biceps', ja: '上腕二頭筋' },
  { id: 'forearms', ja: '前腕' },
  { id: 'quads', ja: '大腿四頭筋' },
  { id: 'hamstrings', ja: 'ハムストリング' },
  { id: 'glutes', ja: '臀筋' },
  { id: 'calves', ja: 'ふくらはぎ' },
  { id: 'abs', ja: '腹直筋' },
  { id: 'obliques', ja: '腹斜筋' },
  { id: 'lower_back', ja: '脊柱起立筋' },
];

export const MUSCLE_JA: Record<string, string> = Object.fromEntries(
  MUSCLE_GROUPS.map((m) => [m.id, m.ja]),
);

/** 本アプリ muscle id → react-body-highlighter の slug(身体図ハイライト/クリック用)。 */
export const MUSCLE_TO_SLUG: Record<string, string> = {
  chest: 'chest',
  lats: 'upper-back',
  traps: 'trapezius',
  front_delts: 'front-deltoids',
  side_delts: 'front-deltoids', // lib に side が無く前部で近似
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

/** slug → 本アプリ muscle id(身体図クリック時の逆引き。front-deltoids は前肩を代表に)。 */
export const SLUG_TO_MUSCLE: Record<string, string> = {
  chest: 'chest',
  'upper-back': 'lats',
  trapezius: 'traps',
  'front-deltoids': 'front_delts',
  'back-deltoids': 'rear_delts',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearms',
  abs: 'abs',
  obliques: 'obliques',
  quadriceps: 'quads',
  hamstring: 'hamstrings',
  gluteal: 'glutes',
  calves: 'calves',
  'lower-back': 'lower_back',
};
