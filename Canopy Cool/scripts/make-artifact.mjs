// Builds dist-artifact/canopycool.html: the whole app, styles and campus data in one file (for a Claude artifact).
// Usage: npx vite build -c vite.artifact.config.ts && node scripts/make-artifact.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dir = new URL('../dist-artifact/', import.meta.url);
const assets = readdirSync(new URL('assets/', dir));
const js = readFileSync(new URL(`assets/${assets.find((f) => f.endsWith('.js'))}`, dir), 'utf8');
const css = readFileSync(new URL(`assets/${assets.find((f) => f.endsWith('.css'))}`, dir), 'utf8');
const data = readFileSync(new URL('../public/data/nus.json', import.meta.url), 'utf8');

const html = `<title>CanopyCool NUS</title>
<style>${css}</style>
<div id="root"></div>
<script type="application/json" id="nus-data">${data.replaceAll('</', '<\\/')}</script>
<script type="module">${js.replaceAll('</script', '<\\/script')}</script>
`;
writeFileSync(new URL('canopycool.html', dir), html);
console.log('canopycool.html', (html.length / 1e6).toFixed(2), 'MB');
