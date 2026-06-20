import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer as KonvaLayer, Rect, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../store';
import { LayerNode } from './nodes';
import { stageHolder } from './stageHolder';
import type { Layer } from '../types';

/** Padding (px) around the canvas inside its viewport container. */
const VIEWPORT_PADDING = 48;

export function CanvasStage() {
  const design = useEditor((s) => s.design);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const updateLayer = useEditor((s) => s.updateLayer);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Track the available viewport size so we can scale the (large) document
  // down to fit. The stage renders at `scale`, export renders at 1:1.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewport({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(
    (viewport.width - VIEWPORT_PADDING) / design.width,
    (viewport.height - VIEWPORT_PADDING) / design.height,
    1,
  );
  const stageWidth = design.width * scale;
  const stageHeight = design.height * scale;

  // Register the live stage so the export pipeline can reach it.
  useEffect(() => {
    stageHolder.current = stageRef.current;
    return () => {
      stageHolder.current = null;
    };
  });

  // Keep the transformer attached to the currently selected node.
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (!selectedId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = stage.findOne(`#${selectedId}`);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, design.layers]);

  const onBackgroundClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Click/tap on empty stage (the background rect or stage) clears selection.
    if (e.target === e.target.getStage() || e.target.name() === 'doc-background') {
      select(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="canvas-surface flex h-full w-full items-center justify-center overflow-hidden"
    >
      {scale > 0 && (
        <div
          className="shadow-2xl"
          style={{ width: stageWidth, height: stageHeight }}
        >
          <Stage
            ref={stageRef}
            width={stageWidth}
            height={stageHeight}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={onBackgroundClick}
            onTouchStart={onBackgroundClick}
          >
            <KonvaLayer>
              <Rect
                name="doc-background"
                x={0}
                y={0}
                width={design.width}
                height={design.height}
                fill={design.background}
              />
              {design.layers.map((layer) => (
                <LayerNode
                  key={layer.id}
                  layer={layer}
                  isSelected={layer.id === selectedId}
                  onSelect={() => select(layer.id)}
                  onChange={(patch: Partial<Layer>) => updateLayer(layer.id, patch)}
                />
              ))}
              <Transformer
                ref={transformerRef}
                rotateEnabled
                keepRatio={false}
                anchorSize={10}
                borderStroke="#c084fc"
                anchorStroke="#c084fc"
                anchorFill="#1b1d22"
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < 12 || newBox.height < 12 ? oldBox : newBox
                }
              />
            </KonvaLayer>
          </Stage>
        </div>
      )}
    </div>
  );
}
