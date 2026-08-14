import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, paths } from './lib/config.js';
import { loadCourseFiles, SourceError } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
import { loadYamlList } from './lib/sources.js';
import {
  SourceDomainSchema,
  Stage,
  STAGE_ORDER,
  UI_LANGS,
  type Stage as StageValue,
} from '../shared/schema.js';

/**
 * Adding a course means touching the graph entry plus the texts and the search
 * keywords of every language. That is the price of keeping prose out of the
 * course files, and it is only tolerable if a script does the clerical part —
 * miss the keywords and the course exists but nobody can find it.
 *
 *   pnpm course:new probability --domain=math --stage=bachelor-2 --deps=calculus-2
 *
 * The entry is written with placeholder text on purpose: it is left obviously
 * unfinished so `pnpm check:i18n` fails until a human writes the real thing.
 */

type Args = {
  id: string;
  domains: string[];
  stage: StageValue;
  deps: string[];
  soft: string[];
  title?: string;
};

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  const flag = (name: string): string | undefined =>
    argv.find((argument) => argument.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const id = positional[0];
  if (!id) {
    throw new SourceError(
      'Usage: pnpm course:new <id> --domain=<id>[,<id>] --stage=<stage> [--deps=a,b] [--soft=c] [--title="…"]'
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new SourceError(`"${id}" is not a valid course id`, [
      'Use lowercase letters, digits and hyphens: `linear-algebra`, `calculus-2`.',
    ]);
  }

  const list = (value: string | undefined): string[] =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const domains = list(flag('domain') ?? flag('domains'));
  if (!domains.length) {
    throw new SourceError(`${id}: --domain is required`, [
      'The first domain decides which file the course lives in.',
    ]);
  }

  // Required, and deliberately not defaulted: the stage says which year a real
  // curriculum puts the course in, and a guess written by a script is
  // indistinguishable from an answer, including to the reviewer.
  const stage = Stage.safeParse(flag('stage'));
  if (!stage.success) {
    throw new SourceError(`${id}: --stage is required`, [
      `One of: ${STAGE_ORDER.join(', ')}.`,
      'Ask it as "which year would a student normally take this?" — not off the',
      'column, which counts prerequisites inside this catalogue instead.',
    ]);
  }

  return {
    id,
    domains,
    stage: stage.data,
    deps: list(flag('deps')),
    soft: list(flag('soft')),
    title: flag('title'),
  };
}

/**
 * Appends keys to a JSON file as text rather than reparsing and re-serialising.
 *
 * `keywords/ru.json` keeps one array per line, which is what makes it readable
 * and its diffs reviewable; `JSON.stringify(…, 2)` would explode all 225 of
 * them into 1400 lines and bury the actual change.
 */
function appendJsonKeys(file: string, entries: Array<[string, unknown]>): void {
  const text = fs.readFileSync(file, 'utf8');
  const close = text.lastIndexOf('}');
  if (close === -1) throw new SourceError(`${path.relative(paths.root, file)}: not a JSON object`);

  const head = text.slice(0, close).replace(/\s*$/, '');
  const lines = entries.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const separator = head.endsWith('{') ? '\n' : ',\n\n';

  fs.writeFileSync(file, `${head}${separator}${lines.join(',\n')}\n${text.slice(close)}`, 'utf8');
}

function yamlEntry(args: Args): string {
  const lines = [
    `- id: ${args.id}`,
    `  domains: [${args.domains.join(', ')}]`,
    `  stage: ${args.stage}`,
  ];
  if (args.deps.length) lines.push(`  deps: [${args.deps.join(', ')}]`);
  if (args.soft.length) lines.push(`  soft: [${args.soft.join(', ')}]`);
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // The source schema, not `DomainSchema`: `color` is not in the YAML at all —
  // it comes from the domain's biome, and only `loadSources` fills it in.
  const domains = loadYamlList(path.join(paths.data, 'domains.yaml'), SourceDomainSchema);
  const domainIds = new Set(domains.map((domain) => domain.id));
  const unknown = args.domains.filter((id) => !domainIds.has(id));
  if (unknown.length) {
    throw new SourceError(`Unknown domain(s): ${unknown.join(', ')}`, [
      'Add them to data/domains.yaml first — a domain is a territory on the map.',
    ]);
  }

  const { courses } = loadCourseFiles();
  const existing = new Set(courses.map((course) => course.id));
  if (existing.has(args.id)) {
    throw new SourceError(`Course "${args.id}" already exists`);
  }
  const missingDeps = [...args.deps, ...args.soft].filter((id) => !existing.has(id));
  if (missingDeps.length) {
    throw new SourceError(`Unknown course(s) in deps/soft: ${missingDeps.join(', ')}`);
  }

  // 1. The graph entry, in the file named after the first domain.
  ensureDir(paths.courses);
  const file = path.join(paths.courses, `${args.domains[0]}.yaml`);
  const created = !fs.existsSync(file);
  const body = created ? `# Courses whose primary domain is \`${args.domains[0]}\`.\n` : '';
  fs.appendFileSync(file, `${body}\n${yamlEntry(args)}\n`, 'utf8');

  // 2. and 3. Texts and keywords, as placeholders that CI will reject — in
  // every language, because every language is held to the same key set. A slot
  // waiting to be filled is a job somebody can see; a key that simply is not
  // there anywhere is one they find out about from a red build.
  const lang = process.env.DEFAULT_LANG ?? 'ru';
  const title = args.title ?? '';

  const rel = path.relative(paths.root, file);
  console.log(`✓ ${args.id}`);
  console.log(`  ${rel}${created ? ' (new file)' : ''}`);

  for (const entry of UI_LANGS) {
    // `--title` is written in the content language, so it is only seeded there.
    const own = entry.id === lang;
    appendJsonKeys(path.join(paths.i18n, `${entry.id}.json`), [
      [`course.${args.id}.title`, own ? title : ''],
      [`course.${args.id}.desc`, ''],
    ]);
    appendJsonKeys(path.join(paths.keywords, `${entry.id}.json`), [
      [`course.${args.id}`, own && title ? [title.toLowerCase()] : []],
    ]);
    const seeded = own && title ? '' : ' (empty)';
    console.log(`  data/i18n/${entry.id}.json — title${seeded}, desc (empty)`);
    console.log(`  data/keywords/${entry.id}.json — keywords (empty)`);
  }

  console.log('\nNow fill in the titles, descriptions and keywords, then run:');
  console.log('  pnpm check:i18n && pnpm data:build');
}

try {
  main();
} catch (error) {
  reportRunError(error);
}
