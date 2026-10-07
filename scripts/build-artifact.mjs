// Builds a single-file page (dist/artifact/cerberus.html) for hosting as a claude.ai Artifact.
// Game code is bundled inline; three.js is loaded from jsDelivr through an import map.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const THREE = '0.180.0';
const out = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  external: ['three', 'three/addons/*'],
});
const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
const css = readFileSync('src/style.css', 'utf8');
const html = readFileSync('index.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const importmap = {
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${THREE}/build/three.module.js`,
    'three/addons/': `https://cdn.jsdelivr.net/npm/three@${THREE}/examples/jsm/`,
  },
};
const page = `<title>Cerberus Training Arena</title>
<style>${css}</style>
${body}
<script type="importmap">${JSON.stringify(importmap)}</script>
<script type="module">${js}</script>
`;
mkdirSync('dist/artifact', { recursive: true });
writeFileSync('dist/artifact/cerberus.html', page);
console.log(`dist/artifact/cerberus.html ${(page.length / 1024).toFixed(0)} KB`);
