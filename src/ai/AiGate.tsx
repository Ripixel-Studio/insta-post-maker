import type { ReactNode } from 'react';
import { useAiEnabled } from './useAiEnabled';

/**
 * Wrap any AI surface in `<AiGate>`. With no key present it renders `fallback`
 * (nothing by default), keeping every AI entry point hidden until the user
 * brings a key. This is the mechanism every AI feature should gate on rather
 * than checking the key itself, so the rule lives in one place.
 */
export function AiGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const enabled = useAiEnabled();
  return <>{enabled ? children : fallback}</>;
}
