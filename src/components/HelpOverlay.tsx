import { useState } from 'react';

const SHORTCUTS: [string, string][] = [
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘D', 'Duplicate selected layer'],
  ['Delete / Backspace', 'Delete selected layer'],
  ['Arrow keys', 'Nudge (Shift = 10px)'],
  ['Esc', 'Deselect / cancel crop'],
  ['Double-click text', 'Edit text inline'],
  ['Drag corner / top handle', 'Scale / rotate'],
  ['Drag onto canvas / paste', 'Add an image'],
];

export function HelpOverlay() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts"
      >
        ?
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#1b1d22] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Keyboard & gestures</h2>
              <button className="text-zinc-400 hover:text-white" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <dl className="flex flex-col gap-2">
              {SHORTCUTS.map(([keys, desc]) => (
                <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="font-mono text-zinc-300">{keys}</dt>
                  <dd className="text-right text-zinc-400">{desc}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-zinc-500">
              Everything runs in your browser — images never leave your device, and work
              auto-saves locally.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
