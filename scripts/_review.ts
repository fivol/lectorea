/**
 * Scratch: hand the published bindings to a reader, in batches, and take the
 * verdicts back.
 *
 * There is no nightly path: the reading is done by subagents inside a session,
 * which is why this is a scratch script and not a pipeline step. A headless
 * version would want an API key the repository does not have, and until it
 * exists the gate is safe in the right direction — an unconfirmed binding does
 * not publish, so the catalogue goes quiet rather than wrong. Two modes:
 *
 *   pnpm tsx scripts/_review.ts export <dir> [--size=150]   # batches + the course list
 *   pnpm tsx scripts/_review.ts import <dir>                # verdict files → cache.db
 *
 * A batch is deliberately small enough to read whole: the failure mode this
 * catches is a title that names one course and teaches another, which is only
 * visible when the reader is actually reading rather than skimming a wall.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './lib/db.js';
import { reportRunError } from './lib/exit.js';
import { loadSources } from './lib/sources.js';

type Row = {
  id: string;
  title: string;
  videos: number;
  course: string;
  channel: string;
};

function exportBatches(dir: string, size: number): void {
  // Writable on purpose: a readonly open skips the schema pass, so the verdicts
  // table would not exist yet on the first run — see the note in lib/db.ts.
  const db = openDb();
  const sources = loadSources();

  // A hand decision already outranks every pass, so it needs no reader; and a
  // row already judged is not asked twice — unless the binding has moved under
  // it, because the answer was about the pairing. `course_id` is null on the
  // rows written before it existed, and those are taken as still current.
  const settled = new Set(Object.keys(sources.overrides.matches));
  const judged = new Map(
    (
      db.prepare(`SELECT playlist_id, course_id FROM verdicts`).all() as Array<{
        playlist_id: string;
        course_id: string | null;
      }>
    ).map((r) => [r.playlist_id, r.course_id])
  );

  const rows = (
    db
      .prepare(
        `SELECT p.id, p.title, p.video_count AS videos, m.course_id AS course,
                COALESCE(c.title, p.channel_id) AS channel
           FROM playlists p
           JOIN matches m ON m.playlist_id = p.id
           LEFT JOIN channels c ON c.id = p.channel_id
          WHERE p.alive = 1 AND m.course_id IS NOT NULL AND m.confidence >= 0.75
            AND m.reviewed = 0 AND p.title IS NOT NULL`
      )
      .all() as Row[]
  ).filter((r) => {
    if (settled.has(r.id)) return false;
    if (!judged.has(r.id)) return true;
    const judgedAs = judged.get(r.id);
    return judgedAs != null && judgedAs !== r.course;
  });

  fs.mkdirSync(dir, { recursive: true });

  // The course list is the reader's whole frame of reference: "wrong course"
  // is only answerable against the set of courses that exist.
  const courses = sources.courses
    .map((c) => {
      const names = (sources.courseNames.get(c.id) ?? []).slice(0, 3).join(' / ');
      return `${c.id}\t${names}`;
    })
    .sort();
  fs.writeFileSync(path.join(dir, 'courses.txt'), courses.join('\n') + '\n');

  let n = 0;
  for (let at = 0; at < rows.length; at += size) {
    const batch = rows.slice(at, at + size);
    const file = path.join(dir, `batch-${String(++n).padStart(3, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify(batch, null, 1));
  }
  console.log(`· ${rows.length} bindings to review → ${n} batches of ${size} in ${dir}`);
  console.log(`· the course list every verdict is judged against: ${dir}/courses.txt`);
  db.close();
}

function importVerdicts(dir: string): void {
  const db = openDb();
  const sources = loadSources();
  const courseIds = new Set(sources.courses.map((c) => c.id));

  const write = db.prepare(
    `INSERT INTO verdicts (playlist_id, verdict, course_id, suggested_course, note, model, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       verdict = excluded.verdict, course_id = excluded.course_id,
       suggested_course = excluded.suggested_course,
       note = excluded.note, model = excluded.model, checked_at = excluded.checked_at`
  );

  /*
   * The course each batch put in front of the reader. Read back off the batch
   * file rather than off `matches`, because between an export and its import
   * the rules may have moved the binding — and what the verdict is *about* is
   * the line the reader actually saw.
   */
  const asked = new Map<string, string>();
  for (const file of fs.readdirSync(dir).filter((f) => /^batch-.*\.json$/.test(f))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Row[]) {
      asked.set(row.id, row.course);
    }
  }

  const files = fs.readdirSync(dir).filter((f) => /^verdicts-.*\.json$/.test(f));
  const counts: Record<string, number> = {};
  let written = 0;
  let dropped = 0;
  const now = new Date().toISOString();

  for (const file of files) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Array<{
      id: string;
      verdict: string;
      course?: string | null;
      note?: string | null;
    }>;
    for (const row of rows) {
      if (!['ok', 'wrong-course', 'not-a-course', 'unsure'].includes(row.verdict)) {
        dropped += 1;
        continue;
      }
      // A suggested course that is not a course of this catalogue is not a
      // suggestion, it is a typo — and silently storing it would publish a
      // binding to nothing.
      const suggested = row.course && courseIds.has(row.course) ? row.course : null;
      const judged = asked.get(row.id) ?? null;
      if (row.verdict === 'wrong-course' && !suggested) {
        write.run(row.id, 'not-a-course', judged, null, row.note ?? null, 'agent', now);
        counts['not-a-course'] = (counts['not-a-course'] ?? 0) + 1;
        written += 1;
        continue;
      }
      write.run(row.id, row.verdict, judged, suggested, row.note ?? null, 'agent', now);
      counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
      written += 1;
    }
  }

  console.log(`· ${files.length} verdict files · ${written} verdicts written`);
  for (const [verdict, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(5)}  ${verdict}`);
  }
  if (dropped) console.log(`· ${dropped} rows dropped: verdict not one of the four`);
  db.close();
}

function main(): void {
  const [mode, dir, ...rest] = process.argv.slice(2);
  const size = Number(rest.find((a) => a.startsWith('--size='))?.slice(7) ?? 150) || 150;
  if (mode === 'export' && dir) return exportBatches(dir, size);
  if (mode === 'import' && dir) return importVerdicts(dir);
  console.log('usage: _review.ts export <dir> [--size=150] | import <dir>');
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  reportRunError(error);
}
