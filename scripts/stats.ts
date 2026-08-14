import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { collectStats } from './lib/stats.js';
import { renderPage } from './lib/stats-html.js';
import { reportRunError } from './lib/exit.js';

/**
 * The project dashboard: coverage, the shape of the graph, the material, the
 * crawl and the hand markup, on one local page.
 *
 * Local on purpose. Half of what is worth watching lives in `data/cache.db` —
 * the quota, the queue, the matching confidence — and that file is not
 * committed and never reaches the site. Publishing the page would mean either
 * dropping those numbers or shipping the cache, and the numbers are the point.
 *
 *   pnpm stats            → .stats/dashboard.html
 *   pnpm stats --serve    → http://localhost:5175, recomputed on every reload
 *   pnpm stats --json     → the same figures as JSON, for a diff or a CI check
 */

// Clear of 5173–5175, where vite and the review server land: a dashboard is
// the thing you keep open while those two are running.
const PORT = Number(process.env.STATS_PORT ?? process.env.PORT ?? 5180);
const OUT = process.env.STATS_OUT ?? path.join('.stats', 'dashboard.html');

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(collectStats(), null, 2)}\n`);
    return;
  }

  if (argv.includes('--serve')) {
    const server = http.createServer((request, response) => {
      if (request.url === '/favicon.ico') {
        response.writeHead(204).end();
        return;
      }
      // Recomputed per request rather than once at startup: the page is meant
      // to be left open while a crawl or a build runs, and a reload is the
      // whole interface.
      const html = renderPage(collectStats());
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(html);
    });
    server.listen(PORT, () => {
      console.log(`✓ статистика на http://localhost:${PORT}`);
      console.log('· перезагрузка страницы пересчитывает всё заново');
    });
    return;
  }

  const html = renderPage(collectStats());
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  console.log(`✓ ${OUT} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
}

try {
  main();
} catch (error) {
  reportRunError(error);
}
