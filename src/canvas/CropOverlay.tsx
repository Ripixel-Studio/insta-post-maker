import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Rect, Transformer, Group } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { ImageLayer, CropRect } from '../types';
import { getAsset } from '../assets';

interface Props {
  layer: ImageLayer;
  designWidth: number;
  designHeight: number;
  onCommit: (crop: CropRect, box: { width: number; height: number }) => void;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Trim-style crop editor (rendered inside the canvas Layer): the full source
 * image is shown fitted to the canvas, dimmed outside a draggable/resizable
 * crop rectangle. Confirming maps the rectangle back to a normalised crop.
 */
export function CropOverlay({ layer, designWidth, designHeight, onCommit }: Props) {
  const asset = getAsset(layer.assetId);
  const [image] = useImage(asset?.url ?? '', 'anonymous');
  const rectRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  // Fit the whole source image into ~90% of the canvas, centred.
  const srcW = asset?.width ?? designWidth;
  const srcH = asset?.height ?? designHeight;
  const fitScale = Math.min((designWidth * 0.9) / srcW, (designHeight * 0.9) / srcH);
  const fitted: Box = {
    width: srcW * fitScale,
    height: srcH * fitScale,
    x: (designWidth - srcW * fitScale) / 2,
    y: (designHeight - srcH * fitScale) / 2,
  };

  const initial: Box = layer.crop
    ? {
        x: fitted.x + layer.crop.x * fitted.width,
        y: fitted.y + layer.crop.y * fitted.height,
        width: layer.crop.width * fitted.width,
        height: layer.crop.height * fitted.height,
      }
    : { ...fitted };

  const [box, setBox] = useState<Box>(initial);

  useEffect(() => {
    const tr = trRef.current;
    const rect = rectRef.current;
    if (tr && rect) {
      tr.nodes([rect]);
      tr.getLayer()?.batchDraw();
    }
  }, [image]);

  /** Clamp a box so it stays within the fitted image bounds. */
  const clamp = (b: Box): Box => {
    const width = Math.min(b.width, fitted.width);
    const height = Math.min(b.height, fitted.height);
    return {
      width,
      height,
      x: Math.min(Math.max(b.x, fitted.x), fitted.x + fitted.width - width),
      y: Math.min(Math.max(b.y, fitted.y), fitted.y + fitted.height - height),
    };
  };

  const commit = () => {
    const c = clamp(box);
    const crop: CropRect = {
      x: (c.x - fitted.x) / fitted.width,
      y: (c.y - fitted.y) / fitted.height,
      width: c.width / fitted.width,
      height: c.height / fitted.height,
    };
    // Preserve the layer's current width; derive height from the crop aspect.
    const cropPxW = crop.width * srcW;
    const cropPxH = crop.height * srcH;
    const box2 = { width: layer.width, height: (layer.width * cropPxH) / cropPxW };
    onCommit(crop, box2);
  };

  // Expose commit to the parent via a ref-less imperative hook: parent calls
  // through the window event below.
  useEffect(() => {
    const handler = () => commit();
    window.addEventListener('crop-commit', handler);
    return () => window.removeEventListener('crop-commit', handler);
  });

  // Aspect-ratio presets dispatched from the floating crop toolbar.
  useEffect(() => {
    const handler = (e: Event) => {
      const ratio = (e as CustomEvent<number | null>).detail;
      if (!ratio) return; // 'Free' — leave the box as-is
      let w = fitted.width;
      let h = w / ratio;
      if (h > fitted.height) {
        h = fitted.height;
        w = h * ratio;
      }
      setBox(
        clamp({
          x: fitted.x + (fitted.width - w) / 2,
          y: fitted.y + (fitted.height - h) / 2,
          width: w,
          height: h,
        }),
      );
    };
    window.addEventListener('crop-aspect', handler);
    return () => window.removeEventListener('crop-aspect', handler);
  });

  return (
    <Group>
      <KonvaImage
        image={image}
        x={fitted.x}
        y={fitted.y}
        width={fitted.width}
        height={fitted.height}
        listening={false}
      />
      {/* Dim the area outside the crop with four rects. */}
      <Rect x={0} y={0} width={designWidth} height={box.y} fill="rgba(0,0,0,0.55)" listening={false} />
      <Rect x={0} y={box.y + box.height} width={designWidth} height={designHeight - box.y - box.height} fill="rgba(0,0,0,0.55)" listening={false} />
      <Rect x={0} y={box.y} width={box.x} height={box.height} fill="rgba(0,0,0,0.55)" listening={false} />
      <Rect x={box.x + box.width} y={box.y} width={designWidth - box.x - box.width} height={box.height} fill="rgba(0,0,0,0.55)" listening={false} />

      <Rect
        ref={rectRef}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        stroke="#c084fc"
        strokeWidth={2}
        draggable
        dragBoundFunc={(pos) => {
          const clamped = clamp({ ...box, x: pos.x, y: pos.y });
          return { x: clamped.x, y: clamped.y };
        }}
        onDragEnd={(e) => setBox(clamp({ ...box, x: e.target.x(), y: e.target.y() }))}
        onTransformEnd={(e) => {
          const node = e.target;
          const next = clamp({
            x: node.x(),
            y: node.y(),
            width: Math.max(20, node.width() * node.scaleX()),
            height: Math.max(20, node.height() * node.scaleY()),
          });
          node.scaleX(1);
          node.scaleY(1);
          setBox(next);
        }}
      />
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        anchorSize={12}
        borderStroke="#c084fc"
        anchorStroke="#c084fc"
        anchorFill="#1b1d22"
        boundBoxFunc={(oldBox, newBox) =>
          newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
        }
      />
    </Group>
  );
}
