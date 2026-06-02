/** 食事区分(meal_type)の表示順と日本語ラベル。複数画面/レポートで共有する単一ソース。 */
export const MEAL_ORDER = [
  'Breakfast',
  'MorningSnack',
  'Lunch',
  'AfternoonSnack',
  'Dinner',
  'Anytime',
];

export function mealTypeJa(t: string): string {
  return (
    {
      Breakfast: '朝食',
      MorningSnack: '午前間食',
      Lunch: '昼食',
      AfternoonSnack: '午後間食',
      Dinner: '夕食',
      Anytime: '間食',
    }[t] ?? t
  );
}
