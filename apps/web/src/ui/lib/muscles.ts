import type { Muscle } from 'react-body-highlighter';

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

/**
 * 本アプリ muscle id → react-body-highlighter の slug 群(身体図ハイライト用)。
 * 1筋群が図の複数領域に対応しうる(例: calves=腓腹筋+ヒラメ筋 左右、glutes=臀筋+外転筋)。
 * これで該当筋を鍛えた日に下腿全体・外もも側まで自然に光る。
 */
export const MUSCLE_TO_SLUGS: Record<string, Muscle[]> = {
  chest: ['chest'],
  lats: ['upper-back'],
  traps: ['trapezius'],
  front_delts: ['front-deltoids'],
  side_delts: ['front-deltoids'], // lib に side が無く前部で近似
  rear_delts: ['back-deltoids'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  abs: ['abs'],
  obliques: ['obliques'],
  quads: ['quadriceps'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal', 'abductors'], // 中臀筋は股関節外転筋 → 外転領域も臀で表現
  calves: ['calves', 'left-soleus', 'right-soleus'], // 下腿全体(腓腹筋+ヒラメ筋)
  lower_back: ['lower-back'],
};

/**
 * slug → 本アプリ muscle id(身体図タップ時の逆引き。front-deltoids は前肩を代表に)。
 * 内転筋(adductor)は対応筋群が無いため未登録=タップ無反応(タクソノミ拡張時に対応)。
 */
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
  abductors: 'glutes', // 外転(中臀筋)は臀へ寄せる
  calves: 'calves',
  'left-soleus': 'calves', // ヒラメ筋(下腿)もカーフへ
  'right-soleus': 'calves',
  'lower-back': 'lower_back',
};
