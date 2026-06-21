import { useEditor } from '../store';

/** Minimal typing for the (Chromium) EyeDropper API. */
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperLike {
  open: () => Promise<EyeDropperResult>;
}
declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperLike;
  }
}

interface Props {
  value: string;
  onChange: (color: string) => void;
}

/** A colour swatch + native picker, an eyedropper (where supported), and a
 * row of recently-used colours shared across the editor. */
export function ColorField({ value, onChange }: Props) {
  const recentColors = useEditor((s) => s.recentColors);
  const pushRecentColor = useEditor((s) => s.pushRecentColor);
  const brandColors = useEditor((s) => s.brandColors);
  const addBrandColor = useEditor((s) => s.addBrandColor);
  const removeBrandColor = useEditor((s) => s.removeBrandColor);

  const pick = (color: string) => {
    onChange(color);
    pushRecentColor(color);
  };

  async function eyedrop() {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      pick(result.sRGBHex);
    } catch {
      /* cancelled */
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 flex-1 rounded-md bg-white/5"
          value={value.startsWith('#') ? value : '#000000'}
          onChange={(e) => pick(e.target.value)}
        />
        {window.EyeDropper && (
          <button
            type="button"
            className="h-9 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10"
            title="Pick a colour from the screen"
            onClick={eyedrop}
          >
            💧
          </button>
        )}
        <button
          type="button"
          className="h-9 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10"
          title="Save to brand palette"
          onClick={() => addBrandColor(value)}
        >
          ★
        </button>
      </div>

      {brandColors.length > 0 && (
        <div className="mt-1.5">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Brand</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {brandColors.map((c) => (
              <button
                key={c}
                className="group relative h-5 w-5 rounded border border-white/15"
                style={{ background: c }}
                title={`${c} — click to use, shift-click to remove`}
                onClick={(e) => (e.shiftKey ? removeBrandColor(c) : pick(c))}
              />
            ))}
          </div>
        </div>
      )}

      {recentColors.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {recentColors.map((c) => (
            <button
              key={c}
              className="h-5 w-5 rounded border border-white/15"
              style={{ background: c }}
              title={c}
              onClick={() => pick(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
