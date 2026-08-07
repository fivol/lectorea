import OpenAI from 'openai';
import { env } from './config.js';

/**
 * OpenAI is optional everywhere. Without a key the pipeline still works:
 * matching falls back to rules plus manual review, and images fall back to the
 * procedural SVG generator.
 */

let client: OpenAI | null = null;

export function hasOpenAI(): boolean {
  return Boolean(env.openaiKey);
}

export function openai(): OpenAI {
  if (!env.openaiKey) {
    throw new Error('OPENAI_API_KEY is not set — run without --llm, or add the key to .env');
  }
  client ??= new OpenAI({ apiKey: env.openaiKey });
  return client;
}

/**
 * Overridable from .env, because model names move faster than this repository
 * will. Classification is a short, high-volume task, so it defaults to a small
 * tier; images use the image model named in SPEC 8.8.
 */
export const MODELS = {
  classify: process.env.OPENAI_CLASSIFY_MODEL ?? 'gpt-5-mini',
  image: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
};
