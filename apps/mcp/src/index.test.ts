import { describe, expect, it } from 'vitest';
import { REGISTRARS } from './index';

/**
 * ツール登録の contract(回帰ガード)。buildServer を機能群の register 関数に分解した際の
 * 唯一のリスク=register の呼び忘れ/重複によるサイレントなツール集合変化を検出する。
 * 期待集合を変えるとき(ツール追加/削除)はここも更新する=意図的な変更だけが通る。
 */
const EXPECTED_TOOLS = [
  // read(16)
  'get_settings',
  'get_exercise_history',
  'get_muscle_volume',
  'get_muscle_calendar',
  'get_training_frequency',
  'get_recent_sessions',
  'get_recent_prs',
  'get_weekly_summary',
  'get_readiness',
  'get_nutrition_status',
  'get_nutrition_score',
  'get_plateau_indicators',
  'get_meal_recovery_correlation',
  'search_exercises',
  'autocomplete_foods',
  'get_day',
  // write(10)
  'log_meal',
  'log_workout',
  'log_weight',
  'set_nutrition_target',
  'get_meal_presets',
  'save_meal_preset',
  'log_preset',
  'delete_meal_preset',
  'log_meal_photo',
  'set_workout_note',
  // destructive(1)
  'delete_recent_log',
  // routines(4)
  'get_routines',
  'get_routine',
  'save_routine',
  'delete_routine',
];

describe('MCP tool registration contract', () => {
  it('REGISTRARS は期待30ツールを過不足・重複なく登録する', () => {
    const names: string[] = [];
    // registerTool の name だけ記録するモック(コールバックは実行しない=DB/env 不要)。
    const mockServer = { registerTool: (name: string) => names.push(name) };
    const fakeEnv = {} as never;
    for (const register of REGISTRARS) {
      (register as (s: unknown, e: unknown) => void)(mockServer, fakeEnv);
    }
    expect(names.length).toBe(EXPECTED_TOOLS.length); // 重複・欠落なし(register 呼び忘れ検出)
    expect([...names].sort()).toEqual([...EXPECTED_TOOLS].sort());
  });
});
