import { describe, expect, it } from 'vitest';
import { bandScore, type ScoreTargets, scoreNutrition } from './nutrition-score';

// オーナー cut の目標。
const T: ScoreTargets = { kcal: 1700, protein: 125, fat: 50, carbs: 170, salt: 6, fiber: 21 };

describe('bandScore(台形)', () => {
  const floor = {
    z0: 75,
    i0: 110,
    i1: 225,
    z1: 262.5,
    floorLow: 0.05,
    floorHigh: 0.85,
    downCurve: 'linear' as const,
  };
  it('下限ハード以下は floorLow', () => {
    expect(bandScore(70, floor)).toBe(0.05);
  });
  it('満点帯は 1', () => {
    expect(bandScore(125, floor)).toBe(1);
    expect(bandScore(200, floor)).toBe(1);
  });
  it('不足ランプは線形に上る', () => {
    // 75→110 の中点 92.5 で floorLow と 1 の中間
    expect(bandScore(92.5, floor)).toBeCloseTo(0.05 + 0.95 * 0.5, 5);
  });
  it('過剰は floorHigh まで線形に下る', () => {
    expect(bandScore(262.5, floor)).toBe(0.85);
  });

  it('上限型(塩分)は quad で累進的に下る', () => {
    const ceil = {
      z0: 0,
      i0: 0,
      i1: 6,
      z1: 12,
      floorLow: 1,
      floorHigh: 0,
      downCurve: 'quad' as const,
    };
    expect(bandScore(0, ceil)).toBe(1); // 低い分には満点
    expect(bandScore(6, ceil)).toBe(1); // 目標ちょうど満点
    // 半分超過(9)は線形なら0.5だが quad は (0.5)^2=0.25 減 → 0.75
    expect(bandScore(9, ceil)).toBeCloseTo(0.75, 5);
    expect(bandScore(12, ceil)).toBe(0);
  });
});

describe('scoreNutrition(1日・cut)', () => {
  const day = (totals: Partial<Parameters<typeof scoreNutrition>[0]['totals']>) =>
    scoreNutrition({
      totals: { kcal: 1700, protein: 125, fat: 50, carbs: 170, fiber: 21, saltG: 6, ...totals },
      targets: T,
      phase: 'cut',
      scope: 'day',
    });

  it('全軸オントゥで総合ほぼ満点・ゲートok', () => {
    const r = day({});
    expect(r.overall).toBeGreaterThan(0.95);
    expect(r.calories.gate).toBe('ok');
    expect(r.axes.every((a) => a.zone === 'ideal')).toBe(true);
  });

  it('たんぱく質不足(70g)は protein を急減点・zone=low', () => {
    const r = day({ protein: 70, kcal: 1480 });
    const p = r.axes.find((a) => a.key === 'protein');
    expect(p?.score).toBeLessThanOrEqual(0.05);
    expect(p?.zone).toBe('low');
  });

  it('単日の低脂質(20g)は脂質を罰しない(ゆるい上限=満点)', () => {
    const r = day({ fat: 20, kcal: 1430 });
    const f = r.axes.find((a) => a.key === 'fat');
    expect(f?.score).toBe(1);
    expect(f?.zone).toBe('ideal');
  });

  it('塩分大幅超過(13g)は塩分を減点し、収支致命ゲートで総合に上限0.6', () => {
    const r = day({ saltG: 13 });
    const s = r.axes.find((a) => a.key === 'sodium');
    expect(s?.score).toBeLessThan(0.3);
    expect(r.overall).toBeLessThanOrEqual(0.6);
  });

  it('カロリー大幅超過(>1.25T)は overall に上限0.6', () => {
    const r = day({ kcal: 2300 });
    expect(r.calories.gate).toBe('over');
    expect(r.overall).toBeLessThanOrEqual(0.6);
  });

  it('繊維欠損(null)は軸を—で除外し0にしない', () => {
    const r = day({ fiber: null });
    const fib = r.axes.find((a) => a.key === 'fiber');
    expect(fib?.score).toBeNull();
    expect(fib?.zone).toBe('na');
    // 他軸はオントゥなので総合は高いまま(欠損で潰さない)
    expect(r.overall).toBeGreaterThan(0.9);
  });

  it('糖質は脂質と違い極端な低糖質(50g)を減点する(トレ燃料)', () => {
    const r = day({ carbs: 50, kcal: 1220 });
    const c = r.axes.find((a) => a.key === 'carbs');
    expect(c?.zone).toBe('low');
    expect(c?.score ?? 1).toBeLessThan(0.5);
  });
});

