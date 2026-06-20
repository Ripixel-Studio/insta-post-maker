# Insta Post Maker

A **client-side** editor for Instagram Stories and Posts. Pick a canvas, drop in
images, and get real design-tool controls — crop, gradients, custom fonts, free
transform — then export a pixel-perfect image. No accounts, **no backend**, runs
entirely in the browser (and offline, as a PWA).

See [PLAN.md](PLAN.md) for the full product/architecture plan and roadmap, and
[DEPLOY.md](DEPLOY.md) for Firebase Hosting + CircleCI deployment.

## Status — baseline (roadmap step 1)

Working today:

- Canvas presets: Story (1080×1920), Square, Portrait (4:5), Landscape
- Add **images** (drag-drop, file picker), **text** (Google-CDN fonts), and
  **black→transparent gradient overlays** for text legibility
- Free transform (move / scale / rotate) via on-canvas handles
- Layer panel: reorder, show/hide, delete; per-layer opacity
- Undo/redo, keyboard nudging, delete, deselect
- **Export** to PNG/JPEG at true resolution (@1x / @2x)
- Installable PWA, works offline

Next up (see roadmap in PLAN.md): frame/mask crop, filters/adjustments,
collage layouts, IndexedDB project persistence, custom font upload.

## Tech stack

- **Vite + React + TypeScript**
- **Konva / react-konva** — canvas scene graph, transform handles, multi-touch
- **zustand + immer** — state with snapshot-based undo/redo
- **Tailwind CSS** — UI chrome
- **vite-plugin-pwa** — offline / installable
- Fonts from the **Google Fonts CDN**

## Develop

```bash
npm install
npm run dev      # start the dev server
npm run build    # typecheck + production build to dist/
npm run preview  # serve the production build locally
npm run lint     # eslint
```

## Architecture (quick map)

- `src/types.ts` — the serializable **document model** (single source of truth)
- `src/store.ts` — zustand store + undo/redo history
- `src/canvas/` — the Konva rendering engine (`CanvasStage`, layer `nodes`)
- `src/export.ts` — full-resolution rasterisation independent of display scale
- `src/components/` — toolbar and properties/layers panel
- `src/fonts.ts` — curated Google-CDN font set
