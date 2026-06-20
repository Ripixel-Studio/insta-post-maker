import { useEditor } from '../store';
import { FONTS } from '../fonts';
import type { Layer, TextLayer, OverlayLayer, GradientDirection } from '../types';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-violet-400';

function LayersList() {
  const layers = useEditor((s) => s.design.layers);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const moveLayer = useEditor((s) => s.moveLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const updateLayer = useEditor((s) => s.updateLayer);

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Layers
      </h3>
      {layers.length === 0 && (
        <p className="text-sm text-zinc-500">No layers yet. Add an image, text or gradient.</p>
      )}
      {/* Topmost layer first in the panel (reverse of paint order). */}
      <ul className="flex flex-col gap-1">
        {[...layers].reverse().map((layer) => (
          <li
            key={layer.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              layer.id === selectedId ? 'bg-violet-500/20 text-white' : 'hover:bg-white/5'
            }`}
          >
            <button
              className="opacity-60 hover:opacity-100"
              title={layer.visible ? 'Hide' : 'Show'}
              onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
            >
              {layer.visible ? '👁' : '🚫'}
            </button>
            <button className="flex-1 truncate text-left" onClick={() => select(layer.id)}>
              {layer.name}
            </button>
            <button className="opacity-60 hover:opacity-100" title="Bring forward"
              onClick={() => moveLayer(layer.id, 'up')}>↑</button>
            <button className="opacity-60 hover:opacity-100" title="Send backward"
              onClick={() => moveLayer(layer.id, 'down')}>↓</button>
            <button className="opacity-60 hover:opacity-100" title="Delete"
              onClick={() => removeLayer(layer.id)}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommonProps({ layer }: { layer: Layer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  return (
    <Field label={`Opacity — ${Math.round(layer.opacity * 100)}%`}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={layer.opacity}
        className="w-full accent-violet-500"
        onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) })}
      />
    </Field>
  );
}

function TextProps({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const patch = (p: Partial<TextLayer>) => updateLayer(layer.id, p);
  return (
    <>
      <Field label="Text">
        <textarea
          className={inputCls}
          rows={2}
          value={layer.text}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </Field>
      <Field label="Font">
        <select className={inputCls} value={layer.fontFamily}
          onChange={(e) => patch({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.family} value={f.family}>{f.family}</option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <Field label="Size">
          <input type="number" className={inputCls} value={layer.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })} />
        </Field>
        <Field label="Color">
          <input type="color" className="h-9 w-full rounded-md bg-white/5" value={layer.fill}
            onChange={(e) => patch({ fill: e.target.value })} />
        </Field>
      </div>
      <Field label="Align">
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a}
              className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
                layer.align === a ? 'bg-violet-500 text-white' : 'bg-white/5'
              }`}
              onClick={() => patch({ align: a })}>{a}</button>
          ))}
        </div>
      </Field>
      <Field label="Style">
        <div className="flex gap-1">
          {(['normal', 'bold', 'italic', 'italic bold'] as const).map((st) => (
            <button key={st}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                layer.fontStyle === st ? 'bg-violet-500 text-white' : 'bg-white/5'
              }`}
              onClick={() => patch({ fontStyle: st })}>{st}</button>
          ))}
        </div>
      </Field>
    </>
  );
}

function OverlayProps({ layer }: { layer: OverlayLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const directions: GradientDirection[] = ['to-top', 'to-bottom', 'to-left', 'to-right', 'radial'];
  const setStop = (i: number, color: string) => {
    const stops = layer.stops.map((s, idx) => (idx === i ? { ...s, color } : s));
    updateLayer(layer.id, { stops });
  };
  return (
    <>
      <Field label="Direction">
        <select className={inputCls} value={layer.direction}
          onChange={(e) => updateLayer(layer.id, { direction: e.target.value as GradientDirection })}>
          {directions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Gradient stops">
        <div className="flex flex-col gap-2">
          {layer.stops.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                className="h-8 w-12 rounded bg-white/5"
                // Strip alpha for the native picker; alpha stays as authored.
                value={s.color.startsWith('#') ? s.color : '#000000'}
                onChange={(e) => setStop(i, e.target.value)}
              />
              <span className="text-xs text-zinc-400">offset {s.offset}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Tip: the default black→transparent scrim boosts text legibility over photos.
        </p>
      </Field>
    </>
  );
}

export function PropertiesPanel() {
  const selectedId = useEditor((s) => s.selectedId);
  const design = useEditor((s) => s.design);
  const setBackground = useEditor((s) => s.setBackground);
  const layer = design.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#14161b] p-4">
      {!layer && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Canvas
          </h3>
          <Field label="Background">
            <input type="color" className="h-9 w-full rounded-md bg-white/5"
              value={design.background}
              onChange={(e) => setBackground(e.target.value)} />
          </Field>
          <p className="text-sm text-zinc-500">
            {design.width} × {design.height}px. Select a layer to edit it.
          </p>
        </div>
      )}

      {layer && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {layer.name}
          </h3>
          <CommonProps layer={layer} />
          {layer.type === 'text' && <TextProps layer={layer as TextLayer} />}
          {layer.type === 'overlay' && <OverlayProps layer={layer as OverlayLayer} />}
        </div>
      )}

      <div className="mt-auto border-t border-white/10 pt-4">
        <LayersList />
      </div>
    </aside>
  );
}
