import { useEditor } from '../store';

/**
 * The single source of truth for whether AI features are available: true only
 * when a Claude key is present on this device. Reactive — flips the instant the
 * key is saved or removed in settings. Used by `<AiGate>` and by any AI surface
 * that needs to know without wrapping its whole subtree.
 */
export function useAiEnabled(): boolean {
  return useEditor((s) => s.aiKey.trim().length > 0);
}
