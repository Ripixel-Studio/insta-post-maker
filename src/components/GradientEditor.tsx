import { ColorField } from './ColorField';
import type { GradientFill } from '../types';

/** Edits a two-stop linear gradient (start colour, end colour, angle). */
export function GradientEditor({
  value,
  onChange,
}: {
  value: GradientFill;
  onChange: (g: GradientFill) => void;
}) {
  const setStop = (i: number, color: string) => {
    const stops = value.stops.map((s, idx) => (idx === i ? { ...s, color } : s));
    onChange({ ...value, stops });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">From</span>
        <ColorField value={value.stops[0]?.color ?? '#ffffff'} onChange={(c) => setStop(0, c)} />
      </div>
      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">To</span>
        <ColorField value={value.stops[1]?.color ?? '#000000'} onChange={(c) => setStop(1, c)} />
      </div>
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">
          Angle — {Math.round(value.angle)}°
        </span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={value.angle}
          className="w-full accent-violet-500"
          onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
