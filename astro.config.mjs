// @ts-check
import { defineConfig } from 'astro/config';
import path from 'path';
import { fileURLToPath } from 'url';
import tailwind from '@astrojs/tailwind';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// https://astro.build/config
// export default defineConfig({
//   integrations: [tailwind()],
//   vite: {
//     resolve: {
//       alias: {
//         '@': path.resolve(__dirname, './src'),
//       },
//     },
//   },
// });

export default defineConfig({
  site: 'https://wmwolf.github.io',
  base: '/pepper_scorer',
  integrations: [tailwind()],
  vite: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  },
});