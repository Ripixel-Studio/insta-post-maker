import type Konva from 'konva';

/** Shared handle to the live Konva stage so non-canvas UI (the export button)
 * can reach it without prop-drilling. Set by CanvasStage on mount. */
export const stageHolder: { current: Konva.Stage | null } = { current: null };
