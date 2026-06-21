# Insta Post Maker

A **client-side** editor for Instagram Stories and Posts. Pick a canvas, drop in
images, and get real design-tool controls — crop, gradients, custom fonts, free
transform — then export a pixel-perfect image. No accounts, **no backend**, runs
entirely in the browser (and offline, as a PWA).

See [PLAN.md](PLAN.md) for the full product/architecture plan and roadmap, and
[DEPLOY.md](DEPLOY.md) for Firebase Hosting + CircleCI deployment.

## Status — MVP complete (everything except cloud deployment)

Working today:

- Canvas presets (Story / Square / Portrait / Landscape) **+ custom size**
- Add **images** (drag-drop, file picker, **clipboard paste**), **text**
  (Google-CDN fonts), **gradient overlays**, and **shapes** (rect/ellipse/line)
- Free transform (move / scale / rotate / **flip**) about the centre
- **Image crop** editor (trim-style with aspect presets) and **adjustments**
  (brightness / contrast / saturation / blur) with one-tap filter presets
- **Rich text**: inline double-click editing, custom fonts, drop shadow,
  background pill, line-height & letter-spacing
- **Collage layouts**: grid templates with drag-to-resize unequal cells, each
  cell cover-fitting a photo with zoom + drag-to-pan
- **Snapping** + smart alignment guides; per-layer **blend mode**, lock, opacity
- Layer panel: reorder, show/hide, duplicate, delete
- Undo/redo, keyboard shortcuts (with a `?` cheatsheet), nudging
- **Projects**: IndexedDB persistence, auto-save, new/open/rename/delete
- **Export** to PNG/JPEG at true resolution (@1x / @2x) + **Web Share** on mobile
- Installable PWA, works offline

Deferred (v2, see PLAN.md): in-browser background removal, magic resize,
templates gallery, custom font upload, carousel split, animated export.

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
- `src/store.ts` — zustand store + undo/redo history + ephemeral UI state
- `src/canvas/` — the Konva engine: `CanvasStage`, layer `nodes`, `CropOverlay`,
  `CollageView`, snapping `guides`
- `src/export.ts` — full-resolution rasterisation + Web Share, independent of
  the on-screen display scale
- `src/persistence.ts` / `src/usePersistence.ts` — Dexie/IndexedDB projects + assets
- `src/collage.ts` — collage templates and cell geometry
- `src/filters.ts` — adjustment presets; `src/fonts.ts` — Google-CDN font set
- `src/components/` — toolbar, properties/layers panel, projects menu, help
