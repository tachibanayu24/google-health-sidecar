import { defineConfig } from 'vitest/config';

// テスト専用の最小構成(vite.config の Cloudflare/React プラグインを読み込まない)。
// 純粋ロジック(lib/*)の単体テスト用。DOM/JSX は対象外。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
