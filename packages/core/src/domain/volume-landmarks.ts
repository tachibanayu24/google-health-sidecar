/**
 * ボリュームランドマーク(MEV/MAV/MRV)と 急性/慢性ボリューム比 — 決定的な純関数(DB/IO非依存)。
 * 設計: design.md §8.9 / enhancements.md ⑧⑨。
 *
 *  - ランドマーク帯: 週間ハードセット数を MEV(最低有効)..MAV(最大適応=sweet spot)..MRV(最大回復可能)
 *    の帯に位置づけ、「伸びやすいゾーンに入っているか」を出す。用量反応そのものはメタ解析で支持
 *    (Schoenfeld 2017 / Pelland 2024)。ただし部位別の具体値は RP/Israetel のヒューリスティック=
 *    「ガイドライン・個人差ありの出発点」であり検証済み個人閾値ではない(UI/MCP で明示)。
 *  - 急性/慢性比: 直近7日 ÷ 直近28日の週平均。**怪我予測(ACWR)としては学術的に否定されているため
 *    その看板は使わない**(Impellizzeri 2020 / Lolli 2019)。漸進性過負荷の「記述指標」として、
 *    急増/定常/低下 を事実として示すだけ。怪我リスクや 0.8–1.3 の魔法ゾーンは主張しない。
 */

export interface VolumeLandmarks {
  mev: number | null;
  mavLow: number | null;
  mavHigh: number | null;
  mrv: number | null;
}

/** 帯のどこにいるか。null=この部位はガイドライン未設定(obliques/lower_back 等)。 */
export type LandmarkZone = 'under' | 'building' | 'optimal' | 'high' | 'over';

export function volumeLandmarkZone(sets: number, l: VolumeLandmarks): LandmarkZone | null {
  const { mev, mavLow, mavHigh, mrv } = l;
  if (mev == null || mavLow == null || mavHigh == null || mrv == null) return null;
  if (sets < mev) return 'under'; // MEV未満=維持以下/伸びにくい
  if (sets < mavLow) return 'building'; // MEV..MAV下限=効くが余地あり
  if (sets <= mavHigh) return 'optimal'; // MAV帯=最も伸びやすい sweet spot
  if (sets <= mrv) return 'high'; // MAV超..MRV=多い(回復可能だが上限近い)
  return 'over'; // MRV超=回復超過の恐れ(やり損)
}

/** 急性/慢性ボリューム比の記述ラベル(怪我予測ではない)。 */
export type LoadTrend = 'detraining' | 'steady' | 'ramping' | 'spiking';

/**
 * acute7 = 直近7日のセット数。chronicWeekly = 直近28日の週平均セット数。
 * ratio = acute7 / chronicWeekly(慢性がほぼ0=比較不能なら null)。
 */
export function acuteChronicRatio(acute7: number, chronicWeekly: number): number | null {
  if (chronicWeekly < 1) return null; // 慢性ベースが薄い部位は比を出さない(ノイズ回避)
  return Math.round((acute7 / chronicWeekly) * 100) / 100;
}

export function classifyLoadTrend(ratio: number | null): LoadTrend | null {
  if (ratio == null) return null;
  if (ratio < 0.8) return 'detraining'; // 直近で落ちている/サボり
  if (ratio <= 1.3) return 'steady'; // 慢性とおおむね同水準
  if (ratio <= 1.5) return 'ramping'; // 漸増(意図的な増量なら正常)
  return 'spiking'; // 急増(意図的か確認の価値)
}
