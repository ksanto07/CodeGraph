import { getViewportForBounds, type Rect } from '@xyflow/react';

export function canvasViewport(bounds: Rect, width: number, height: number, ceiling: number, initial: boolean) {
  return getViewportForBounds(bounds, width, height, initial ? 0.85 : 0.05, Math.min(ceiling, 1), 0.12);
}
