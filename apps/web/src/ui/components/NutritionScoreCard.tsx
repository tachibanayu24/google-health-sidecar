import { lazy, Suspense } from 'react';
import type { NutritionScopeScore } from '../lib/api';
import { Card } from './Card';
import { Loading } from './state';

// recharts は内部で lazy(eager バンドルに入れない)。
const NutritionScoreChart = lazy(() =>
  import('./NutritionScoreChart').then((m) => ({ default: m.NutritionScoreChart })),
);

/**
 * 栄養スコアのカード(読み取り専用)。1日画面は day、カテゴリ画面はそのカテゴリの score を渡す。
 * 画像エクスポートは MealReport 側にレーダーを同梱(本カードに保存ボタンは置かない)。
 */
export function NutritionScoreCard({
  score,
  isCategory,
}: {
  score: NutritionScopeScore;
  isCategory?: boolean;
}) {
  return (
    <Card title="栄養スコア(対目標)">
      <Suspense fallback={<Loading />}>
        <NutritionScoreChart score={score} />
      </Suspense>
      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        マクロの目標適合度のみ(実測)。脂質の質・血糖負荷・食事の質は未採点 —
        トレーナーAIが会話で判断します。
        {isCategory && ' 塩分・カロリーは1日単位で評価します。'}
      </p>
    </Card>
  );
}
