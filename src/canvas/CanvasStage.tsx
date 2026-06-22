import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer as KonvaLayer, Rect, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useEditor, activePage, combinedLayers } from '../store';
import { LayerNode } from './nodes';
import { CropOverlay } from './CropOverlay';
import { CollageView } from './CollageView';
import { stageHolder } from './stageHolder';
import { SmartGuides } from './SmartGuides';
import { computeGuides, type Guide } from './guides';
import { addImageAsset } from '../assets';
import type { Layer, ImageLayer, TextLayer, CropRect } from '../types';

/** Padding (px) around the canvas inside its viewport container. */
const VIEWPORT_PADDING = 48;

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
];

export function CanvasStage() {
  const design = useEditor((s) => s.design);
  const pageLayers = useEditor((s) => activePage(s).layers);
  const sharedLayers = useEditor((s) => s.design.shared);
  const pageBackground = useEditor((s) => activePage(s).background);
  const pageCollage = useEditor((s) => activePage(s).collage);
  const pageCount = useEditor((s) => s.design.pages.length);
  const activePageIndex = useEditor((s) => s.activePageIndex);
  const setActivePage = useEditor((s) => s.setActivePage);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const updateLayer = useEditor((s) => s.updateLayer);
  const cropTargetId = useEditor((s) => s.cropTargetId);
  const setCropTarget = useEditor((s) => s.setCropTarget);
  const editingTextId = useEditor((s) => s.editingTextId);
  const setEditingText = useEditor((s) => s.setEditingText);
  const selectCell = useEditor((s) => s.selectCell);
  const updateCell = useEditor((s) => s.updateCell);

  // Page layers (bottom) + shared layers (on top).
  const renderLayers = [...pageLayers, ...sharedLayers];

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const fillInputRef = useRef<HTMLInputElement>(null);
  const pendingCellRef = useRef<string | null>(null);
  const gestureRef = useRef<{ dist: number; angle: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<Guide[]>([]);

  // Two-finger pinch-to-scale + twist-to-rotate on the selected layer — much
  // easier than the small transformer handles on a touch screen.
  function onStageTouchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    const touches = e.evt.touches;
    if (touches.length !== 2) return;
    const state = useEditor.getState();
    const { selectedId, liveUpdateLayer, beginGesture } = state;
    if (!selectedId) return;
    const layer = combinedLayers(state).find((l) => l.id === selectedId);
    if (!layer || layer.locked) return;
    e.evt.preventDefault();

    const a = touches[0];
    const b = touches[1];
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    const info = { dist: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };

    if (!gestureRef.current) {
      gestureRef.current = info;
      beginGesture();
      stageRef.current?.findOne(`#${selectedId}`)?.stopDrag();
      return;
    }

    const scaleBy = info.dist / gestureRef.current.dist;
    const dAngle = info.angle - gestureRef.current.angle;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const newW = Math.max(5, layer.width * scaleBy);
    const newH = Math.max(5, layer.height * scaleBy);
    const patch: Partial<Layer> = {
      x: cx - newW / 2,
      y: cy - newH / 2,
      width: newW,
      height: newH,
      rotation: layer.rotation + dAngle,
    };
    if (layer.type === 'text') {
      (patch as Partial<TextLayer>).fontSize = Math.max(
        4,
        Math.round((layer as TextLayer).fontSize * scaleBy),
      );
    }
    liveUpdateLayer(selectedId, patch);
    gestureRef.current = info;
  }

  function onStageTouchEnd(e: Konva.KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length < 2) gestureRef.current = null;
  }

  // Horizontal swipe across empty canvas switches pages (mobile). Starting on a
  // layer drags it instead, so swipes only begin on the background.
  const swipeRef = useRef<{ x: number; bg: boolean } | null>(null);
  function onSwipeStart(e: Konva.KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length !== 1) {
      swipeRef.current = null;
      return;
    }
    const onBg = e.target === e.target.getStage() || e.target.name() === 'doc-background';
    swipeRef.current = { x: e.evt.touches[0].clientX, bg: onBg };
  }
  function onSwipeEnd(e: Konva.KonvaEventObject<TouchEvent>) {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || !s.bg || gestureRef.current) return;
    const dx = (e.evt.changedTouches[0]?.clientX ?? s.x) - s.x;
    if (Math.abs(dx) < 60) return;
    const { activePageIndex, design, setActivePage } = useEditor.getState();
    const next = dx < 0 ? activePageIndex + 1 : activePageIndex - 1;
    if (next >= 0 && next < design.pages.length) setActivePage(next);
  }

  async function onFillFile(file: File | undefined) {
    const cellId = pendingCellRef.current;
    pendingCellRef.current = null;
    if (!file || !cellId || !file.type.startsWith('image/')) return;
    try {
      const asset = await addImageAsset(file);
      updateCell(cellId, { assetId: asset.id, zoom: 1, offsetX: 0.5, offsetY: 0.5 });
    } catch (err) {
      console.error(err);
    }
  }

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

  useEffect(() => {
    stageHolder.current = stageRef.current;
    return () => {
      stageHolder.current = null;
    };
  });

  // Keep the transformer attached to the selected node (disabled in crop mode).
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (!selectedId || cropTargetId || editingTextId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = stage.findOne(`#${selectedId}`);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, cropTargetId, editingTextId, pageLayers, sharedLayers, activePageIndex]);

  const onBackgroundClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (cropTargetId) return;
    if (e.target === e.target.getStage() || e.target.name() === 'doc-background') {
      select(null);
      selectCell(null);
    }
  };

  const cropLayer =
    cropTargetId &&
    (renderLayers.find((l) => l.id === cropTargetId) as ImageLayer | undefined);

  function commitCrop(crop: CropRect, box: { width: number; height: number }) {
    if (cropTargetId) updateLayer(cropTargetId, { crop, ...box });
    setCropTarget(null);
  }

  const editingLayer =
    editingTextId &&
    (renderLayers.find((l) => l.id === editingTextId) as TextLayer | undefined);

  return (
    <div
      ref={containerRef}
      className="canvas-surface relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <input
        ref={fillInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onFillFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {scale > 0 && (
        <div className="relative shadow-2xl" style={{ width: stageWidth, height: stageHeight }}>
          <Stage
            ref={stageRef}
            width={stageWidth}
            height={stageHeight}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={onBackgroundClick}
            onTouchStart={(e) => {
              onBackgroundClick(e);
              onSwipeStart(e);
            }}
            onTouchMove={onStageTouchMove}
            onTouchEnd={(e) => {
              onStageTouchEnd(e);
              onSwipeEnd(e);
            }}
          >
            <KonvaLayer>
              <Rect
                name="doc-background"
                x={0}
                y={0}
                width={design.width}
                height={design.height}
                fill={pageBackground}
              />

              {!cropTargetId && pageCollage && (
                <CollageView
                  collage={pageCollage}
                  width={design.width}
                  height={design.height}
                  onRequestFill={(cellId) => {
                    pendingCellRef.current = cellId;
                    fillInputRef.current?.click();
                  }}
                />
              )}

              {!cropTargetId &&
                renderLayers.map((layer) =>
                  layer.id === editingTextId ? null : (
                    <LayerNode
                      key={layer.id}
                      layer={layer}
                      isSelected={layer.id === selectedId}
                    />
                  ),
                )}

              {cropLayer && (
                <CropOverlay
                  layer={cropLayer}
                  designWidth={design.width}
                  designHeight={design.height}
                  onCommit={commitCrop}
                />
              )}

              <SmartGuides guides={guides} />

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

          {/* Live alignment guides while dragging a node. */}
          <DragGuideTracker stageRef={stageRef} onGuides={setGuides} />

          {/* Inline text editor overlay. */}
          {editingLayer && (
            <textarea
              autoFocus
              className="absolute resize-none border-0 bg-transparent p-0 leading-none outline-none"
              style={{
                left: editingLayer.x * scale,
                top: editingLayer.y * scale,
                width: editingLayer.width * scale,
                height: editingLayer.height * scale,
                fontSize: editingLayer.fontSize * scale,
                fontFamily: editingLayer.fontFamily,
                color: editingLayer.fill,
                textAlign: editingLayer.align,
                lineHeight: editingLayer.lineHeight,
                fontWeight: editingLayer.fontStyle.includes('bold') ? 700 : 400,
                fontStyle: editingLayer.fontStyle.includes('italic') ? 'italic' : 'normal',
              }}
              value={editingLayer.text}
              onChange={(e) => updateLayer(editingLayer.id, { text: e.target.value })}
              onBlur={() => setEditingText(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  setEditingText(null);
                }
              }}
            />
          )}
        </div>
      )}

      {/* Crop-mode floating toolbar. */}
      {cropTargetId && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-[#14161b] px-3 py-2 shadow-2xl">
          <span className="mr-1 text-xs uppercase tracking-wide text-zinc-400">Crop</span>
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              className="rounded-md bg-white/5 px-2.5 py-1 text-sm hover:bg-white/10"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('crop-aspect', { detail: a.ratio }))
              }
            >
              {a.label}
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-white/10" />
          <button
            className="rounded-md px-3 py-1 text-sm hover:bg-white/10"
            onClick={() => setCropTarget(null)}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-violet-500 px-3 py-1 text-sm font-semibold hover:bg-violet-400"
            onClick={() => window.dispatchEvent(new Event('crop-commit'))}
          >
            Apply
          </button>
        </div>
      )}

      {/* Page indicator dots (swipe between pages on mobile). */}
      {pageCount > 1 && !cropTargetId && (
        <div className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/40 px-2 py-1">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              className={`h-2 w-2 rounded-full ${i === activePageIndex ? 'bg-violet-400' : 'bg-white/40'}`}
              onClick={() => setActivePage(i)}
              title={`Page ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Clears alignment guides shortly after a drag ends. The Stage's nodes emit
 * dragmove on the stage, which we sample to recompute guides. */
function DragGuideTracker({
  stageRef,
  onGuides,
}: {
  stageRef: React.RefObject<Konva.Stage | null>;
  onGuides: (g: Guide[]) => void;
}) {
  const width = useEditor((s) => s.design.width);
  const height = useEditor((s) => s.design.height);
  const pageLayers = useEditor((s) => activePage(s).layers);
  const sharedLayers = useEditor((s) => s.design.shared);
  const selectedId = useEditor((s) => s.selectedId);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const layers = [...pageLayers, ...sharedLayers];
    const onMove = () => {
      if (selectedId) onGuides(computeGuides(layers, width, height, selectedId, stage));
    };
    const onEnd = () => onGuides([]);
    stage.on('dragmove', onMove);
    stage.on('dragend', onEnd);
    return () => {
      stage.off('dragmove', onMove);
      stage.off('dragend', onEnd);
    };
  }, [stageRef, pageLayers, sharedLayers, width, height, selectedId, onGuides]);

  return null;
}
