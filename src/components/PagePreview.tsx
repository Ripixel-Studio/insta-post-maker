import { Stage, Layer as KonvaLayer, Rect } from 'react-konva';
import { LayerNode } from '../canvas/nodes';
import { CollageView } from '../canvas/CollageView';
import type { Page, Layer } from '../types';

/** Non-interactive render of a single page, scaled to a display height. */
export function PagePreview({
  page,
  shared,
  width,
  height,
  displayHeight,
}: {
  page: Page;
  shared: Layer[];
  width: number;
  height: number;
  displayHeight: number;
}) {
  const scale = displayHeight / height;
  const layers = [...page.layers, ...shared];
  return (
    <Stage
      width={width * scale}
      height={displayHeight}
      scaleX={scale}
      scaleY={scale}
      listening={false}
    >
      <KonvaLayer listening={false}>
        <Rect x={0} y={0} width={width} height={height} fill={page.background} />
        {page.collage && (
          <CollageView collage={page.collage} width={width} height={height} onRequestFill={() => {}} />
        )}
        {layers.map((l) => (
          <LayerNode key={l.id} layer={l} isSelected={false} />
        ))}
      </KonvaLayer>
    </Stage>
  );
}
