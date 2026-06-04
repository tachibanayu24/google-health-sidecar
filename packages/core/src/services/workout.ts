// ワークアウト service の集約 barrel。実装は責務別に分割(変更理由を分離):
//  - workout-write.ts    : 書き込み(saveWorkout/deleteWorkout + PR検知/GH push/自動命名)
//  - workout-analytics.ts: 読み取り集計(履歴/部位ボリューム/急性慢性比/停滞検知/カレンダー/頻度)
// 外部(apps/web routes・apps/mcp index・他 service)は従来どおり @ghs/core / './workout' から参照可。

export * from './workout-analytics';
export * from './workout-write';
