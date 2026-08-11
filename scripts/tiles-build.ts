import fs from 'node:fs';
import path from 'node:path';
import {
  assemblies,
  buildManifest,
  findTile,
  GROUPS,
  spriteSvg,
  tally,
  tiles,
  tileSvg,
  assemblySvg,
  type TileGroup,
} from '../shared/tiles/index.js';

/**
 * Generates the tile collection and writes it out.
 *
 * Three shapes of the same thing, because three different consumers want it:
 * a manifest for code, a folder of files for a design tool, and one sprite for
 * a page that would rather not fetch two hundred SVGs. All of them come from
 * the same generator the viewer runs, so what is exported is what was seen.
 */

const OUT = process.env.TILES_OUT ?? '.tiles';

type Options = {
  out: string;
  size: number;
  seed: string;
  groups: TileGroup[] | null;
  formats: Set<string>;
};

const ALL_FORMATS = ['json', 'svg', 'objects', 'sprite'];

function parseArgs(): Options {
  const options: Options = {
    out: OUT,
    size: 64,
    seed: 'v1',
    groups: null,
    formats: new Set(ALL_FORMATS),
  };

  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([a-zA-Z]+)=(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'out') options.out = value;
    if (key === 'size') options.size = Number(value);
    if (key === 'seed') options.seed = value;
    if (key === 'only') {
      const known = new Set(GROUPS.map((group) => group.id));
      options.groups = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry): entry is TileGroup => known.has(entry as TileGroup));
    }
    if (key === 'formats') {
      options.formats = new Set(value.split(',').map((entry) => entry.trim()));
    }
  }

  if (!Number.isFinite(options.size) || options.size <= 0) {
    throw new Error('--size ждёт положительное число');
  }
  const unknown = [...options.formats].filter((format) => !ALL_FORMATS.includes(format));
  if (unknown.length) {
    throw new Error(`неизвестный формат: ${unknown.join(', ')} (есть: ${ALL_FORMATS.join(', ')})`);
  }
  return options;
}

function write(file: string, content: string): number {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return Buffer.byteLength(content);
}

function main(): void {
  const options = parseArgs();
  const wanted = options.groups;
  const selection = wanted ? tiles.filter((tile) => wanted.includes(tile.group)) : tiles;
  if (!selection.length) throw new Error('после --only не осталось ни одной плитки');

  const render = { seed: options.seed, size: options.size };
  const written: Array<{ what: string; files: number; bytes: number }> = [];

  if (options.formats.has('json')) {
    const manifest = buildManifest({ seed: options.seed, previewSize: options.size });
    // `--only` narrows the loose files, never the manifest or the assembled
    // objects: either of those, cut down to one group, would point at tiles it
    // no longer carries.
    const bytes = write(path.join(options.out, 'collection.json'), JSON.stringify(manifest, null, 2));
    written.push({ what: 'collection.json', files: 1, bytes });
  }

  if (options.formats.has('svg')) {
    let files = 0;
    let bytes = 0;
    for (const tile of selection) {
      for (let variant = 0; variant < tile.variants; variant++) {
        bytes += write(
          path.join(options.out, 'svg', tile.group, `${tile.id}-${variant}.svg`),
          tileSvg(tile, { variant }, render)
        );
        files += 1;
      }
    }
    written.push({ what: 'svg/', files, bytes });
  }

  if (options.formats.has('objects')) {
    let bytes = 0;
    for (const assembly of assemblies) {
      bytes += write(
        path.join(options.out, 'objects', `${assembly.id}.svg`),
        assemblySvg(assembly, findTile, render)
      );
    }
    written.push({ what: 'objects/', files: assemblies.length, bytes });
  }

  if (options.formats.has('sprite')) {
    const bytes = write(path.join(options.out, 'sprite.svg'), spriteSvg(selection, render));
    written.push({ what: 'sprite.svg', files: 1, bytes });
  }

  const counts = tally();
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

  console.log(
    [
      `плиток          ${counts.tiles} (частей ${counts.parts})`,
      `вариантов       ${counts.variants}`,
      `объектов        ${counts.assemblies}`,
      `размер гекса    ${options.size} px · seed ${options.seed}`,
      wanted ? `только группы   ${wanted.join(', ')}` : '',
      '',
      ...written.map((entry) => `  ${entry.what.padEnd(16)} ${String(entry.files).padStart(4)} файл. · ${kb(entry.bytes)}`),
    ]
      .filter(Boolean)
      .join('\n')
  );
  console.log(`\n✓ ${options.out}`);
}

try {
  main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
