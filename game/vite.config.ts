import { defineConfig } from 'vite';

// Relative asset paths, so the build works from any folder: GitHub Pages serves it under
// /<repo>/, not at the site root.
export default defineConfig({
  base: './',
});
