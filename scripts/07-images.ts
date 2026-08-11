import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { ensureDir, parseLimit, paths, reportRemaining } from './lib/config.js';
import { loadSources, reportSourceError } from './lib/sources.js';
import { visual } from './lib/visual.config.js';
import { courseArtSvg } from '../shared/procedural.js';
import { hasOpenAI, MODELS, openai } from './lib/openai.js';

/**
 * Two modes.
 *
 * Procedural SVG (default, every course): a deterministic generator — the same
 * id always produces the same picture, so nothing needs storing in git.
 *
 * OpenAI (`--openai`, domains only): ~40 stable images that are committed.
 * Putting 500+ courses through an image API means paying on every run, a style
 * that drifts, and no cheap way to regenerate after a redesign. Without the
 * flag the image API is never called.
 *
 * Both modes skip what is already on disk, so `pnpm data:images --openai 5`
 * generates five and the call after it generates the next five. `--force`
 * regenerates regardless, which is what a changed seedSalt or prompt needs.
 */

type PromptConfig = {
  style: string;
  template: string;
  overrides?: Record<string, string>;
  size?: string;
  format?: string;
};

async function main(): Promise<void> {
  const useOpenAI = process.argv.includes('--openai');
  const limit = parseLimit();
  const only = process.argv
    .find((argument) => argument.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .filter(Boolean);

  const sources = loadSources();

  // Images have no table to remember them, so the file on disk is the record of
  // what is done. `--force` is how a changed seedSalt or prompt gets applied.
  const force = process.argv.includes('--force');

  if (!useOpenAI) {
    ensureDir(paths.courseImages);
    let written = 0;
    let skipped = 0;
    let remaining = 0;
    for (const course of sources.courses) {
      if (only && !only.includes(course.id)) continue;
      const file = path.join(paths.courseImages, `${course.id}.svg`);
      if (!force && fs.existsSync(file)) {
        skipped += 1;
        continue;
      }
      if (written >= limit) {
        remaining += 1;
        continue;
      }
      const domain = sources.domains.find((item) => item.id === course.domains[0]);
      const svg = courseArtSvg(course.id, domain?.color ?? '#4CC9F0', visual);
      fs.writeFileSync(file, svg, 'utf8');
      written += 1;
    }
    console.log(
      `✓ data:images: ${written} procedural SVGs (seed "${visual.seedSalt}"), ${skipped} already there`
    );
    reportRemaining(remaining, limit);
    console.log('· the frontend inlines the same generator, so these are for sharing and export');
    return;
  }

  if (!hasOpenAI()) {
    console.error('OPENAI_API_KEY is not set. Run without --openai for the procedural generator.');
    process.exit(1);
  }

  const configFile = path.join(paths.data, 'image-prompts.yaml');
  const config = parse(fs.readFileSync(configFile, 'utf8')) as PromptConfig;
  ensureDir(paths.domainImages);

  const extension = config.format ?? 'webp';
  const candidates = sources.domains.filter((domain) => !only || only.includes(domain.id));
  const done = candidates.filter(
    (domain) => !force && fs.existsSync(path.join(paths.domainImages, `${domain.id}.${extension}`))
  ).length;
  const targets = candidates
    .filter(
      (domain) => force || !fs.existsSync(path.join(paths.domainImages, `${domain.id}.${extension}`))
    )
    .slice(0, limit);

  console.log(
    `· generating ${targets.length} domain images through ${MODELS.image}, ${done} already there`
  );

  for (const domain of targets) {
    const title = sources.i18n[`domain.${domain.id}.title`] ?? domain.id;
    const description = sources.i18n[`domain.${domain.id}.desc`] ?? '';
    const template = config.overrides?.[domain.id] ?? config.template;
    const prompt = template
      .replace('{style}', config.style)
      .replace('{title}', title)
      .replace('{desc}', description)
      .replace('{continent}', domain.continent)
      .replace('{color}', domain.color);

    const response = await openai().images.generate({
      model: MODELS.image,
      prompt,
      size: (config.size ?? '1024x1024') as '1024x1024',
      n: 1,
    });

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      console.warn(`  ${domain.id}: model returned no image`);
      continue;
    }
    const file = path.join(paths.domainImages, `${domain.id}.${extension}`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    console.log(`  ${domain.id} → ${path.relative(paths.root, file)}`);
  }

  reportRemaining(candidates.length - done - targets.length, limit);
  console.log('✓ domain images written — commit them, they are stable and paid for once');
}

main().catch(reportSourceError);
