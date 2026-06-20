import type { ImageFilters } from './types';

/** One-tap adjustment presets. Each fully specifies the filter values. */
export interface FilterPreset {
  id: string;
  label: string;
  values: ImageFilters;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: 'Original', values: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } },
  { id: 'vivid', label: 'Vivid', values: { brightness: 0.05, contrast: 25, saturation: 0.5, blur: 0 } },
  { id: 'warm', label: 'Warm', values: { brightness: 0.08, contrast: 10, saturation: 0.3, blur: 0 } },
  { id: 'moody', label: 'Moody', values: { brightness: -0.1, contrast: 30, saturation: -0.2, blur: 0 } },
  { id: 'fade', label: 'Fade', values: { brightness: 0.12, contrast: -20, saturation: -0.15, blur: 0 } },
  { id: 'mono', label: 'B&W', values: { brightness: 0, contrast: 15, saturation: -1, blur: 0 } },
];
