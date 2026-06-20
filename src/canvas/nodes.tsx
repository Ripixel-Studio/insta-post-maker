import { useEffect, useRef } from 'react';
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

interface NodeProps {
  layer: Layer;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Layer>) => void;
  /** Text only: request inline editing (double-click / double-tap). */
  onStartTextEdit?: () => void;
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
  };
}

/** Persist drag/transform back to the model, converting the centred node
 * position back to a top-left box and baking any scale into width/height. */
function useCommonHandlers(layer: Layer, onChange: NodeProps['onChange']) {
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

export function ImageNode({ layer, isSelected, onSelect, onChange }: NodeProps) {
  const img = layer as ImageLayer;
  const asset = getAsset(img.assetId);
  const [image] = useImage(asset?.url ?? '', 'anonymous');
  const ref = useRef<Konva.Image>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image,
    img.width,
    img.height,
    img.filters.brightness,
    img.filters.contrast,
    img.filters.saturation,
    img.filters.blur,
    crop?.x,
    crop?.y,
    crop?.width,
    crop?.height,
  ]);

  return (
    <KonvaImage
      ref={ref}
      {...centeredProps(layer)}
      image={image}
      width={img.width}
      height={img.height}
      {...cropProps}
      filters={buildFilters(img.filters)}
      brightness={img.filters.brightness}
      contrast={img.filters.contrast}
      saturation={img.filters.saturation}
      blurRadius={img.filters.blur}
      shadowEnabled={isSelected ? false : undefined}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

export function TextNode({ layer, onSelect, onChange, onStartTextEdit }: NodeProps) {
  const t = layer as TextLayer;
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

export function OverlayNode({ layer, onSelect, onChange }: NodeProps) {
  const o = layer as OverlayLayer;
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

export function ShapeNode({ layer, onSelect, onChange }: NodeProps) {
  const s = layer as ShapeLayer;
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

export function LayerNode(props: NodeProps) {
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
}
