import fs from 'node:fs';
import path from 'node:path';
import { LineCounter, parseDocument, isSeq } from 'yaml';
import { z } from 'zod';
import { colourOf } from '../../shared/tiles/biomes.js';
import {
  ChannelSchema,
  CourseSchema,
  SourceDomainSchema,
  OverridesSchema,
  ProviderSchema,
  type Channel,
  type Course,
  type Domain,
  type Overrides,
  type Provider,
} from '../../shared/schema.js';
import { paths } from './config.js';

/**
 * Loading and validating the hand-edited sources.
 *
 * Every failure reports file, line and the offending id. A schema error that
 * only says "expected string" costs ten minutes of grepping in a 900-line YAML.
 */

export class SourceError extends Error {
  constructor(
    message: string,
    readonly details: string[] = []
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Parses a YAML sequence file and validates each item, reporting real line numbers.
 *
 * Typed on the schema rather than on a plain `T` so that zod defaults survive:
 * `deps: z.array(...).default([])` has an optional input and a required output,
 * and collapsing the two makes every defaulted field optional downstream.
 */
export type Located<T> = { value: T; file: string; line: number };

/** Parses a YAML sequence file and validates each item, keeping its real line. */
export function loadYamlListLocated<S extends z.ZodTypeAny>(
  file: string,
  schema: S
): Array<Located<z.output<S>>> {
  const text = fs.readFileSync(file, 'utf8');
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const rel = path.relative(paths.root, file);

  if (doc.errors.length) {
    throw new SourceError(
      `${rel}: YAML is not parseable`,
      doc.errors.map((e) => `line ${lineCounter.linePos(e.pos[0]).line}: ${e.message}`)
    );
  }

  const raw = doc.toJS() ?? [];
  if (!Array.isArray(raw)) {
    throw new SourceError(`${rel}: expected a list at the top level`);
  }

  const lineOf = (index: number): number => {
    const contents = doc.contents;
    if (!isSeq(contents)) return 0;
    const node = contents.items[index] as { range?: [number, number, number] } | undefined;
    return node?.range ? lineCounter.linePos(node.range[0]).line : 0;
  };

  const problems: string[] = [];
  const result: Array<Located<z.output<S>>> = [];

  raw.forEach((item, index) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      result.push({ value: parsed.data, file: rel, line: lineOf(index) });
    } else {
      const id = (item as { id?: string } | null)?.id ?? `#${index}`;
      problems.push(`${rel}:${lineOf(index)} [${id}] ${formatIssues(parsed.error.issues)}`);
    }
  });

  if (problems.length) {
    throw new SourceError(`${rel}: ${problems.length} invalid entries`, problems);
  }
  return result;
}

export function loadYamlList<S extends z.ZodTypeAny>(file: string, schema: S): Array<z.output<S>> {
  return loadYamlListLocated(file, schema).map((entry) => entry.value);
}

export function loadYamlObject<S extends z.ZodTypeAny>(file: string, schema: S): z.output<S> {
  const rel = path.relative(paths.root, file);
  if (!fs.existsSync(file)) return schema.parse({});

  const text = fs.readFileSync(file, 'utf8');
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) {
    throw new SourceError(
      `${rel}: YAML is not parseable`,
      doc.errors.map((e) => `line ${lineCounter.linePos(e.pos[0]).line}: ${e.message}`)
    );
  }
  const parsed = schema.safeParse(doc.toJS() ?? {});
  if (!parsed.success) {
    throw new SourceError(`${rel}: invalid`, [formatIssues(parsed.error.issues)]);
  }
  return parsed.data;
}

