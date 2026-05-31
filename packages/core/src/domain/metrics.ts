import { roundTo, toKg } from '../util/units';
import type { E1rmFormula, LoadBasis, LoadMode, PrBasis, SetType, WeightUnit } from './enums';

/**
 * セット計算の純粋関数(§8.1/§8.2)。集計は必ず kg 正規化してから行う(混在対応)。
 * UI/MCP には raw(entry_value+unit)とこの計算済み値(常に kg)の両方を返す。
 */

export interface LoadInput {
  loadMode: LoadMode;
  entryValue: number | null;
  entryUnit: WeightUnit;
  loadBasis: LoadBasis;
  isBodyweight: boolean;
  bwFactor: number;
  bodyweightKg: number | null;
}

/** 片側/合計の乗数(per_limb/per_side は両側合算)。 */
export function limbMultiplier(loadBasis: LoadBasis): 1 | 2 {
  return loadBasis === 'per_limb' || loadBasis === 'per_side' ? 2 : 1;
}

/** 1セットの実効荷重(kg)。§8.1 の load_kg。 */
export function computeLoadKg(input: LoadInput): number {
  const mult = limbMultiplier(input.loadBasis);
  const extKg = input.entryValue === null ? 0 : toKg(input.entryValue, input.entryUnit) * mult;
  const bw = input.bodyweightKg ?? 0;
  const bwContribution = bw * input.bwFactor;
  switch (input.loadMode) {
    case 'weighted':
      return extKg + (input.isBodyweight ? bwContribution : 0);
    case 'bodyweight':
      return bwContribution;
    case 'assisted':
      return Math.max(0, bwContribution - extKg);
  }
}

/** セットボリューム(kg)= 実効荷重 × レップ。reps 不明なら 0。 */
export function computeSetVolumeKg(loadKg: number, reps: number | null): number {
  if (reps === null || reps <= 0) return 0;
  return roundTo(loadKg * reps, 2);
}

/**
 * 推定1RM(kg)。reps<=12 のみ対象、それ超は誤差増のため null(参考値扱い)。
 * 既定 Epley、代替 Brzycki。
 */
export function computeE1rmKg(
  loadKg: number,
  reps: number | null,
  formula: E1rmFormula = 'epley',
): number | null {
  if (reps === null || reps <= 0 || reps > 12 || loadKg <= 0) return null;
  if (reps === 1) return roundTo(loadKg, 2);
  const e1rm = formula === 'brzycki' ? loadKg * (36 / (37 - reps)) : loadKg * (1 + reps / 30); // epley
  return roundTo(e1rm, 2);
}

/**
 * PR の確度根拠(§8.2)。RPE付き or AMRAP/failure を確定、RPEレスは暫定。
 * is_provisional = (pr_basis === 'rpe_less')。
 */
export function prBasisOf(setType: SetType, rpe: number | null): PrBasis {
  if (setType === 'amrap') return 'amrap';
  if (setType === 'failure') return 'failure';
  if (rpe !== null) return 'rpe_backed';
  return 'rpe_less';
}

export function isProvisional(basis: PrBasis): boolean {
  return basis === 'rpe_less';
}

/** 集計に含めるセット種別(warmup を除外, §8.1)。 */
export function countsTowardVolume(setType: SetType): boolean {
  return setType !== 'warmup';
}

/** ヒートマップ stimulus の set_type 重み(§8.3)。 */
export function setTypeStimulusWeight(setType: SetType): number {
  switch (setType) {
    case 'warmup':
      return 0.3;
    case 'failure':
      return 1.1;
    case 'drop':
    case 'backoff':
      return 0.8;
    default:
      return 1.0;
  }
}
