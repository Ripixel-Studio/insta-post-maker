import { memo, useEffect, useRef } from 'react';
import { Image as KonvaImage, Text as KonvaText, Rect, Line, Group } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import type {
  Layer,
  ImageLayer,
  ImageFilters,
  TextLayer,
  OverlayLayer,
  ShapeLayer,
} from '../types';
import { getAsset } from '../assets';
import { useEditor } from '../store';

interface NodeProps {
  layer: Layer;
  isSelected: boolean;
}

/** Stable per-node store actions (used instead of fresh callback props so the
 * memoised nodes don't re-render when an unrelated layer changes). */
function useNodeActions(layer: Layer) {
  const select = useEditor((s) => s.select);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setEditingText = useEditor((s) => s.setEditingText);
  const onSelect = () => select(layer.id);
  const onChange = (patch: Partial<Layer>) => updateLayer(layer.id, patch);
  const onStartTextEdit = () => {
    select(layer.id);
    setEditingText(layer.id);
  };
  return { onSelect, onChange, onStartTextEdit };
}

/**
 * Shared positioning. We render every node about its CENTRE (offset =
 * half-size, position = box centre) so rotation and flip pivot naturally and
 * stay in place. The document model still stores the top-left x,y.
 */
function centeredProps(layer: Layer) {
  return {
    id: layer.id,
    name: 'layer-node',
    x: layer.x + layer.width / 2,
    y: layer.y + layer.height / 2,
    offsetX: layer.width / 2,
    offsetY: layer.height / 2,
    rotation: layer.rotation,
    scaleX: layer.flipX ? -1 : 1,
    scaleY: layer.flipY ? -1 : 1,
    opacity: layer.opacity,
    draggable: !layer.locked,
    visible: layer.visible,
    globalCompositeOperation: layer.blendMode,
    listening: !layer.locked,
    // Skip Konva's extra double-draw pass for crisp strokes — not needed here
    // and noticeably cheaper per frame.
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
  };
}

/** Persist drag/transform back to the model, converting the centred node
 * position back to a top-left box and baking any scale into width/height. */
function useCommonHandlers(layer: Layer, onChange: (patch: Partial<Layer>) => void) {
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    onChange({
      x: node.x() - layer.width / 2,
      y: node.y() - layer.height / 2,
    });
  };

  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const sx = node.scaleX();
    const sy = node.scaleY();
    // Bake against the model's size (works for single shapes and groups alike).
    const width = Math.max(5, layer.width * Math.abs(sx));
    const height = Math.max(5, layer.height * Math.abs(sy));
    // Reset scale; React re-renders with flip-derived scale + new size.
    node.scaleX(layer.flipX ? -1 : 1);
    node.scaleY(layer.flipY ? -1 : 1);
    const patch: Partial<Layer> = {
      x: node.x() - width / 2,
      y: node.y() - height / 2,
      width,
      height,
      rotation: node.rotation(),
      flipX: sx < 0,
      flipY: sy < 0,
    };
    if (layer.type === 'text') {
      (patch as Partial<TextLayer>).fontSize = Math.max(
        4,
        Math.round((layer as TextLayer).fontSize * Math.abs(sy)),
      );
    }
    onChange(patch);
  };

  return { onDragEnd, onTransformEnd };
}

/** Build the Konva filter list + attributes for an image's adjustments. */
function buildFilters(f: ImageFilters) {
  const filters: Array<typeof Konva.Filters.Brighten> = [];
  if (f.brightness !== 0) filters.push(Konva.Filters.Brighten);
  if (f.contrast !== 0) filters.push(Konva.Filters.Contrast);
  if (f.saturation !== 0) {
    filters.push(Konva.Filters.HSV);
    if (f.saturation <= -1) filters.push(Konva.Filters.Grayscale);
  }
  if (f.blur > 0) filters.push(Konva.Filters.Blur);
  return filters;
}

function filtersActive(f: ImageFilters) {
  return f.brightness !== 0 || f.contrast !== 0 || f.saturation !== 0 || f.blur > 0;
}

