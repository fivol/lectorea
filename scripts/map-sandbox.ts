import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadSources } from './lib/sources.js';

/**
 * Bundles the map sandbox into one self-contained HTML file.
 *
 * Single file on purpose: it is opened straight from disk, mailed, or dropped
 * on a static host without a build step, and it has to keep working when the
 * repo is not around. Data and script are inlined for the same reason.
 *
 * esbuild is reached through vite, which already depends on it — the sandbox is
 * a tool, and adding a direct dependency for it would land in every install.
 */

const OUT = process.env.MAP_SANDBOX_OUT ?? path.join('.map-poc', 'sandbox.html');

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
  --good: #1d7a5f;
  --warn: #a4632a;
  --field: #f2f5f9;
  --radius: 10px;
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
    --good: #5fd0a8;
    --warn: #e0a065;
    --field: #121a22;
  }
}
:root[data-theme="dark"] {
  --bg: #10161d;
  --panel: #182029;
  --panel-edge: #26313d;
  --ink: #e8eef4;
  --ink-soft: #9fb0c0;
  --ink-faint: #71828f;
  --accent: #62a8c9;
  --accent-ink: #0d1319;
  --good: #5fd0a8;
  --warn: #e0a065;
  --field: #121a22;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
#app {
  display: grid;
  grid-template-columns: minmax(260px, 320px) 1fr;
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

.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.row label { font-size: 12px; color: var(--ink-soft); }
.stepper { display: flex; align-items: center; gap: 6px; }
.stepper button { width: 28px; }
.seed { min-width: 30px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }

.knob { margin-bottom: 11px; }
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
button.ghost { width: 100%; margin-top: 10px; color: var(--ink-faint); }
.buttons { display: grid; gap: 7px; }
.toggle { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; color: var(--ink-soft); }

/* ── stage ── */
.stage { min-width: 0; }
.metrics { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip {
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: 999px;
  padding: 5px 12px;
  display: flex;
  gap: 7px;
  align-items: baseline;
  font-size: 12px;
}
.chip-label { color: var(--ink-faint); }
.chip-value { font-weight: 600; font-variant-numeric: tabular-nums; }
.chip.good .chip-value { color: var(--good); }
.chip.warn .chip-value { color: var(--warn); }

.canvas {
  position: relative;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius);
  overflow: hidden;
  aspect-ratio: var(--ratio, 1.71);
}
.canvas svg { display: block; width: 100%; height: 100%; }

/* Labels are DOM, not SVG: real typography, wrapping and room for an icon. */
.labels { position: absolute; inset: 0; pointer-events: none; }
.label {
  position: absolute;
  transform: translate(-50%, -50%);
  text-align: center;
  white-space: nowrap;
  line-height: 1.15;
}
.label-title {
  display: block;
  font-weight: 700;
  letter-spacing: .02em;
  text-transform: uppercase;
  color: #172431;
  /* A halo rather than an outline: -webkit-text-stroke paints over the glyph
     and thickens it, while a ring of shadows sits behind it. */
  text-shadow:
    0 0 3px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95),
    1px 0 2px rgba(255,255,255,.9), -1px 0 2px rgba(255,255,255,.9),
    0 1px 2px rgba(255,255,255,.9), 0 -1px 2px rgba(255,255,255,.9);
}
.label-meta {
  display: none;
  font-size: .78em;
  font-weight: 600;
  color: #33485c;
  text-shadow: 0 0 3px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,.95);
}
.label.is-active .label-meta { display: block; }
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

  // Read from the sources rather than from a build output: the sandbox has to
  // work in a fresh checkout, before anything has been built.
  const sources = loadSources();
  const counts = new Map<string, number>();
  for (const course of sources.courses) {
    for (const domain of course.domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const domains = sources.domains.map((domain) => ({
    ...domain,
    courseCount: counts.get(domain.id) ?? 0,
  }));

  // Only the three fields the graph is built from. The sandbox recomputes the
  // graph itself so that the classification knobs are live, and shipping whole
  // course records for that would be most of the file.
  const courses = sources.courses.map((course) => ({
    id: course.id,
    domains: course.domains,
    deps: course.deps,
  }));

  const allTitles = JSON.parse(
    fs.readFileSync(path.join('data', 'i18n', 'ru.json'), 'utf8')
  ) as Record<string, string>;

  // Only the domain titles travel — the file also carries every course string,
  // and inlining those would triple the sandbox for nothing.
  const titles = Object.fromEntries(
    Object.entries(allTitles).filter(([key]) => key.startsWith('domain.'))
  );

  const bundle = await esbuild.build({
    entryPoints: [path.join('sandbox', 'map', 'main.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
  const script = bundle.outputFiles[0].text;

  const payload = JSON.stringify({ domains, courses, titles })
    // Keep the JSON from closing the surrounding <script> element.
    .replace(/</g, '\\u003c');

  const head = `<title>Песочница карты — Lectorea</title>
<style>${CSS}</style>`;
  const body = `<div id="app"></div>
<script>window.__MAP_DATA__ = ${payload};</script>
<script>${script}</script>`;

  // The hosted flavour is wrapped in a document skeleton by the host, so it
  // ships the page's contents only. The two are otherwise identical, which is
  // the point: what gets published is what runs from disk.
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
  console.log(`✓ ${OUT} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · ${domains.length} областей`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
