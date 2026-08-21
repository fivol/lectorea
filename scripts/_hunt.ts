/**
 * Scratch: YouTube's own search, aimed at the courses the catalogue is thinnest in.
 *
 *   pnpm tsx scripts/_hunt.ts out.json [--min=4] [--budget=6000] [--kind=playlist]
 *   pnpm tsx scripts/_hunt.ts out.json --courses=poetics,ancient-art --apply
 *   pnpm tsx scripts/_hunt.ts out.json --variant=all --min=99 --budget=40000
 *
 * `search.list` costs 100 units — a hundred crawled playlists, or forty walked
 * ones — which is why every other seam in docs/harvest.md comes first and why
 * `lib/youtube.ts` keeps it off unless a caller says `allowSearch`. This script
 * is the one caller, and it exists for the one case where the arithmetic
 * inverts: **quota that would otherwise expire unspent.** A key resets at
 * midnight Pacific whether or not the day used it, so at the end of an
 * iteration — the video queue drained, `data:mine` returning nothing — the
 * choice is not "search or crawl", it is "search or lose it".
 *
 * What it does, in the order that keeps the price down:
 *
 *   1. reads the built catalogue for the courses with the fewest playlists —
 *      the brief is written by the holes, not by hand;
 *   2. asks search for each of them, in every language the course has a name
 *      in, one page per query and no paging (page two of a query is worth less
 *      than page one of the next question, and costs the same);
 *   3. throws away everything already in cache.db — free, and usually most of
 *      the answer, since search happily returns what the crawl already owns;
 *   4. resolves what is left through `playlists.list`, 50 to a unit, which is
 *      the only way to learn how many videos a result has;
 *   5. judges every survivor with the same rule pass `data:match` uses, so the
 *      report says which course a candidate would bind to rather than leaving
 *      a human to guess from a title.
 *
 * **Every question it asks is written down**, in the `searches` table, and a
 * question already there is not asked again — so two hunts a month apart do not
 * buy the same first page twice, and neither do a laptop and the nightly job
 * (the table is merged on restore, not replaced). `--variant=all` walks every
 * phrasing in `QUALIFIERS` in order, which is how a day with quota left over
 * spends it: the run stops when the budget, the quota or the *unasked*
 * questions run out. `--repeat` asks anyway, for the rare case where the answer
 * itself is expected to have moved.
 *
 * Nothing is written without `--apply`, and even then it writes only into the
 * crawl queue: channels are printed as candidates for `data/channels.yaml`,
 * because adding one is a judgement about a whole channel and the bar is in
 * docs/harvest.md. The playlists it queues are ordinary tier-3 material — the
 * five tiers in lib/queue.ts are what stop a wide harvest from eating the next
 * day's quota.
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './lib/config.js';
import { openDb, type Db, type PlaylistRow } from './lib/db.js';
import { queuePlaylists } from './lib/queue.js';
import { buildKeywordIndex, cleanTitle, isNotACourse, judgeByRules } from './lib/rules.js';
import { qualifiersFor, searchNames } from './lib/questions.js';
import { loadAliases, loadDictionary, loadSources, type Sources } from './lib/sources.js';
import {
  createClient,
  QuotaExceededError,
  SEARCH_COST,
  TransientError,
  type SearchHit,
  type YoutubeClient,
} from './lib/youtube.js';

/** A playlist shorter than this is a fragment of a course, not a course. */
const MIN_VIDEOS = 8;

/**
 * Above this, a playlist is a bin until a person says otherwise.
 *
 * Real courses are 10–90 videos; the things above 150 are «Лекции по литературе
 * (разное)», a channel's whole back catalogue, or a talk show — and they are
 * the expensive end besides, at a unit per fifty videos. They stay in the
 * report, because the exception exists (a filmed year of school physics is 200
 * lessons), and they stay out of `--apply`, because the rule pass would bind
 * one to a course on its title and nothing downstream would ever ask again.
 */
const BIN_VIDEOS = 150;

const REGION: Record<string, string> = { ru: 'RU', en: 'US' };

