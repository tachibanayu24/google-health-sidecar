import { bmrMifflin, type Sex } from '@ghs/core/domain/energy';

/**
 * 表示用のエネルギー収支ヘルパ(client)。BMR は core/domain/energy の bmrMifflin(単一ソース)を使う。
 * 総消費 ≈ BMR + 活動消費(GH active_energy)。すべて推定(BMRは式・活動はデバイス)。
 * より正確な維持カロリーは MCP get_nutrition_status(逆算TDEE)。
 */

/** 推定エネルギー収支(食事画面 / Home で共有)。BMR 未算出(プロフィール未設定)なら expenditure/balance は null。 */
export function energyBalance(p: {
  weightKg: number | null;
  heightCm: number | null;
  birthYear: number | null;
  sex: Sex | null;
  currentYear: number;
  intakeKcal: number;
  activeKcal: number | null;
}): { bmr: number | null; expenditure: number | null; balance: number | null } {
  const age = p.birthYear ? p.currentYear - p.birthYear : null;
  const bmr = bmrMifflin({ weightKg: p.weightKg, heightCm: p.heightCm, age, sex: p.sex });
  const expenditure = bmr != null ? bmr + Math.round(p.activeKcal ?? 0) : null;
  const balance = expenditure != null ? p.intakeKcal - expenditure : null;
  return { bmr, expenditure, balance };
}
