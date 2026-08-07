import type { VisualConfig } from '../../shared/procedural.js';

/**
 * The one place that controls how every course picture looks.
 * Changing `seedSalt` regenerates the whole catalogue — that is the point of
 * having it: a redesign is one string edit, not 500 API calls.
 */
export const visual: VisualConfig = {
  palette: 'domain', // 'domain' | 'mono' | 'custom'
  motif: 'auto', // 'auto' | 'orbits' | 'grid' | 'strata' | 'noise'
  density: 0.6,
  strokeWidth: 1.5,
  seedSalt: 'v1',
};
