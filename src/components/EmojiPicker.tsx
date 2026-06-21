import { useState } from 'react';
import { useEditor } from '../store';

const EMOJI = [
  '🔥', '✨', '⭐', '💫', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🏃', '🏃‍♀️', '🚴', '🏊', '🥇', '🏅', '🎽', '⏱️', '💪', '🦵',
  '🎉', '🎊', '🙌', '👏', '👀', '😎', '🥳', '😅', '🤩', '😤',
  '☀️', '🌧️', '🌈', '⚡', '❄️', '🌬️', '📍', '🗓️', '📈', '💯',
];

export function EmojiPicker() {
  const addEmoji = useEditor((s) => s.addEmoji);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-white/10"
        onClick={() => setOpen((o) => !o)}
      >
        + Emoji
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-white/10 bg-[#1b1d22] p-2 shadow-2xl">
          <div className="grid grid-cols-8 gap-1">
            {EMOJI.map((e) => (
              <button
                key={e}
                className="rounded-md p-1 text-xl hover:bg-white/10"
                onClick={() => {
                  addEmoji(e);
                  setOpen(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