type Args = {
  out: string;
  min: number;
  budget: number;
  kinds: Array<'playlist' | 'channel'>;
  courses: string[];
  apply: boolean;
  /**
   * Which phrasing of the query to use — see `QUALIFIERS`; `all` walks them in
   * order, which is what a day with quota to burn wants: the first phrasing of
   * every course before the second phrasing of any of it.
   */
  variant: number | 'all';
  /** Ask questions the `searches` table says have already been paid for. */
  repeat: boolean;
  /** An earlier report to carry on from, instead of asking search again. */
  from?: string;
};

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const out = argv.find((a) => !a.startsWith('--'));
  if (!out) throw new Error('Usage: pnpm tsx scripts/_hunt.ts <out.json> [--min=4] [--budget=6000]');
  const kind = flag('kind') ?? 'playlist';
  return {
    out,
    min: Number(flag('min') ?? 4),
    budget: Number(flag('budget') ?? 6000),
    kinds: kind === 'both' ? ['playlist', 'channel'] : [kind as 'playlist' | 'channel'],
    courses: (flag('courses') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    apply: argv.includes('--apply'),
    variant: flag('variant') === 'all' ? 'all' : Number(flag('variant') ?? 0),
    repeat: argv.includes('--repeat'),
    from: flag('from'),
  };
}

/* ─────────────────────────────  The brief  ──────────────────────────────── */

type Target = {
  courseId: string;
  playlists: number;
  /** From the built catalogue: what phrasing the material is published under. */
  stage?: string;
  names: Array<{ lang: string; name: string }>;
};

/**
 * Which courses to ask about, and under what names.
 *
 * `playlistCount` comes from the built catalogue rather than from `matches`,
 * because that is the number the site actually shows: a course with nine weak
 * guesses against it is empty to a reader. The names come from the same
 * dictionaries the rule pass reads, so a course is searched for in every
 * language it has a name in — which for this catalogue is the whole point, as
 * the fields it is thinnest in are the ones English lists never cover.
 */
function brief(args: Args): Target[] {
  const file = path.join(paths.outData, 'courses.json');
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing — run \`make data\` first: the brief is written by it.`);
  }
  const built = (
    JSON.parse(fs.readFileSync(file, 'utf8')) as {
      courses: Array<{ id: string; playlistCount: number; stage?: string }>;
    }
  ).courses;
  const counts = new Map(built.map((course) => [course.id, course.playlistCount]));
  const stages = new Map(built.map((course) => [course.id, course.stage]));

  const chosen = args.courses.length
    ? args.courses
    : built
        .filter((course) => course.playlistCount < args.min)
        .sort((a, b) => a.playlistCount - b.playlistCount)
        .map((course) => course.id);

  const dictionaries = ['ru', 'en'].map((lang) => ({
    lang,
    i18n: loadDictionary(lang),
    aliases: loadAliases(lang),
  }));

  return chosen.map((courseId) => {
    const names: Array<{ lang: string; name: string }> = [];
    const stage = stages.get(courseId);
    for (const { lang, i18n, aliases } of dictionaries) {
      for (const name of searchNames(
        i18n[`course.${courseId}.title`],
        aliases[`course.${courseId}`] ?? [],
        stage
      )) {
        names.push({ lang, name });
      }
    }
    return { courseId, playlists: counts.get(courseId) ?? 0, stage, names };
  });
}

/* ──────────────────────────────  The search  ────────────────────────────── */

type Query = { courseId: string; lang: string; kind: 'playlist' | 'channel'; q: string };

