/**
 * 表示用のエネルギー収支ヘルパ(client)。式は core/domain/energy.ts の bmrMifflin と同一。
 * 標準式(Mifflin-St Jeor)で安定のため軽量に複製。総消費 ≈ BMR + 活動消費(GH active_energy)。
 * すべて推定(BMRは式・活動はデバイス)。より正確な維持カロリーは MCP get_nutrition_status(逆算TDEE)。
 */
export function bmrMifflin(
  weightKg: number | null,
  heightCm: number | null,
  age: number | null,
  sex: 'male' | 'female' | null,
): number | null {
  if (weightKg == null || heightCm == null || age == null || sex == null) return null;
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) return null;
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161));
}
