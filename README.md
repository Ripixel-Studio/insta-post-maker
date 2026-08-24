# Insta Post Maker

A **client-side** editor for Instagram Stories and Posts. Pick a canvas, drop in
images, and get real design-tool controls — crop, gradients, custom fonts, free
transform — then export a pixel-perfect image. No accounts, **no backend**, runs
entirely in the browser (and offline, as a PWA).

See [PLAN.md](PLAN.md) for the full product/architecture plan and roadmap, and
[DEPLOY.md](DEPLOY.md) for Firebase Hosting + CircleCI deployment.

## Status — MVP + most of v2 (everything except cloud deployment)

Working today:

- Canvas presets (Story / Square / Portrait / Landscape) **+ custom size**
- Add **images** (drag-drop, file picker, **clipboard paste**), **text**
- **Bulk photo import**: multi-select the picker or drop a whole batch of files —
  they stage in a collapsible **image tray** (rather than piling up as stacked
  layers), and you click a thumbnail to drop it onto the current page
  (Google-CDN fonts), **gradient overlays**, and **shapes** (rect/ellipse/line)
- Free transform (move / scale / rotate / **flip**) about the centre
- **Image crop** editor (trim-style with aspect presets) and **adjustments**
  (brightness / contrast / saturation / blur) with one-tap filter presets
- **In-browser background removal** (ONNX/WASM, no server)
- **Sticker cutout**: lift the subject onto its own layer for stacking, with an
  optional baked outline — the classic cutout-sticker look
- **Shape masking**: mask an image to a circle, rounded rect, triangle, star or heart
- **Emoji/sticker picker** for quick glyph stickers
- **Rich text**: inline double-click editing, custom fonts (**+ upload your own**),
  drop shadow, background pill, line-height & letter-spacing
- **Collage layouts**: grid templates with drag-to-resize unequal cells, each
  cell cover-fitting a photo with zoom + drag-to-pan
- **Magic resize**: reflow a whole design between formats
- **Templates**: built-in starters + save/apply your own
- **Snapping** + smart alignment guides; per-layer **blend mode**, lock, opacity
- **Eyedropper** + recent colours + a persisted **brand palette**
- Layer panel: reorder, show/hide, duplicate, delete
- Undo/redo, keyboard shortcuts (with a `?` cheatsheet), nudging
- **Projects**: IndexedDB persistence, auto-save, new/open/rename/delete
- **Export** to PNG/JPEG at true resolution (@1x / @2x), **carousel split** into
  N seamless slides, an **animated** Ken Burns clip (MP4 where supported, else
  WebM), + **Web Share** on mobile
- Installable PWA, works offline

The full PLAN.md feature set is implemented — only cloud deployment is left
unrun (intentionally running locally for now). Possible future polish:
free-form mask drawing, keyframe animation, true MP4 everywhere.

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
- `src/actions.ts` — the **editor action layer**: a typed programmatic API over
  the store/exporter (`editorActions`), plus a name-addressable tool registry
  (`EDITOR_TOOLS` / `runAction`) so an AI Copilot can drive the real editor
- `src/canvas/` — the Konva engine: `CanvasStage`, layer `nodes`, `CropOverlay`,
  `CollageView`, snapping `guides`
- `src/export.ts` — full-resolution rasterisation + Web Share, independent of
  the on-screen display scale
- `src/ai/` — bring-your-own-key Claude client (`client.ts`, now with a
  tool-use `createMessage` alongside the text-only `complete`), on-device key
  storage + gating (`storage.ts`, `AiGate`), the **style profile**
  (`styleProfile.ts`): distil a reusable, on-device style profile from a few of
  your finished example posts via a Claude-vision pass, injectable into future
  prompts through `styleProfileToPromptText`; and the **AI Post Copilot**
  (`copilot.ts` + `vision.ts`): a browser-side Claude tool-use loop that drives
  the editor action layer to build a multi-panel post from your uploaded photos
  (vision on the photos + your style profile), with an `ask_user` human-in-the-loop
  tool. UI lives in `components/CopilotPanel.tsx` — a conversation/preview panel
  that offers export. No image generation.
- `src/persistence.ts` / `src/usePersistence.ts` — Dexie/IndexedDB projects + assets
- `src/collage.ts` — collage templates and cell geometry
- `src/filters.ts` — adjustment presets; `src/fonts.ts` — Google-CDN font set
- `src/components/` — toolbar, properties/layers panel, projects menu, help
