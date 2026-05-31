/** 筋部位の表示名と並び(seed の muscle_groups.id に一致)。UI 共通。 */
export const MUSCLE_GROUPS: Array<{ id: string; ja: string; region: string }> = [
  { id: 'chest', ja: '胸', region: '押す' },
  { id: 'front_delts', ja: '前肩', region: '押す' },
  { id: 'side_delts', ja: '中肩', region: '押す' },
  { id: 'triceps', ja: '三頭', region: '押す' },
  { id: 'lats', ja: '広背', region: '引く' },
  { id: 'traps', ja: '僧帽', region: '引く' },
  { id: 'rear_delts', ja: '後肩', region: '引く' },
  { id: 'biceps', ja: '二頭', region: '引く' },
  { id: 'forearms', ja: '前腕', region: '引く' },
  { id: 'quads', ja: '大腿四頭', region: '脚' },
  { id: 'hamstrings', ja: 'ハム', region: '脚' },
  { id: 'glutes', ja: '臀', region: '脚' },
  { id: 'calves', ja: 'ふくらはぎ', region: '脚' },
  { id: 'abs', ja: '腹直', region: '体幹' },
  { id: 'obliques', ja: '腹斜', region: '体幹' },
  { id: 'lower_back', ja: '脊柱起立', region: '体幹' },
];

export const MUSCLE_JA: Record<string, string> = Object.fromEntries(
  MUSCLE_GROUPS.map((m) => [m.id, m.ja]),
);
