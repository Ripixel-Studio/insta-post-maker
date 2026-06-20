import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { Collage, CollageCell } from '../types';
import { cellRect, type Rect as CellRectT } from '../collage';
import { getAsset } from '../assets';
import { useEditor } from '../store';

interface CellProps {
  cell: CollageCell;
  rect: CellRectT;
  selected: boolean;
  onSelect: () => void;
  onFill: () => void;
}

function CellView({ cell, rect, selected, onSelect, onFill }: CellProps) {
  const asset = getAsset(cell.assetId ?? '');
  const [image] = useImage(asset?.url ?? '', 'anonymous');
  const updateCell = useEditor((s) => s.updateCell);

  const clip = { clipX: rect.x, clipY: rect.y, clipWidth: rect.width, clipHeight: rect.height };

  if (!asset || !image) {
    return (
      <Group {...clip}>
        <Rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="#23262e"
          stroke={selected ? '#c084fc' : '#3a3d47'}
          strokeWidth={selected ? 3 : 1}
          dash={[8, 6]}
          onMouseDown={onSelect}
          onClick={onFill}
          onTap={onFill}
        />
        <Text
          x={rect.x}
          y={rect.y + rect.height / 2 - 12}
          width={rect.width}
          align="center"
          text="+ Add photo"
          fontSize={Math.min(28, rect.width / 8)}
          fill="#6b7280"
          listening={false}
        />
      </Group>
    );
  }

  // Cover-fit the source into the cell, then apply per-cell zoom & pan.
  const coverScale =
    Math.max(rect.width / asset.width, rect.height / asset.height) * cell.zoom;
  const imgW = asset.width * coverScale;
  const imgH = asset.height * coverScale;
  const rangeX = imgW - rect.width;
  const rangeY = imgH - rect.height;
  const x = rect.x - rangeX * cell.offsetX;
  const y = rect.y - rangeY * cell.offsetY;

  return (
    <Group {...clip}>
      <KonvaImage
        image={image}
        x={x}
        y={y}
        width={imgW}
        height={imgH}
        draggable={selected}
        dragBoundFunc={(pos) => ({
          x: Math.min(rect.x, Math.max(rect.x - rangeX, pos.x)),
          y: Math.min(rect.y, Math.max(rect.y - rangeY, pos.y)),
        })}
        onMouseDown={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          const node = e.target as Konva.Image;
          updateCell(cell.id, {
            offsetX: rangeX > 0 ? (rect.x - node.x()) / rangeX : 0.5,
            offsetY: rangeY > 0 ? (rect.y - node.y()) / rangeY : 0.5,
          });
        }}
      />
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        stroke={selected ? '#c084fc' : undefined}
        strokeWidth={selected ? 3 : 0}
        listening={false}
      />
    </Group>
  );
}

interface GutterProps {
  axis: 'x' | 'y';
  index: number;
  position: number; // px
  length: number; // px (canvas extent on the other axis)
  thickness: number;
  onCommit: (valueNorm: number) => void;
  total: number; // canvas extent on this axis (for normalising)
}

function Gutter({ axis, position, length, thickness, onCommit, total }: GutterProps) {
  const common = {
    fill: '#c084fc',
    opacity: 0.0001, // invisible but hittable; cursor hint below
    draggable: true,
  };
  if (axis === 'x') {
    return (
      <Rect
        {...common}
        x={position - thickness / 2}
        y={0}
        width={thickness}
        height={length}
        dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}
        onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'col-resize')}
        onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = 'default')}
        onDragEnd={(e) => onCommit((e.target.x() + thickness / 2) / total)}
      />
    );
  }
  return (
    <Rect
      {...common}
      x={0}
      y={position - thickness / 2}
      width={length}
      height={thickness}
      dragBoundFunc={(pos) => ({ x: 0, y: pos.y })}
      onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'row-resize')}
      onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = 'default')}
      onDragEnd={(e) => onCommit((e.target.y() + thickness / 2) / total)}
    />
  );
}

interface Props {
  collage: Collage;
  width: number;
  height: number;
  onRequestFill: (cellId: string) => void;
}

export function CollageView({ collage, width, height, onRequestFill }: Props) {
  const selectedCellId = useEditor((s) => s.selectedCellId);
  const selectCell = useEditor((s) => s.selectCell);
  const setSplit = useEditor((s) => s.setSplit);

  return (
    <Group>
      {collage.cells.map((c) => (
        <CellView
          key={c.id}
          cell={c}
          rect={cellRect(collage, c, width, height)}
          selected={c.id === selectedCellId}
          onSelect={() => selectCell(c.id)}
          onFill={() => {
            selectCell(c.id);
            if (!c.assetId) onRequestFill(c.id);
          }}
        />
      ))}

      {/* Vertical gutters */}
      {collage.splitsX.map((s, i) => (
        <Gutter
          key={`gx${i}`}
          axis="x"
          index={i}
          position={s * width}
          length={height}
          thickness={Math.max(16, collage.gap)}
          total={width}
          onCommit={(v) => setSplit('x', i, v)}
        />
      ))}
      {/* Horizontal gutters */}
      {collage.splitsY.map((s, i) => (
        <Gutter
          key={`gy${i}`}
          axis="y"
          index={i}
          position={s * height}
          length={width}
          thickness={Math.max(16, collage.gap)}
          total={height}
          onCommit={(v) => setSplit('y', i, v)}
        />
      ))}
    </Group>
  );
}
