import { Image as KonvaImage, Text as KonvaText, Rect } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type {
  Layer,
  ImageLayer,
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
}

/** Shared handlers: persist drag/transform results back into the model.
 * Konva applies scaleX/scaleY during a transform; we bake that back into
 * width/height (and fontSize for text) so the document model stays clean and
 * exports identically. */
function useCommonHandlers(layer: Layer, onChange: NodeProps['onChange']) {
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ x: e.target.x(), y: e.target.y() });
  };

  const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const patch: Partial<Layer> = {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      width: Math.max(5, node.width() * scaleX),
      height: Math.max(5, node.height() * scaleY),
    };
    if (layer.type === 'text') {
      // Scale font size with the vertical handle so text grows naturally.
      (patch as Partial<TextLayer>).fontSize = Math.max(
        4,
        Math.round((layer as TextLayer).fontSize * scaleY),
      );
    }
    onChange(patch);
  };

  return { onDragEnd, onTransformEnd };
}

const commonNodeProps = (layer: Layer, isSelected: boolean) => ({
  id: layer.id,
  name: 'layer-node',
  x: layer.x,
  y: layer.y,
  rotation: layer.rotation,
  opacity: layer.opacity,
  draggable: !layer.locked,
  visible: layer.visible,
  globalCompositeOperation: layer.blendMode,
  listening: !layer.locked,
  // Slightly emphasise the selected node's hit area; purely cosmetic.
  shadowEnabled: isSelected,
});

export function ImageNode({ layer, isSelected, onSelect, onChange }: NodeProps) {
  const img = layer as ImageLayer;
  const asset = getAsset(img.assetId);
  const [image] = useImage(asset?.url ?? '', 'anonymous');
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);

  return (
    <KonvaImage
      {...commonNodeProps(layer, isSelected)}
      image={image}
      width={img.width}
      height={img.height}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  );
}

export function TextNode({ layer, isSelected, onSelect, onChange }: NodeProps) {
  const t = layer as TextLayer;
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);

  return (
    <KonvaText
      {...commonNodeProps(layer, isSelected)}
      text={t.text}
      width={t.width}
      fontFamily={t.fontFamily}
      fontSize={t.fontSize}
      fontStyle={t.fontStyle}
      fill={t.fill}
      align={t.align}
      lineHeight={t.lineHeight}
      letterSpacing={t.letterSpacing}
      onMouseDown={onSelect}
      onTap={onSelect}
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

export function OverlayNode({ layer, isSelected, onSelect, onChange }: NodeProps) {
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
      {...commonNodeProps(layer, isSelected)}
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

export function ShapeNode({ layer, isSelected, onSelect, onChange }: NodeProps) {
  const s = layer as ShapeLayer;
  const { onDragEnd, onTransformEnd } = useCommonHandlers(layer, onChange);
  return (
    <Rect
      {...commonNodeProps(layer, isSelected)}
      width={s.width}
      height={s.height}
      fill={s.fill}
      cornerRadius={s.shape === 'ellipse' ? Math.min(s.width, s.height) / 2 : s.cornerRadius}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
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