export function loadJson<S extends z.ZodTypeAny>(file: string, schema: S): z.output<S> {
  const rel = path.relative(paths.root, file);
  if (!fs.existsSync(file)) {
    throw new SourceError(`${rel}: file not found`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new SourceError(`${rel}: not valid JSON`, [(e as Error).message]);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SourceError(`${rel}: invalid`, [formatIssues(parsed.error.issues)]);
  }
  return parsed.data;
}

/** Keyword files are `{ "course.probability": ["теорвер", …] }` plus `_comment`. */
const KeywordsSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
const I18nSchema = z.record(z.string(), z.string());

/**
 * Courses are split one file per area, named after the course's first domain.
 *
 * The split is only storage — it changes nothing about the graph. What it buys
 * is merge behaviour: two people editing maths and biology never touch the same
 * file, and a file stays short enough to read end to end.
 */
export function loadCourseFiles(): {
  courses: Course[];
  /** courseId → `data/courses/math.yaml:44`, for error messages. */
  locations: Map<string, string>;
  /** courseId → `math.yaml`, for the placement check. */
  fileOf: Map<string, string>;
} {
  if (!fs.existsSync(paths.courses)) {
    throw new SourceError('data/courses/ not found', [
      'Courses live one file per area, e.g. data/courses/math.yaml. See docs/data.md.',
    ]);
  }

  const files = fs
    .readdirSync(paths.courses)
    .filter((name) => name.endsWith('.yaml'))
    .sort(); // alphabetical, so the build is reproducible

  if (!files.length) {
    throw new SourceError('data/courses/ has no .yaml files');
  }

  const courses: Course[] = [];
  const locations = new Map<string, string>();
  const fileOf = new Map<string, string>();
  const duplicates: string[] = [];

  for (const name of files) {
    for (const entry of loadYamlListLocated(path.join(paths.courses, name), CourseSchema)) {
      if (fileOf.has(entry.value.id)) {
        duplicates.push(`[${entry.value.id}] in both ${fileOf.get(entry.value.id)} and ${name}`);
        continue;
      }
      courses.push(entry.value);
      locations.set(entry.value.id, `${entry.file}:${entry.line}`);
      fileOf.set(entry.value.id, name);
    }
  }

  if (duplicates.length) {
    throw new SourceError(`Duplicate course ids (${duplicates.length})`, duplicates);
  }

  return { courses, locations, fileOf };
}

export type Sources = {
  domains: Domain[];
  courses: Course[];
  courseLocations: Map<string, string>;
  courseFiles: Map<string, string>;
  providers: Provider[];
  channels: Channel[];
  overrides: Overrides;
  i18n: Record<string, string>;
  keywords: Record<string, string[]>;
};

export function loadSources(lang = 'ru'): Sources {
  // The colour is not in the YAML: it belongs to the domain's biome, and
  // `shared/tiles/biomes.ts` is the one place that decides both what a
  // territory is made of and what it is painted. Filled in here so that every
  // consumer downstream — the build, the map generator, the course art — goes
  // on reading `domain.color` and none of them has to know where it came from.
  const domains: Domain[] = loadYamlList(
    path.join(paths.data, 'domains.yaml'),
    SourceDomainSchema
  ).map((domain) => ({ ...domain, color: colourOf(domain.id, domain.continent) }));
  const { courses, locations, fileOf } = loadCourseFiles();
  const providers = loadYamlList(path.join(paths.data, 'providers.yaml'), ProviderSchema);
  const channels = loadYamlList(path.join(paths.data, 'channels.yaml'), ChannelSchema);
  const overrides = loadYamlObject(path.join(paths.data, 'overrides.yaml'), OverridesSchema);
  const i18n = loadJson(path.join(paths.i18n, `${lang}.json`), I18nSchema);

  const rawKeywords = loadJson(path.join(paths.keywords, `${lang}.json`), KeywordsSchema);
  const keywords: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawKeywords)) {
    if (key.startsWith('_')) continue; // `_comment` and friends
    keywords[key] = Array.isArray(value) ? value : [value];
  }

  return {
    domains,
    courses,
    courseLocations: locations,
    courseFiles: fileOf,
    providers,
    channels,
    overrides,
    i18n,
    keywords,
  };
}

/**
 * The interface dictionary of a language other than the content one.
 *
 * Only the catalogue is written once, in `DEFAULT_LANG`: course titles and
 * descriptions are content, and translating them is a data job, not a UI one.
 * The chrome around them is not — `data/i18n/en.json` carries the `ui.*` and
 * `app.*` keys and nothing else, and the build lays it over the full dictionary
 * so an English interface still names the Russian courses it is showing.
 */
export function loadInterfaceDictionary(lang: string): Record<string, string> {
  return loadJson(path.join(paths.i18n, `${lang}.json`), I18nSchema);
}

/** True for the keys that belong to the interface rather than to the catalogue. */
export function isInterfaceKey(key: string): boolean {
  return key.startsWith('ui.') || key.startsWith('app.');
}

export function reportSourceError(error: unknown): never {
  if (error instanceof SourceError) {
    console.error(`\n✗ ${error.message}`);
    for (const detail of error.details.slice(0, 40)) console.error(`  ${detail}`);
    if (error.details.length > 40) {
      console.error(`  …and ${error.details.length - 40} more`);
    }
    process.exit(1);
  }
  throw error;
}
