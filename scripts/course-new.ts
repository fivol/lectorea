import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, paths } from './lib/config.js';
import { loadCourseFiles, reportSourceError, SourceError } from './lib/sources.js';
import { loadYamlList } from './lib/sources.js';
import { DomainSchema } from '../shared/schema.js';

/**
 * Adding a course means touching three files: the graph entry, the texts and
 * the search keywords. That is the price of keeping prose out of the course
 * files, and it is only tolerable if a script does the clerical part — miss the
 * keywords and the course exists but nobody can find it.
 *
 *   pnpm course:new probability --domain=math --deps=calculus-2,combinatorics
 *
 * The entry is written with placeholder text on purpose: it is left obviously
 * unfinished so `pnpm check:i18n` fails until a human writes the real thing.
 */

type Args = {
  id: string;
  domains: string[];
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
    throw new SourceError('Usage: pnpm course:new <id> --domain=<id>[,<id>] [--deps=a,b] [--soft=c] [--title="…"]');
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

  return { id, domains, deps: list(flag('deps')), soft: list(flag('soft')), title: flag('title') };
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
  const lines = [`- id: ${args.id}`, `  domains: [${args.domains.join(', ')}]`];
  if (args.deps.length) lines.push(`  deps: [${args.deps.join(', ')}]`);
  if (args.soft.length) lines.push(`  soft: [${args.soft.join(', ')}]`);
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const domains = loadYamlList(path.join(paths.data, 'domains.yaml'), DomainSchema);
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

  // 2. and 3. Texts and keywords, as placeholders that CI will reject.
  const lang = process.env.DEFAULT_LANG ?? 'ru';
  const title = args.title ?? '';

  appendJsonKeys(path.join(paths.i18n, `${lang}.json`), [
    [`course.${args.id}.title`, title],
    [`course.${args.id}.desc`, ''],
  ]);
  appendJsonKeys(path.join(paths.keywords, `${lang}.json`), [
    [`course.${args.id}`, title ? [title.toLowerCase()] : []],
  ]);

  const rel = path.relative(paths.root, file);
  console.log(`✓ ${args.id}`);
  console.log(`  ${rel}${created ? ' (new file)' : ''}`);
  console.log(`  data/i18n/${lang}.json — title${title ? '' : ' (empty)'}, desc (empty)`);
  console.log(`  data/keywords/${lang}.json — keywords (empty)`);
  console.log('\nNow fill in the description and keywords, then run:');
  console.log('  pnpm check:i18n && pnpm data:build');
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}
