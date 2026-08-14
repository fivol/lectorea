import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { paths } from './lib/config.js';
import { openDb, type Db, type PlaylistRow } from './lib/db.js';
import { loadSources, type Sources } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
import { normalize, scoreEntry } from '../shared/search.js';
import type { SearchEntry } from '../shared/schema.js';

/**
 * Local review server for the matching queue.
 *
 * Without this, marking up matches means hand-editing YAML by playlist id —
 * which is torture, and therefore does not get done. The whole point is that a
 * decision costs one keystroke.
 *
 *   1–9  bind to the numbered suggestion
 *   n    not a course
 *   →    skip
 *
 * Decisions are written to data/overrides.yaml, which is committed.
 */

const PORT = Number(process.env.REVIEW_PORT ?? 5174);
const CONFIDENCE_THRESHOLD = 0.75;

type QueueItem = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  videoCount: number;
  year: number | null;
  thumbnail: string | null;
  lectures: string[];
  guess: { courseId: string; confidence: number; method: string } | null;
  suggestions: Array<{ id: string; title: string; domain: string }>;
};

function main(): void {
  const sources = loadSources();
  const db = openDb();
  const entries = courseEntries(sources);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

    if (url.pathname === '/api/queue') {
      const items = buildQueue(db, sources, entries, Number(url.searchParams.get('limit') ?? 40));
      return json(response, { items, remaining: countPending(db, sources) });
    }

    if (url.pathname === '/api/decide' && request.method === 'POST') {
      const body = JSON.parse(await readBody(request)) as {
        playlistId: string;
        courseId: string | null;
      };
      applyDecision(db, body.playlistId, body.courseId);
      return json(response, { ok: true, remaining: countPending(db, sources) });
    }

    if (url.pathname === '/api/search') {
      const query = normalize(url.searchParams.get('q') ?? '');
      return json(response, { items: rank(entries, query, sources, 20) });
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });

  server.listen(PORT, () => {
    console.log(`✓ review server on http://localhost:${PORT}`);
    console.log(`· ${countPending(db, sources)} playlists waiting`);
    console.log('· decisions are written to data/overrides.yaml');
  });
}

/* ─────────────────────────────────  Queue  ─────────────────────────────── */

function courseEntries(sources: Sources): SearchEntry[] {
  return sources.courses.map((course) => ({
    t: 'c' as const,
    id: course.id,
    n: sources.i18n[`course.${course.id}.title`] ?? course.id,
    k: (sources.keywords[`course.${course.id}`] ?? []).map(normalize),
  }));
}

function pendingQuery(sources: Sources): { sql: string; params: unknown[] } {
  const overridden = Object.keys(sources.overrides.matches);
  const holes = overridden.map(() => '?').join(',');
  return {
    sql: `SELECT p.*, m.course_id AS guess_course, m.confidence AS guess_confidence,
                 m.method AS guess_method, c.title AS channel_title
          FROM playlists p
          LEFT JOIN matches m ON m.playlist_id = p.id
          LEFT JOIN channels c ON c.id = p.channel_id
          WHERE p.alive = 1
            AND (m.playlist_id IS NULL OR (m.reviewed = 0 AND m.confidence < ${CONFIDENCE_THRESHOLD}))
            ${overridden.length ? `AND p.id NOT IN (${holes})` : ''}
          ORDER BY p.views DESC`,
    params: overridden,
  };
}