/** Draw a mask path in the box's local coordinates (0,0 → w,h). */
function maskPath(ctx: Konva.Context, w: number, h: number, shape: string) {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'rounded': {
      const r = Math.min(w, h) * 0.18;
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      break;
    }
    case 'triangle':
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      break;
    case 'star': {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = cx + Math.cos(a) * rad * (w / Math.min(w, h));
        const py = cy + Math.sin(a) * rad * (h / Math.min(w, h));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      break;
    }
    case 'heart': {
      // Parametric heart scaled into the box.
      for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * Math.PI * 2;
        const hx = 16 * Math.sin(t) ** 3;
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const px = w / 2 + (hx / 32) * w;
        const py = h / 2 - (hy / 32) * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      break;
    }
    default:
      ctx.rect(0, 0, w, h);
  }
  ctx.closePath();
}

export function ImageNode({ layer, isSelected }: NodeProps) {
  const img = layer as ImageLayer;
  const asset = getAsset(img.assetId);
  const [image] = useImage(asset?.url ?? '', 'anonymous');
  const ref = useRef<Konva.Image>(null);
  const { onSelect, onChange } = useNodeActions(layer);
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);

  // Crop rect in source pixels (whole image when no crop set).
  const crop = img.crop;
  const cropProps =
    crop && asset
      ? {
          crop: {
            x: crop.x * asset.width,
            y: crop.y * asset.height,
            width: crop.width * asset.width,
            height: crop.height * asset.height,
          },
        }
      : {};

  // (Re)cache the node whenever pixels/size/filters change so Konva filters
  // have something to operate on. Clear the cache when no filters are active.
  useEffect(() => {
    const node = ref.current;
    if (!node || !image) return;
    if (filtersActive(img.filters)) {
      node.cache();
    } else {
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
    // Deliberately NOT keyed on width/height: a cached node scales its bitmap,
    // so resizing/pinching doesn't need a (costly) re-rasterise every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image,
    img.filters.brightness,
    img.filters.contrast,
    img.filters.saturation,
    img.filters.blur,
    crop?.x,
    crop?.y,
    crop?.width,
    crop?.height,
  ]);

  // Re-cache once the size settles (debounced) so a filtered image resized after
  // filtering re-sharpens — without paying for a re-rasterise every pinch frame.
  useEffect(() => {
    const node = ref.current;
    if (!node || !image || !filtersActive(img.filters)) return;
    const id = setTimeout(() => {
      node.cache();
      node.getLayer()?.batchDraw();
    }, 160);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img.width, img.height]);

  const imageProps = {
    image,
    width: img.width,
    height: img.height,
    ...cropProps,
    filters: buildFilters(img.filters),
    brightness: img.filters.brightness,
    contrast: img.filters.contrast,
    saturation: img.filters.saturation,
    blurRadius: img.filters.blur,
  };

  const maskActive = img.mask && img.mask !== 'none';
  if (maskActive) {
    // Clip the image to a mask shape via a wrapping group (which carries the
    // id, transform and interaction handlers).
    return (
      <Group
        {...centeredProps(layer)}
        clipFunc={(ctx) => maskPath(ctx as unknown as Konva.Context, img.width, img.height, img.mask!)}
        onMouseDown={onSelect}
        onTap={onSelect}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      >
        <KonvaImage ref={ref} {...imageProps} x={0} y={0} />
      </Group>
    );
  }

  return (
    <KonvaImage
      ref={ref}
      {...imageProps}
      {...centeredProps(layer)}
      shadowEnabled={isSelected ? false : undefined}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

export function TextNode({ layer }: NodeProps) {
  const t = layer as TextLayer;
  const { onSelect, onChange, onStartTextEdit } = useNodeActions(layer);
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);

  const textProps = {
    text: t.text,
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontStyle: t.fontStyle,
    fill: t.fill,
    align: t.align,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    shadowEnabled: t.shadow.enabled,
    shadowColor: t.shadow.color,
    shadowBlur: t.shadow.blur,
    shadowOffsetX: t.shadow.offsetX,
    shadowOffsetY: t.shadow.offsetY,
  };

  // With a background, wrap a rounded panel + inset text in a Group so the
  // node's box matches the layer box (keeping transforms consistent).
  if (t.background.enabled) {
    const pad = t.background.padding;
    return (
      <Group
        {...centeredProps(layer)}
        onMouseDown={onSelect}
        onTap={onSelect}
        onDblClick={onStartTextEdit}
        onDblTap={onStartTextEdit}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      >
        <Rect
          width={t.width}
          height={t.height}
          fill={t.background.color}
          cornerRadius={t.background.cornerRadius}
        />
        <KonvaText
          x={pad}
          y={pad}
          width={Math.max(1, t.width - pad * 2)}
          height={Math.max(1, t.height - pad * 2)}
          verticalAlign="middle"
          {...textProps}
        />
      </Group>
    );
  }

  return (
    <KonvaText
      {...centeredProps(layer)}
      width={t.width}
      {...textProps}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDblClick={onStartTextEdit}
      onDblTap={onStartTextEdit}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

/** Map our gradient direction to Konva start/end points in the rect's
 * local coordinate space (0,0 → width,height). */
function gradientPoints(o: OverlayLayer) {
  switch (o.direction) {
    case 'to-top':
      return { start: { x: 0, y: o.height }, end: { x: 0, y: 0 } };
    case 'to-bottom':
      return { start: { x: 0, y: 0 }, end: { x: 0, y: o.height } };
    case 'to-left':
      return { start: { x: o.width, y: 0 }, end: { x: 0, y: 0 } };
    case 'to-right':
      return { start: { x: 0, y: 0 }, end: { x: o.width, y: 0 } };
    case 'radial':
    default:
      return { start: { x: 0, y: 0 }, end: { x: 0, y: o.height } };
  }
}

export function OverlayNode({ layer }: NodeProps) {
  const o = layer as OverlayLayer;
  const { onSelect, onChange } = useNodeActions(layer);
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);
  const { start, end } = gradientPoints(o);
  const colorStops = o.stops.flatMap((s) => [s.offset, s.color]);

  const radial = o.direction === 'radial';
  const gradientProps = radial
    ? {
        fillRadialGradientStartPoint: { x: o.width / 2, y: o.height / 2 },
        fillRadialGradientEndPoint: { x: o.width / 2, y: o.height / 2 },
        fillRadialGradientStartRadius: 0,
        fillRadialGradientEndRadius: Math.max(o.width, o.height) / 2,
        fillRadialGradientColorStops: colorStops,
      }
    : {
        fillLinearGradientStartPoint: start,
        fillLinearGradientEndPoint: end,
        fillLinearGradientColorStops: colorStops,
      };

  return (
    <Rect
      {...centeredProps(layer)}
      width={o.width}
      height={o.height}
      {...gradientProps}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

export function ShapeNode({ layer }: NodeProps) {
  const s = layer as ShapeLayer;
  const { onSelect, onChange } = useNodeActions(layer);
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);
  const common = {
    ...centeredProps(layer),
    onMouseDown: onSelect,
    onTap: onSelect,
    onDragEnd,
    onTransformEnd,
  };

  if (s.shape === 'line') {
    return (
      <Line
        {...common}
        points={[0, s.height / 2, s.width, s.height / 2]}
        stroke={s.stroke || s.fill}
        strokeWidth={s.strokeWidth || 4}
        lineCap="round"
        hitStrokeWidth={Math.max(12, s.strokeWidth)}
      />
    );
  }

  return (
    <Rect
      {...common}
      width={s.width}
      height={s.height}
      fill={s.fill}
      stroke={s.strokeWidth > 0 ? s.stroke : undefined}
      strokeWidth={s.strokeWidth}
      cornerRadius={
        s.shape === 'ellipse' ? Math.min(s.width, s.height) / 2 : s.cornerRadius
      }
    />
  );
}

/**
 * Memoised so that updating one layer only re-renders that layer's node.
 * Immer gives unchanged layers a stable object reference, so the default
 * shallow prop comparison (layer ref + isSelected) skips everything else —
 * turning an N-layer redraw per interaction frame into a 1-layer redraw.
 */
export const LayerNode = memo(function LayerNode(props: NodeProps) {
  switch (props.layer.type) {
    case 'image':
      return <ImageNode {...props} />;
    case 'text':
      return <TextNode {...props} />;
    case 'overlay':
      return <OverlayNode {...props} />;
    case 'shape':
      return <ShapeNode {...props} />;
    default:
      return null;
  }
});
