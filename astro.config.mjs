// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use different base paths for development vs production
// Development uses root path to avoid Firebase auth redirect issues
// Production uses /pepper_scorer for deployment to subdirectory
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('dev');

export default defineConfig({
  site: 'https://billwolf.space',
  base: isDev ? '/' : '/pepper_scorer',
  integrations: [tailwind()],
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  },
});