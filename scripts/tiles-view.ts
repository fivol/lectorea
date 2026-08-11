import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Bundles the tile viewer into one self-contained HTML file.
 *
 * Single file on purpose, like the map sandbox: it is opened straight from
 * disk, mailed, or dropped on a static host without a build step. There is no
 * data payload — the collection is code, so bundling the code ships it.
 *
 * esbuild is reached through vite, which already depends on it: the viewer is a
 * tool, and a direct dependency for it would land in every install.
 */

const OUT = process.env.TILES_VIEW_OUT ?? path.join('.tiles', 'collection.html');

const CSS = String.raw`
:root {
  color-scheme: light dark;
  --bg: #eef2f6;
  --panel: #ffffff;
  --panel-edge: #dfe6ee;
  --ink: #16202b;
  --ink-soft: #5b6b7c;
  --ink-faint: #8496a6;
  --accent: #2f6f8f;
  --accent-ink: #ffffff;
  --warn: #a4632a;
  --field: #f2f5f9;
  --radius: 10px;
  --plate: #f6f1e6;
}
:root:not([data-theme="light"]) {
  @media (prefers-color-scheme: dark) {
    --bg: #10161d;
    --panel: #182029;
    --panel-edge: #26313d;
    --ink: #e8eef4;
    --ink-soft: #9fb0c0;
    --ink-faint: #71828f;
    --accent: #62a8c9;
    --accent-ink: #0d1319;
    --warn: #e0a065;
    --field: #121a22;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
body[data-bg="land"]  { --plate: #8ab765; }
body[data-bg="water"] { --plate: #4c8fb4; }
body[data-bg="ink"]   { --plate: #1b232b; }

#app {
  display: grid;
  grid-template-columns: minmax(250px, 300px) 1fr;
  gap: 18px;
  padding: 18px;
  min-height: 100vh;
  align-items: start;
}
@media (max-width: 900px) {
  #app { grid-template-columns: 1fr; }
}

/* ── panel ── */
.panel {
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius);
  padding: 16px;
  position: sticky;
  top: 18px;
  max-height: calc(100vh - 36px);
  overflow-y: auto;
}
.brand h1 { margin: 0 0 4px; font-size: 17px; }
.brand p { margin: 0 0 16px; color: var(--ink-soft); font-size: 12px; }
.panel section { border-top: 1px solid var(--panel-edge); padding-top: 12px; margin-top: 14px; }
.panel h2 { margin: 0 0 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); }
.note { margin: 0 0 10px; font-size: 11.5px; color: var(--ink-faint); }

.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.row label { font-size: 12px; color: var(--ink-soft); }
.stepper { display: flex; align-items: center; gap: 6px; }
.stepper button { width: 28px; }
.seed { min-width: 26px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }

.knob { margin-bottom: 6px; }
.knob-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.knob-head label { font-size: 12px; color: var(--ink-soft); }
.knob-head output { font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--ink-faint); }
input[type="range"] { width: 100%; accent-color: var(--accent); margin: 3px 0 0; }

button, select {
  font: inherit;
  font-size: 12.5px;
  color: var(--ink);
  background: var(--field);
  border: 1px solid var(--panel-edge);
  border-radius: 7px;
  padding: 6px 10px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button.accent { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
select { width: 100%; }
.buttons { display: grid; gap: 7px; }
.toggle { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--ink-soft); cursor: pointer; }

.legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px; font-size: 11px; color: var(--ink-faint); }
.legend span { display: flex; align-items: center; gap: 5px; }
.legend i, .seam i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }

/* ── stage ── */
.stage { min-width: 0; display: grid; gap: 22px; }
.block-head { margin-bottom: 12px; }
.block-head h2 { margin: 0; font-size: 15px; }
.block-head p { margin: 3px 0 0; font-size: 12px; color: var(--ink-faint); max-width: 68ch; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}
.objects { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }

.card {
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius);
  padding: 10px;
  min-width: 0;
}
.card header { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 6px; }
.card h3 { margin: 0; font-size: 13.5px; }
.card code { font-size: 11px; color: var(--ink-faint); }
.card .save { margin-left: auto; padding: 2px 8px; line-height: 1.2; }

.plate {
  background: var(--plate);
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  padding: 8px;
  cursor: pointer;
}
.plate svg { display: block; max-width: 100%; height: auto; }
.stage-plate { cursor: default; }

.badges { display: flex; flex-wrap: wrap; gap: 5px; }
.badge {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--field);
  color: var(--ink-soft);
  border: 1px solid var(--panel-edge);
}
.badge.part { border-color: var(--accent); color: var(--accent); }
.badge.warn { border-color: var(--warn); color: var(--warn); }

.facts { margin-top: 7px; display: grid; gap: 4px; }
.facts p { margin: 0; font-size: 11.5px; color: var(--ink-soft); }
.facts .opt { color: var(--ink-faint); }
.facts .seam { display: flex; align-items: center; gap: 6px; }

.strip { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.step { margin: 0; display: grid; gap: 6px; justify-items: center; }
.step figcaption { font-size: 11.5px; color: var(--ink-faint); }

.recipe { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11.5px; }
.recipe td { padding: 3px 4px; border-top: 1px solid var(--panel-edge); vertical-align: top; }
.recipe .axial { color: var(--ink-faint); font-variant-numeric: tabular-nums; white-space: nowrap; width: 1%; }
.chip-mini {
  display: inline-block;
  margin: 1px 3px 1px 0;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--field);
  border: 1px solid var(--panel-edge);
}
details summary { cursor: pointer; font-size: 11.5px; color: var(--ink-faint); margin-top: 8px; }
`;

/**
 * Only the part of esbuild this script calls. Declared here rather than
 * imported: esbuild is reached through vite at runtime and is not a direct
 * dependency, so `typeof import('esbuild')` would fail `tsc` for everyone.
 */
type Bundler = {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};

async function main(): Promise<void> {
  const require = createRequire(await import.meta.resolve('vite'));
  const esbuild = require('esbuild') as Bundler;

  const bundle = await esbuild.build({
    entryPoints: [path.join('sandbox', 'tiles', 'main.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
  const script = bundle.outputFiles[0].text;

  const head = `<title>Коллекция плиток — Lectorea</title>
<style>${CSS}</style>`;
  const body = `<div id="app"></div>
<script>${script}</script>`;

  // The hosted flavour is wrapped in a document skeleton by the host, so it
  // ships the page's contents only. The two are otherwise identical.
  const html = process.argv.includes('--fragment')
    ? `${head}\n${body}\n`
    : `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${body}
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  console.log(`✓ ${OUT} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