describe('scoreNutrition(カテゴリ・cut)', () => {
  it('1食のたんぱく質20gで満点(絶対バンド)・10gは低スコア', () => {
    const ok = scoreNutrition({
      totals: { kcal: 400, protein: 30, fat: 12, carbs: 40, fiber: 5, saltG: 1.5 },
      targets: T,
      phase: 'cut',
      scope: 'category',
    });
    expect(ok.axes.find((a) => a.key === 'protein')?.score).toBe(1);

    const low = scoreNutrition({
      totals: { kcal: 300, protein: 10, fat: 12, carbs: 40, fiber: 5, saltG: 1.5 },
      targets: T,
      phase: 'cut',
      scope: 'category',
    });
    const p = low.axes.find((a) => a.key === 'protein');
    expect(p?.score ?? 1).toBeLessThan(0.6);
    expect(p?.zone).toBe('low');
  });

  it('カテゴリには収支ゲートをかけない(カロリー超過でも overall を一律上限にしない)', () => {
    const r = scoreNutrition({
      totals: { kcal: 1500, protein: 40, fat: 17, carbs: 57, fiber: 7, saltG: 2 },
      targets: T,
      phase: 'cut',
      scope: 'category',
    });
    // たんぱく質満点・他もバンド内なので総合は高い(day なら kcal ゲートで 0.6 だがカテゴリは別)
    expect(r.overall).toBeGreaterThan(0.6);
  });

  it('カテゴリも塩分を採点(5軸・1食の取り分=target/3≈2gを上限)', () => {
    const light = scoreNutrition({
      totals: { kcal: 400, protein: 30, fat: 12, carbs: 40, fiber: 5, saltG: 1.5 },
      targets: T,
      phase: 'cut',
      scope: 'category',
    });
    const heavy = scoreNutrition({
      totals: { kcal: 600, protein: 30, fat: 18, carbs: 60, fiber: 5, saltG: 5 },
      targets: T,
      phase: 'cut',
      scope: 'category',
    });
    expect(light.axes).toHaveLength(5);
    expect(light.axes.find((a) => a.key === 'sodium')?.score).toBe(1); // 取り分以下=満点
    const hs = heavy.axes.find((a) => a.key === 'sodium');
    expect(hs?.score ?? 1).toBeLessThan(0.6); // 1食5g=塩分過多
    expect(hs?.zone).toBe('high');
  });

  it('取り分は朝<昼<夕(同じ塩分2gでも朝は減点・夕は満点)', () => {
    const meal = { kcal: 500, protein: 30, fat: 16, carbs: 55, fiber: 6, saltG: 2 };
    const bf = scoreNutrition({
      totals: meal,
      targets: T,
      phase: 'cut',
      scope: 'category',
      mealShare: 0.25,
    });
    const dn = scoreNutrition({
      totals: meal,
      targets: T,
      phase: 'cut',
      scope: 'category',
      mealShare: 0.4,
    });
    const bfSalt = bf.axes.find((a) => a.key === 'sodium')?.score ?? 1;
    const dnSalt = dn.axes.find((a) => a.key === 'sodium')?.score ?? 0;
    expect(dnSalt).toBe(1); // 夕(取り分=6×0.4=2.4g)では 2g は満点
    expect(bfSalt).toBeLessThan(1); // 朝(取り分=6×0.25=1.5g)では 2g は取り分超過=減点
    expect(dnSalt).toBeGreaterThan(bfSalt);
  });
});

describe('scoreNutrition(1日・塩分は上限型)', () => {
  it('6g(目標=上限)まで満点、超過で累進減点', () => {
    const at = scoreNutrition({
      totals: { kcal: 1700, protein: 125, fat: 50, carbs: 170, fiber: 21, saltG: 6 },
      targets: T,
      phase: 'cut',
      scope: 'day',
    });
    expect(at.axes.find((a) => a.key === 'sodium')?.score).toBe(1); // 6gまで満点
    // quad累進: 9g(+50%)→0.75、12g(+100%)→0。超過ほど急減。
    const over = scoreNutrition({
      totals: { kcal: 1700, protein: 125, fat: 50, carbs: 170, fiber: 21, saltG: 9 },
      targets: T,
      phase: 'cut',
      scope: 'day',
    });
    const s9 = over.axes.find((a) => a.key === 'sodium')?.score ?? 1;
    expect(s9).toBeLessThan(1);
    expect(s9).toBeCloseTo(0.75, 2);
    const far = scoreNutrition({
      totals: { kcal: 1700, protein: 125, fat: 50, carbs: 170, fiber: 21, saltG: 12 },
      targets: T,
      phase: 'cut',
      scope: 'day',
    });
    expect(far.axes.find((a) => a.key === 'sodium')?.score).toBe(0);
  });
});