function countPending(db: Db, sources: Sources): number {
  const { sql, params } = pendingQuery(sources);
  return (db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n;
}

function buildQueue(
  db: Db,
  sources: Sources,
  entries: SearchEntry[],
  limit: number
): QueueItem[] {
  const { sql, params } = pendingQuery(sources);
  const rows = db.prepare(`${sql} LIMIT ${limit}`).all(...params) as Array<
    PlaylistRow & {
      guess_course: string | null;
      guess_confidence: number | null;
      guess_method: string | null;
      channel_title: string | null;
    }
  >;

  const lectures = db.prepare(
    `SELECT id, title FROM videos WHERE playlist_id = ? ORDER BY position LIMIT 6`
  );

  return rows.map((row) => {
    const videos = lectures.all(row.id) as Array<{ id: string; title: string }>;
    return {
      id: row.id,
      title: row.title,
      description: (row.description ?? '').slice(0, 300),
      channelTitle: row.channel_title ?? row.channel_id,
      videoCount: row.video_count ?? videos.length,
      year: row.published_at ? new Date(row.published_at).getUTCFullYear() : null,
      thumbnail: videos[0] ? `https://i.ytimg.com/vi/${videos[0].id}/mqdefault.jpg` : null,
      lectures: videos.map((video) => video.title),
      guess: row.guess_course
        ? {
            courseId: row.guess_course,
            confidence: row.guess_confidence ?? 0,
            method: row.guess_method ?? 'rule',
          }
        : null,
      suggestions: rank(entries, normalize(row.title), sources, 9),
    };
  });
}

function rank(
  entries: SearchEntry[],
  query: string,
  sources: Sources,
  limit: number
): Array<{ id: string; title: string; domain: string }> {
  if (!query) return [];
  const scored = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const domains = new Map(sources.courses.map((course) => [course.id, course.domains[0]]));
  return scored.map(({ entry }) => ({
    id: entry.id,
    title: entry.n,
    domain: sources.i18n[`domain.${domains.get(entry.id)}.title`] ?? '',
  }));
}

/* ────────────────────────────────  Decisions  ──────────────────────────── */

function applyDecision(db: Db, playlistId: string, courseId: string | null): void {
  // The database keeps working state; overrides.yaml is the reviewed record and
  // the thing that goes into the pull request.
  db.prepare(
    `INSERT INTO matches (playlist_id, course_id, confidence, method, reviewed, updated_at)
     VALUES (?, ?, 1.0, 'manual', 1, datetime('now'))
     ON CONFLICT(playlist_id) DO UPDATE SET
       course_id = excluded.course_id, confidence = 1.0, method = 'manual',
       reviewed = 1, updated_at = excluded.updated_at`
  ).run(playlistId, courseId);

  const file = path.join(paths.data, 'overrides.yaml');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const header = current.split(/^matches:/m)[0] ?? '';

  const overrides = loadSources().overrides;
  overrides.matches[playlistId] = courseId;

  fs.writeFileSync(
    file,
    `${header}${stringify({
      matches: overrides.matches,
      playlists: overrides.playlists,
      channels: overrides.channels,
    })}`,
    'utf8'
  );
}

/* ──────────────────────────────────  HTTP  ─────────────────────────────── */

function json(response: http.ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
    });
    request.on('end', () => resolve(data || '{}'));
    request.on('error', reject);
  });
}

