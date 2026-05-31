import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// React SPA(src/ui)+ Worker API(src/index.ts)を1プロジェクトで。
// cloudflare() が wrangler.jsonc を読み、dev では workerd 内で Worker を実行。
export default defineConfig({
  plugins: [react(), cloudflare(), tailwindcss()],
});
