import { describe, expect, it } from 'vitest';
import { aggregateRoutineMuscles, representativeSets } from './routine';

const links = new Map([
  [
    'bench',
    [
      { muscle_group_id: 'chest', role: 'primary', contribution: 1 },
      { muscle_group_id: 'triceps', role: 'secondary', contribution: 0.5 },
      { muscle_group_id: 'front_delts', role: 'secondary', contribution: 0.5 },
    ],
  ],
  ['lateral-raise', [{ muscle_group_id: 'side_delts', role: 'primary', contribution: 1 }]],
]);

describe('representativeSets', () => {
  it('sets_max 優先、無ければ min、両方 null は 1', () => {
    expect(representativeSets(4, 5)).toBe(5);
    expect(representativeSets(3, null)).toBe(3);
    expect(representativeSets(null, null)).toBe(1);
  });
});

describe('aggregateRoutineMuscles', () => {
  it('計画セット数で重み付け・primary のみ sets 計上・intensity 正規化', () => {
    const r = aggregateRoutineMuscles(
      [
        { exercise_id: 'bench', sets: 4 },
        { exercise_id: 'lateral-raise', sets: 3 },
      ],
      links,
    );
    const chest = r.find((m) => m.muscle === 'chest')!;
    const tri = r.find((m) => m.muscle === 'triceps')!;
    const side = r.find((m) => m.muscle === 'side_delts')!;
    expect(chest.sets).toBe(4); // primary 4セット
    expect(tri.sets).toBe(0); // secondary は sets に計上しない
    expect(side.sets).toBe(3);
    // intensity: chest=4*1=4(最大)→1.0, triceps=4*0.5=2→0.5
    expect(chest.intensity).toBe(1);
    expect(tri.intensity).toBe(0.5);
    // 降順ソート・intensity>0 のみ
    expect(r[0]!.muscle).toBe('chest');
  });

  it('未知 exercise_id はスキップ、sets<=0 は1扱い', () => {
    const r = aggregateRoutineMuscles(
      [
        { exercise_id: 'unknown', sets: 5 },
        { exercise_id: 'lateral-raise', sets: 0 },
      ],
      links,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.muscle).toBe('side_delts');
    expect(r[0]!.sets).toBe(1); // sets<=0 → 1
  });
});
