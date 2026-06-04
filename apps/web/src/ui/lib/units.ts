// 単位ヘルパは core(単一ソース)をサブパスで re-export。barrel でなくサブパス
// (util/units は type-only 依存=ランタイム空)を使い、クライアントバンドルに core 全体を引き込まない。
// 塩↔ナトリウム換算(係数2.54)と数値整形 round は core と完全同一。
export {
  roundTo as round,
  saltGFromSodiumMg as saltFromSodiumMg,
  sodiumMgFromSalt,
} from '@ghs/core/util/units';
