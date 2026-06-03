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

/** 推定エネルギー収支(食事画面 / Home で共有)。BMR 未算出(プロフィール未設定)なら expenditure/balance は null。 */
export function energyBalance(p: {
  weightKg: number | null;
  heightCm: number | null;
  birthYear: number | null;
  sex: 'male' | 'female' | null;
  currentYear: number;
  intakeKcal: number;
  activeKcal: number | null;
}): { bmr: number | null; expenditure: number | null; balance: number | null } {
  const age = p.birthYear ? p.currentYear - p.birthYear : null;
  const bmr = bmrMifflin(p.weightKg, p.heightCm, age, p.sex);
  const expenditure = bmr != null ? bmr + Math.round(p.activeKcal ?? 0) : null;
  const balance = expenditure != null ? p.intakeKcal - expenditure : null;
  return { bmr, expenditure, balance };
}
