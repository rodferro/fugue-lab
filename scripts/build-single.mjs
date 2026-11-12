// Builds dist/fugue-lab.html: one self-contained page (no bundler needed).
// Transpiles each module with the TypeScript compiler API, concatenates them
// in dependency order with import/export statements removed, and inlines the CSS.
// Module-level names must stay unique across files for this to work.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = require(path.join(process.env.TS_PATH ?? '', 'typescript')); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const order = [
  'src/engine/model.ts', 'src/engine/rng.ts', 'src/engine/theory.ts', 'src/engine/analyze.ts', 'src/engine/answer.ts',
  'src/engine/harmony.ts', 'src/engine/counterpoint.ts', 'src/engine/fugue.ts', 'src/engine/midi.ts', 'src/engine/report.ts',
  'src/app/examples.ts', 'src/app/theme.ts', 'src/app/audio.ts', 'src/app/zip.ts', 'src/app/pianoRoll.ts', 'src/app/fugueView.ts', 'src/app/main.ts',
];
let js = '';
for (const f of order) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const body = out
    .replace(/^import[^;]*;\s*$/gm, '')
    .replace(/^export \{[^}]*\};?\s*$/gm, '')
    .replace(/^export (default )?/gm, '');
  js += `// ---- ${f}\n${body}\n`;
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = html.split('<!--HEAD-START-->')[1].split('<!--HEAD-END-->')[0].trim();
const body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0].trim();
const css = fs.readFileSync(path.join(root, 'src/app/styles.css'), 'utf8');
const page = `${head}\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${js}\n</script>\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/fugue-lab.html'), page);
console.log(`dist/fugue-lab.html ${(page.length / 1024).toFixed(1)} KB`);