const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Разметка плейлистов</title>
<style>
  :root { color-scheme: dark; --line:#26304a; }
  body { margin:0; background:#0B0F1A; color:#E8EDF7;
         font:15px/1.5 system-ui, sans-serif; }
  header { padding:12px 20px; border-bottom:1px solid var(--line);
           display:flex; gap:16px; align-items:center; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:0; height:calc(100vh - 53px); }
  section { padding:20px; overflow:auto; }
  section+section { border-left:1px solid var(--line); }
  h1 { font-size:15px; margin:0; font-weight:600; }
  h2 { font-size:18px; margin:0 0 6px; }
  .muted { color:#67718A; font-size:13px; }
  img { width:220px; border-radius:8px; display:block; margin:12px 0; }
  ol { padding-left:0; list-style:none; margin:0; }
  li { margin-bottom:6px; }
  button { display:flex; gap:10px; align-items:center; width:100%; text-align:left;
           background:#141B2D; color:inherit; border:1px solid var(--line);
           border-radius:8px; padding:8px 12px; cursor:pointer; font:inherit; }
  button:hover { border-color:#B7E4C7; }
  kbd { background:#1C2540; border:1px solid var(--line); border-radius:4px;
        padding:1px 7px; font:13px ui-monospace, monospace; }
  .row { display:flex; gap:8px; margin-top:16px; }
  .row button { width:auto; }
  .lectures { font-size:13px; color:#A2ADC4; margin-top:10px; }
  input { width:100%; padding:8px 12px; border-radius:8px; background:#141B2D;
          border:1px solid var(--line); color:inherit; font:inherit; margin-bottom:12px; }
  .guess { border-color:#B7E4C7; }
  .done { padding:60px 20px; text-align:center; }
</style></head><body>
<header><h1>Разметка плейлистов</h1><span class="muted" id="left"></span>
<span class="muted">1–9 привязать · n не курс · → пропустить</span></header>
<main id="app"></main>
<script type="module">
const app = document.getElementById('app');
const left = document.getElementById('left');
let queue = [], index = 0;

async function load() {
  const data = await (await fetch('/api/queue?limit=60')).json();
  queue = data.items; index = 0;
  left.textContent = data.remaining + ' в очереди';
  render();
}

function render() {
  const item = queue[index];
  if (!item) { app.innerHTML = '<div class="done">Очередь пуста. Обновите страницу.</div>'; return; }
  const suggestions = item.suggestions.map((s, i) =>
    '<li><button data-course="' + s.id + '"' +
    (item.guess && item.guess.courseId === s.id ? ' class="guess"' : '') +
    '><kbd>' + (i + 1) + '</kbd><span>' + esc(s.title) +
    ' <span class="muted">' + esc(s.domain) + '</span></span></button></li>').join('');

  app.innerHTML =
    '<section><h2>' + esc(item.title) + '</h2>' +
    '<div class="muted">' + esc(item.channelTitle) + ' · ' + item.videoCount + ' видео' +
    (item.year ? ' · ' + item.year : '') + '</div>' +
    (item.thumbnail ? '<img src="' + item.thumbnail + '" alt="">' : '') +
    '<div class="muted">' + esc(item.description) + '</div>' +
    '<div class="lectures">' + item.lectures.map(esc).join('<br>') + '</div></section>' +
    '<section><input id="q" placeholder="Поиск по курсам…" autocomplete="off">' +
    '<ol id="list">' + suggestions + '</ol>' +
    '<div class="row"><button data-course="" style="width:auto"><kbd>n</kbd>Не курс</button>' +
    '<button data-skip="1" style="width:auto"><kbd>→</kbd>Пропустить</button></div></section>';

  app.querySelectorAll('[data-course]').forEach((button) =>
    button.addEventListener('click', () => decide(button.dataset.course || null)));
  app.querySelector('[data-skip]').addEventListener('click', skip);
  document.getElementById('q').addEventListener('input', search);
}

async function search(event) {
  const value = event.target.value.trim();
  if (!value) return;
  const data = await (await fetch('/api/search?q=' + encodeURIComponent(value))).json();
  document.getElementById('list').innerHTML = data.items.map((s, i) =>
    '<li><button data-course="' + s.id + '"><kbd>' + (i + 1) + '</kbd><span>' + esc(s.title) +
    ' <span class="muted">' + esc(s.domain) + '</span></span></button></li>').join('');
  document.querySelectorAll('#list [data-course]').forEach((button) =>
    button.addEventListener('click', () => decide(button.dataset.course || null)));
}

async function decide(courseId) {
  const item = queue[index];
  if (!item) return;
  const data = await (await fetch('/api/decide', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playlistId: item.id, courseId }),
  })).json();
  left.textContent = data.remaining + ' в очереди';
  skip();
}

function skip() { index += 1; render(); }
function esc(text) { return String(text ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]); }

addEventListener('keydown', (event) => {
  if (event.target.tagName === 'INPUT' && event.key !== 'Escape') return;
  if (event.key >= '1' && event.key <= '9') {
    const button = document.querySelectorAll('#list [data-course]')[Number(event.key) - 1];
    if (button) decide(button.dataset.course);
  }
  if (event.key === 'n') decide(null);
  if (event.key === 'ArrowRight') skip();
  if (event.key === 'Escape') event.target.blur();
});

load();
</script></body></html>`;

try {
  main();
} catch (error) {
  reportRunError(error);
}
