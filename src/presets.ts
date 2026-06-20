import type { CanvasPreset } from './types';

/** Instagram canvas presets. All are 1080px on the short/standard edge,
 * the resolution Instagram serves at. */
export const PRESETS: CanvasPreset[] = [
  { id: 'story', label: 'Story / Reel', group: 'Story', width: 1080, height: 1920 },
  { id: 'square', label: 'Square', group: 'Post', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait', group: 'Post', width: 1080, height: 1350 },
  { id: 'landscape', label: 'Landscape', group: 'Post', width: 1080, height: 566 },
];

export const DEFAULT_PRESET = PRESETS[0];