function queries(targets: Target[], kinds: Args['kinds'], variant: Args['variant']): Query[] {
  const widest = Math.max(
    ...targets.flatMap((target) =>
      target.names.map(({ lang }) => qualifiersFor(lang, target.stage).length)
    ),
    0
  );
  const rounds = variant === 'all' ? [...Array(widest).keys()] : [variant];
  const seen = new Set<string>();
  const list: Query[] = [];
  // Variant-major, and that is the whole reason `all` is not a loop around the
  // script: the first phrasing of every course is worth more than the second
  // phrasing of a third of them, so a run cut short by the budget is cut where
  // the answers are already thinnest.
  for (const round of rounds) {
    for (const target of targets) {
      for (const { lang, name } of target.names) {
        for (const kind of kinds) {
          const phrasings = qualifiersFor(lang, target.stage);
          if (round >= phrasings.length) continue;
          const q = `${name} ${phrasings[round]}`.trim();
          const key = `${kind}:${q.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ courseId: target.courseId, lang, kind, q });
        }
      }
    }
  }
  return list;
}

/** The id a query is billed under — see the `searches` table in lib/db.ts. */
function askedKey(query: Query): string {
  return `${query.kind}:${query.q.toLowerCase()}`;
}

/**
 * Drops the questions some earlier run already paid a hundred units for.
 *
 * Search returns a ranked first page that barely moves from one week to the
 * next, so the second copy of an answer carries no information and costs
 * exactly what the first did. Before this, the only thing standing between a
 * hunt and re-buying its predecessor's answers was whoever ran it remembering
 * which courses the last one covered and passing a different `--variant`.
 */
function unasked(db: Db, list: Query[]): { fresh: Query[]; skipped: number } {
  const asked = new Set(
    (db.prepare(`SELECT id FROM searches`).all() as Array<{ id: string }>).map((row) => row.id)
  );
  const fresh = list.filter((query) => !asked.has(askedKey(query)));
  return { fresh, skipped: list.length - fresh.length };
}

/** Writes down a question that has now been paid for, whatever it returned. */
function recordSearch(db: Db, query: Query, hits: number): void {
  db.prepare(
    `INSERT INTO searches (id, q, kind, lang, course_id, hits, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET hits = excluded.hits, checked_at = excluded.checked_at`
  ).run(askedKey(query), query.q, query.kind, query.lang, query.courseId, hits, new Date().toISOString());
}

type Found = { hit: SearchHit; from: Query };

/**
 * Runs the queries until the budget, the quota or the list runs out.
 *
 * The budget is checked before each call rather than after, so the run stops
 * one query short of overrunning it instead of one query past.
 */
async function runQueries(
  db: Db,
  api: YoutubeClient,
  list: Query[],
  budget: number
): Promise<{ found: Found[]; spent: number; ran: number }> {
  const found: Found[] = [];
  let ran = 0;
  // Read off the ledger rather than counted here. The failure paths do not
  // agree on whether a unit was spent — a rate limit is charged for and a
  // "no key has room" is not — and a budget kept by guessing which is which
  // would be wrong in the direction that overruns it.
  const before = api.spent();
  const spent = (): number => api.spent() - before;

  for (const query of list) {
    if (spent() + SEARCH_COST > budget) {
      console.log(`· budget reached after ${ran} queries — ${list.length - ran} not asked`);
      break;
    }
    // Twice, and only for a rate limit. Everywhere else in this pipeline a
    // transient failure costs one unit and the queue retries it later; here the
    // unit is already spent when the 403 arrives, so giving up on a burst limit
    // throws away a hundred of them and asks nothing. Waiting a second and
    // asking again spends a hundred more and gets the answer, which is the
    // better of the two trades.
    let hits: SearchHit[] | undefined;
    let failure: unknown;
    for (let attempt = 0; attempt < 2 && !hits; attempt += 1) {
      try {
        if (attempt) await new Promise((resume) => setTimeout(resume, 2000));
        hits = await api.search(query.q, {
          kind: query.kind,
          lang: query.lang,
          region: REGION[query.lang],
        });
      } catch (error) {
        failure = error;
        if (!(error instanceof TransientError)) break;
      }
    }

    if (hits) {
      ran += 1;
      // Written down on the answer, not on the charge. A query that was billed
      // and threw left this run with nothing to show for it, and a question
      // whose answer nobody holds is worth asking again; one that came back is
      // not, however many runs later somebody points a hunt at the same course.
      recordSearch(db, query, hits.length);
      for (const hit of hits) found.push({ hit, from: query });
      console.log(
        `  ${String(hits.length).padStart(2)} ${query.kind}s · ${query.courseId} · «${query.q}»`
      );
      continue;
    }
    if (failure instanceof QuotaExceededError) {
      console.log('· quota is out — stopping with what the run already has');
      break;
    }
    console.log(`  ✗ «${query.q}»: ${String(failure)}`);
  }
  return { found, spent: spent(), ran };
}

/* ──────────────────────────────  The vetting  ───────────────────────────── */

type Candidate = {
  id: string;
  title: string;
  videos: number;
  channelId: string;
  channelTitle: string;
  forCourse: string;
  verdict: string;
  boundTo?: string;
  confidence?: number;
  /** Whether `--apply` would queue it, and when not, why not. */
  accept: 'yes' | 'unclaimed' | 'bin' | 'collection' | 'mirror';
  /** What `playlistOwnership` found, once the ownership pass has run. */
  ownShare?: number;
  /** The channel that made the videos, when it is not the one that listed them. */
  realOwner?: { id: string; title: string; share: number };
};

/**
 * Which candidates are worth the crawl's money.
 *
 * `unclaimed` is the one that matters. It means no course of this catalogue is
 * named in the title in any language — and the rule pass reads nothing but the
 * title, so no later run will decide differently on its own. Queueing one buys
 * a walk of its videos, two units and up, for a playlist the site can never
 * show. Search returns these by the dozen because it answers the *subject* and
 * not the question: «Лекции по литературе (разное)» is a fair answer to a
 * query about poetics and is not a course in it.
 *
 * `undecided` is queued despite binding to nothing, because it is the opposite
 * case: the title names courses and cannot choose between them, which is a
 * question for `data:review` and exactly the sort the review queue is for.
 */
function acceptability(verdict: string, videos: number): Candidate['accept'] {
  if (verdict !== 'match' && verdict !== 'undecided') return 'unclaimed';
  return videos > BIN_VIDEOS ? 'bin' : 'yes';
}

/**
 * What the rule pass would say about a title, without a database row to say it
 * about. Everything but the title is what `judgeByRules` ignores, and giving it
 * a real row would mean writing one — which is the thing this run must not do
 * before a human has looked.
 */
function asRow(id: string, title: string, videos: number): PlaylistRow {
  return {
    id,
    channel_id: 'searched',
    title,
    description: null,
    video_count: videos,
    published_at: null,
    views: null,
    likes: null,
    comments: null,
    lang: null,
    captions: null,
    total_seconds: null,
    median_seconds: null,
    last_video_at: null,
    stats_fetched_at: null,
    alive: 1,
    checked_at: null,
  } as PlaylistRow;
}

async function vet(
  db: Db,
  api: YoutubeClient,
  found: Found[],
  sources: Sources
): Promise<{ candidates: Candidate[]; known: number; short: number; refused: number }> {
  const index = buildKeywordIndex(sources);
  const inCache = new Set(
    (db.prepare(`SELECT id FROM playlists`).all() as Array<{ id: string }>).map((row) => row.id)
  );

  /** id → the query that found it first; a hit found by two queries is one id. */
  const wanted = new Map<string, Query>();
  let known = 0;
  for (const { hit, from } of found) {
    if (hit.kind !== 'playlist') continue;
    if (inCache.has(hit.id)) {
      known += 1;
      continue;
    }
    if (!wanted.has(hit.id)) wanted.set(hit.id, from);
  }

  console.log(`· ${wanted.size} playlists are new, ${known} already in the cache`);
  if (!wanted.size) return { candidates: [], known, short: 0, refused: 0 };

  const items = await api.playlists([...wanted.keys()]);
  const candidates: Candidate[] = [];
  let short = 0;
  let refused = 0;

  for (const item of items) {
    const videos = item.contentDetails.itemCount;
    const from = wanted.get(item.id);
    if (!from) continue;
    if (videos < MIN_VIDEOS) {
      short += 1;
      continue;
    }
    // The same refusal the crawl would apply, applied before the crawl pays:
    // a title `NOT_A_COURSE` catches is tier 4 in the queue and is never shown,
    // so queueing it buys a refusal at two units apiece.
    if (isNotACourse(cleanTitle(item.snippet.title))) {
      refused += 1;
      continue;
    }
    const verdict = judgeByRules(asRow(item.id, item.snippet.title, videos), index);
    candidates.push({
      id: item.id,
      title: item.snippet.title,
      videos,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      forCourse: from.courseId,
      verdict: verdict.kind,
      boundTo: verdict.kind === 'match' ? verdict.courseId : undefined,
      confidence: verdict.kind === 'match' ? verdict.confidence : undefined,
      accept: acceptability(verdict.kind, videos),
    });
  }

  return { candidates, known, short, refused };
}

/**
 * Every stored candidate, judged again by the rules as they stand now.
 *
 * This is what makes `--from` worth having. A hunt is where `lib/rules.ts`
 * learns what a wide seam drags in — the exam-prep brands of 2026-08-15 came
 * out of one — and a rule written half an hour after the search must reach the
 * candidates the search already paid for. Ownership is left alone: it is a fact
 * about who uploaded the videos and no rule changes it.
 */
function rejudge(candidates: Candidate[], sources: Sources): number {
  const index = buildKeywordIndex(sources);
  let changed = 0;

  for (const candidate of candidates) {
    const before = candidate.accept;
    const settled = candidate.accept === 'mirror' || candidate.accept === 'collection';

    if (isNotACourse(cleanTitle(candidate.title))) {
      candidate.verdict = 'not-a-course';
      candidate.boundTo = undefined;
      candidate.confidence = undefined;
      candidate.accept = 'unclaimed';
    } else {
      const verdict = judgeByRules(asRow(candidate.id, candidate.title, candidate.videos), index);
      candidate.verdict = verdict.kind;
      candidate.boundTo = verdict.kind === 'match' ? verdict.courseId : undefined;
      candidate.confidence = verdict.kind === 'match' ? verdict.confidence : undefined;
      candidate.accept = settled
        ? candidate.accept
        : acceptability(verdict.kind, candidate.videos);
    }
    if (candidate.accept !== before) changed += 1;
  }
  return changed;
}

/* ────────────────────────────  Whose course is it  ─────────────────────── */

/** Below this share of its own videos, a playlist is not the author's course. */
const OWN_SHARE = 0.5;

/** A single outside channel owning this much of a playlist *is* the course. */
const MIRROR_SHARE = 0.6;

/**
 * The pass that separates a course from a bag of bookmarks, at 1 unit apiece.
 *
 * Search is very good at finding a playlist called «Linguistics» with fifty
 * videos in it and no way to tell that its owner collected them from forty
 * other channels. A title says nothing about this and neither does a video
 * count; the owner of each video says all of it, and it is one page.
 *
 * There are three answers and only one of them is a refusal:
 *
 *   own material   the channel made what it listed — a course, taken as one;
 *   mirror         one outside channel made almost all of it. The playlist is
 *                  the wrong door to it, since the crawl would file the course
 *                  under whoever collected it — but the channel that *did* make
 *                  it is the best candidate this whole hunt produces, and is
 *                  carried into the channel list instead;
 *   collection     many owners, no author. Dropped: there is no course here,
 *                  only somebody's watch list.
 */
async function classifyOwnership(
  db: Db,
  api: YoutubeClient,
  candidates: Candidate[]
): Promise<{ probed: number; own: number; mirrors: number; collections: number }> {
  const counts = { probed: 0, own: 0, mirrors: 0, collections: 0 };
  // The same row `data:authors` writes, from the same call. Without it the unit
  // this hunt spends buys an answer that lives in a JSON report and nowhere the
  // pipeline can see, so the nightly authors pass re-buys it the first night any
  // of these playlists publishes — 8913 of them on 2026-08-18. The answer does
  // not change: a playlist does not stop being somebody's bookmarks.
  const remember = db.prepare(
    `INSERT INTO ownership (playlist_id, sampled, own_share, kind, owner_id, owner_title, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       sampled = excluded.sampled, own_share = excluded.own_share, kind = excluded.kind,
       owner_id = excluded.owner_id, owner_title = excluded.owner_title,
       checked_at = excluded.checked_at`
  );

  for (const candidate of candidates) {
    let ownership;
    try {
      ownership = await api.playlistOwnership(candidate.id);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        console.log(`· quota out after ${counts.probed} ownership probes — the rest stay unjudged`);
        break;
      }
      continue;
    }
    counts.probed += 1;
    if (!ownership.sampled) continue;

    const share = ownership.own / ownership.sampled;
    candidate.ownShare = share;
    const [top] = ownership.foreign;
    const topShare = top ? top.count / ownership.sampled : 0;
    const kind =
      share >= OWN_SHARE ? 'own' : top && topShare >= MIRROR_SHARE ? 'mirror' : 'collection';
    const owner = kind === 'mirror' && top ? top : null;
    remember.run(
      candidate.id,
      ownership.sampled,
      share,
      kind,
      owner?.id ?? null,
      owner?.title ?? null,
      new Date().toISOString()
    );

    if (kind === 'own') {
      counts.own += 1;
      continue;
    }
    if (kind === 'mirror' && top) {
      candidate.accept = 'mirror';
      candidate.realOwner = { id: top.id, title: top.title, share: topShare };
      counts.mirrors += 1;
    } else {
      candidate.accept = 'collection';
      counts.collections += 1;
    }
  }

  return counts;
}

/* ──────────────────────────────  The report  ────────────────────────────── */

/**
 * Channels the hunt kept finding and `channels.yaml` has never heard of.
 *
 * The same signal `_holes.ts` reads off the catalogue's own decisions, one step
 * earlier: a channel that owns three course-like playlists across two different
 * subjects is a channel whose whole list is worth 1 unit to walk. It is printed
 * and never written — the bar is docs/harvest.md and a person applies it.
 */
/**
 * Every form of a channel `channels.yaml` already lists.
 *
 * The file is written in handles because a handle is readable, and everything
 * the API answers with is a `UC…` id — so a set built from the file alone says
 * "not listed" about YaleCourses and puts a channel the catalogue has crawled
 * for months at the top of a list of things to add. The cache is what closes
 * that: discovery resolved each handle once and wrote both down.
 */
function alreadyListed(db: Db, sources: Sources): Set<string> {
  const listed = new Set(sources.channels.map((channel) => channel.id.toLowerCase()));
  const resolve = db.prepare(`SELECT id, handle FROM channels WHERE lower(handle) = ?`);
  for (const channel of sources.channels) {
    const row = resolve.get(channel.id.toLowerCase()) as { id: string } | undefined;
    if (row) listed.add(row.id.toLowerCase());
  }
  return listed;
}

function channelCandidates(
  db: Db,
  candidates: Candidate[],
  mirrors: Candidate[],
  channelHits: Found[],
  sources: Sources
): Array<{
  id: string;
  title: string;
  playlists: number;
  courses: string[];
  titles: string[];
  viaMirror: number;
}> {
  const listed = alreadyListed(db, sources);
  const byChannel = new Map<
    string,
    {
      id: string;
      title: string;
      playlists: number;
      courses: Set<string>;
      titles: string[];
      viaMirror: number;
    }
  >();
  const blank = (id: string, title: string) => ({
    id,
    title,
    playlists: 0,
    courses: new Set<string>(),
    titles: [],
    viaMirror: 0,
  });

  for (const candidate of candidates) {
    const entry = byChannel.get(candidate.channelId) ?? blank(candidate.channelId, candidate.channelTitle);
    entry.playlists += 1;
    entry.courses.add(candidate.forCourse);
    if (entry.titles.length < 6) entry.titles.push(`${candidate.videos}× ${candidate.title}`);
    byChannel.set(candidate.channelId, entry);
  }

  // The whole point of paying for the ownership pass. A mirror is a refused
  // playlist and a *named* channel: somebody went to the trouble of collecting
  // a course, which is a recommendation, and the channel that made it is the
  // one the catalogue should be crawling instead of the collector.
  for (const mirror of mirrors) {
    if (!mirror.realOwner) continue;
    const entry = byChannel.get(mirror.realOwner.id) ?? blank(mirror.realOwner.id, mirror.realOwner.title);
    entry.viaMirror += 1;
    entry.courses.add(mirror.forCourse);
    if (entry.titles.length < 6) entry.titles.push(`↳ ${mirror.videos}× ${mirror.title}`);
    byChannel.set(mirror.realOwner.id, entry);
  }

  // A channel search answers with channels directly; they have no playlists to
  // count yet, so they enter with zero and are ranked below anything the
  // playlist search actually found material on.
  //
  // What ranks them against *each other* is the course that asked. Dropping the
  // query here once cost a 70 000-unit hunt its whole ordering: every entry was
  // built blank, so `courses.length` was 0 for all 21 011 of them and the sort
  // fell through to insertion order. A channel three different subjects return
  // is a faculty channel; one a single query returned is usually noise.
  for (const { hit, from } of channelHits) {
    if (hit.kind !== 'channel') continue;
    const entry = byChannel.get(hit.id) ?? blank(hit.id, hit.title);
    entry.courses.add(from.courseId);
    byChannel.set(hit.id, entry);
  }

  return [...byChannel.values()]
    .filter((entry) => !listed.has(entry.id.toLowerCase()))
    .map((entry) => ({ ...entry, courses: [...entry.courses] }))
    .sort(
      (a, b) =>
        b.playlists + b.viaMirror - (a.playlists + a.viaMirror) ||
        b.courses.length - a.courses.length
    );
}

/* ────────────────────────────────  The run  ─────────────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sources = loadSources();
  const db = openDb();
  const api = createClient(db, { allowSearch: true });

  /**
   * Search is the only expensive half, so a report is resumable: `--from` picks
   * the candidates back up and re-judges them for nothing. That matters because
   * the cheap half is where the thinking happens — a rule this run learns is a
   * rule the last run's four thousand units should get the benefit of, and
   * asking search the same 46 questions again to obtain the same 46 answers is
   * the one thing quota must never be spent on twice.
   */
  let targets: Target[];
  let candidates: Candidate[];
  let found: Found[] = [];
  let spent = 0;
  let ran = 0;
  let known = 0;
  let short = 0;
  let refused = 0;

  if (args.from) {
    const earlier = JSON.parse(fs.readFileSync(args.from, 'utf8')) as {
      targets: Target[];
      candidates: Candidate[];
    };
    targets = earlier.targets;
    candidates = earlier.candidates;
    const changed = rejudge(candidates, sources);
    console.log(
      `· carrying on from ${args.from}: ${candidates.length} candidates, no search` +
        `${changed ? `; the rules moved ${changed} of them` : ''}`
    );
  } else {
    targets = brief(args);
    const all = queries(targets, args.kinds, args.variant);
    const { fresh, skipped } = args.repeat
      ? { fresh: all, skipped: 0 }
      : unasked(db, all);
    const list = fresh;
    const affordable = Math.min(args.budget, api.remaining());
    console.log(
      `· ${targets.length} courses under ${args.min} playlists → ${list.length} queries ` +
        `(${list.length * SEARCH_COST} units); budget ${affordable}, quota left ${api.remaining()}`
    );
    if (skipped) {
      console.log(`· ${skipped} questions skipped — already bought, see the searches table`);
    }
    console.log();

    const searched = await runQueries(db, api, list, affordable);
    found = searched.found;
    spent = searched.spent;
    ran = searched.ran;
    console.log();

    const vetted = await vet(db, api, found, sources);
    candidates = vetted.candidates;
    known = vetted.known;
    short = vetted.short;
    refused = vetted.refused;
  }

  // Only the ones `--apply` would otherwise queue: a unit apiece is worth
  // spending to keep a bag of bookmarks out of a course, and worth nothing on a
  // playlist already dropped for naming no course at all.
  // `ownShare` set means an earlier run already bought this answer.
  const worthProbing = candidates.filter(
    (candidate) => candidate.accept === 'yes' && candidate.ownShare === undefined
  );
  console.log(`\n· ownership: ${worthProbing.length} probes, 1 unit each`);
  const ownership = await classifyOwnership(db, api, worthProbing);
  console.log(
    `· ${ownership.own} are their channel's own material, ` +
      `${ownership.mirrors} mirror somebody else's, ${ownership.collections} are collections`
  );

  /* ── what a person reads ── */
  const accepted = candidates.filter((candidate) => candidate.accept === 'yes');
  const bins = candidates.filter((candidate) => candidate.accept === 'bin');
  const mirrors = candidates.filter((candidate) => candidate.accept === 'mirror');
  // Counted off the candidates rather than off this run's tallies: on a `--from`
  // run the passes did not execute, and their counters would report a state of
  // the world that is simply not this one.
  const collections = candidates.filter((candidate) => candidate.accept === 'collection');
  if (!args.from) {
    console.log(
      `\n· ${candidates.length} candidates survived: ${short} too short, ` +
        `${refused} refused by the rules, ${known} already known`
    );
  }
  console.log(
    `· ${accepted.length} would be queued · ${bins.length} over ${BIN_VIDEOS} videos · ` +
      `${mirrors.length} mirrors · ${collections.length} collections · ` +
      `${candidates.filter((c) => c.accept === 'unclaimed').length} named no course`
  );

  const byCourse = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    // A collection is nobody's course and a playlist naming no course is not
    // this course's; neither is worth a line in something a person reads.
    if (candidate.accept === 'unclaimed' || candidate.accept === 'collection') continue;
    byCourse.set(candidate.forCourse, [...(byCourse.get(candidate.forCourse) ?? []), candidate]);
  }
  for (const target of targets) {
    const rows = byCourse.get(target.courseId) ?? [];
    if (!rows.length) continue;
    const onTarget = rows.filter((row) => row.boundTo === target.courseId);
    console.log(
      `\n▸ ${target.courseId} (${target.playlists} now) — ${rows.length} named a course, ` +
        `${onTarget.length} of them this one`
    );
    for (const row of rows
      .slice()
      .sort(
        (a, b) =>
          Number(b.boundTo === target.courseId) - Number(a.boundTo === target.courseId) ||
          b.videos - a.videos
      )
      .slice(0, 15)) {
      const mark =
        row.boundTo === target.courseId ? '✓' : row.boundTo ? `→${row.boundTo}` : 'undecided';
      const confidence = row.confidence ? row.confidence.toFixed(2) : '    ';
      const flag = row.accept === 'yes' ? '   ' : row.accept === 'bin' ? 'BIN' : 'MIR';
      const owner = row.realOwner ? `  ⇒ ${row.realOwner.title}` : '';
      console.log(
        `   ${flag} ${mark.padEnd(20)} ${confidence} ` +
          `${String(row.videos).padStart(4)}× ${row.title}  · ${row.channelTitle}${owner}`
      );
    }
  }

  // Counted off the accepted candidates only: a channel is a candidate because
  // it owns courses, and the playlists that named no course of this catalogue
  // are exactly the ones that say nothing about whether it does.
  const channels = channelCandidates(db, accepted, mirrors, found, sources);
  console.log(`\n▸ channels not in channels.yaml — ${channels.length}`);
  for (const channel of channels.slice(0, 40)) {
    console.log(
      `   ${String(channel.playlists).padStart(3)} own · ${String(channel.viaMirror).padStart(3)} mirrored · ` +
        `${channel.courses.length} subjects · ${channel.title}  [${channel.id}]`
    );
  }

  fs.writeFileSync(
    args.out,
    JSON.stringify(
      { targets, candidates, channels, spent, queriesRun: ran, ownership },
      null,
      2
    )
  );
  console.log(`\n· ${args.out} written`);

  if (args.apply) {
    const { added, rejected } = queuePlaylists(
      db,
      accepted.map((candidate) => ({ id: candidate.id, title: candidate.title })),
      'searched'
    );
    console.log(`✓ ${added} playlists queued${rejected ? `, ${rejected} malformed` : ''}`);
    console.log('  run `pnpm data:refresh` to fetch them, then `pnpm data:match`');
  } else {
    console.log('· nothing written — re-run with --apply to queue the candidates');
  }

  console.log(`· quota spent today: ${api.spent()}, left ${api.remaining()}`);
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
