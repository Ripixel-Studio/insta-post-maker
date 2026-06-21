# Insta Post Maker — Plan

A **client-side canvas editor** purpose-built for Instagram formats. Pick a canvas
(Story / Post / etc.), drop in images, and get real design-tool controls — crop,
layouts, gradients, custom fonts, filters, free transform — then export a
pixel-perfect image ready to upload. No accounts, **no backend at all**, works offline.

## 1. Canvas formats (presets)

| Preset | Pixels | Ratio |
|---|---|---|
| Story / Reel cover | 1080 × 1920 | 9:16 |
| Post — Square | 1080 × 1080 | 1:1 |
| Post — Portrait (max) | 1080 × 1350 | 4:5 |
| Post — Landscape | 1080 × 566 | 1.91:1 |
| Carousel | N × (1080×1080 or 1080×1350) | multi-page |
| Custom | any | free |

Editing happens in "document coordinates" (e.g. 1080×1920) but the canvas is
*displayed* scaled-to-fit. Export always renders at true resolution (with an optional
@2x = 2160-wide option for extra crispness before Instagram's compression).

## 2. Feature set

**MVP (v1)**
- Multiple canvas presets + custom size; switch/duplicate canvas
- Add images via drag-drop, file picker, or paste; multiple images per canvas
- Free transform: move, scale (corner handles, aspect-lock), rotate, flip
- **Crop** — two models: *trim crop* (cut the image down) and *frame/mask crop*
  (image sits in a frame; pan & pinch-zoom within it — like IG's cell crop). Layouts reuse this.
- **Layouts / collage**: grid templates with adjustable, *unequal* cell sizes
- **Text**: custom fonts, size, color, alignment, spacing, shadow, background pill
- **Gradient overlays**: presets (bottom scrim, top scrim, vignette) + gradient editor;
  opacity & blend mode — for text-legibility scrims
- **Adjustments/filters**: brightness, contrast, saturation, exposure, blur, presets
- Shapes (rect/ellipse/line), solid/gradient backgrounds
- **Layer panel**: reorder, lock, hide, opacity, blend mode, group
- **Undo/redo**, snapping + smart alignment guides, nudge with arrows
- **Export** PNG/JPEG at exact dimensions
- Auto-save; works offline (PWA)

**Later (v2+)**
- Background removal (in-browser, no server — `@imgly/background-removal` / MediaPipe)
- Magic resize (re-flow a Story design into a Post)
- Templates gallery + your own saved templates
- Stickers/emoji/shapes, masking with any shape
- Eyedropper, brand palettes, saved fonts
- Carousel split (one wide image → N slides)
- Animated/MP4 export for Stories

## 3. Architecture & stack

Pure front-end, static-hostable. **No backend, now or planned for v1.**

- **Vite + React + TypeScript**
- **Konva via react-konva** — scene graph, transformer handles, hit-testing, drag,
  multi-touch out of the box
- **zustand + immer** for state, with history → undo/redo
- **TailwindCSS** for UI chrome
- **Dexie / IndexedDB** for project + image-blob persistence
- **vite-plugin-pwa** for installable/offline
- **Fonts via Google Fonts CDN** (curated set), plus upload-your-own via `FontFace` API
- Optional later: Web Worker + OffscreenCanvas for heavy image processing

### Rendering engine (the heart)

A serializable **document model** is the single source of truth:

```
Document { width, height, background, layers[] }
Layer = Image | Text | Shape | Overlay
  - transform { x, y, scaleX, scaleY, rotation }, opacity, blendMode
  - Image: assetId, crop, filters[]
  - Text: content, fontFamily, size, fill, spacing, shadow…
  - Overlay: gradient stops, direction
```

- **Edit mode**: Stage scaled to viewport; Konva `Transformer` drives handles.
- **Export mode**: render an offscreen Stage at full document size → `toBlob()`.
  Wait on `document.fonts.ready` and draw images from full-res originals.
- Plain-JSON doc gives save/load projects, templates, and magic-resize cheaply.

## 4. Image handling — 100% client-side

- Ingest via File API, drag-drop, clipboard paste; respect EXIF orientation.
- Keep the **original blob** for export quality; generate a downscaled texture for editing.
- Store originals as blobs in IndexedDB so projects survive refresh.
- Heavy ops run in a Worker/OffscreenCanvas to keep UI at 60fps.
- Photos never leave the device.

## 5. Controls (mouse / touch / keyboard)

- **Mouse**: drag move, corner handles to scale (Shift = aspect lock), rotate handle,
  double-click image → crop, scroll/⌘-scroll zoom, marquee select.
- **Touch**: one-finger drag, two-finger pinch-zoom + rotate, tap select, long-press menu.
- **Keyboard**: ⌘Z/⇧⌘Z undo/redo, arrows nudge (Shift=10px), ⌘C/⌘V/⌘D, Del, Esc,
  `[`/`]` reorder, ⌘G group, space-drag pan, `+/-` zoom. Discoverable cheatsheet.

## 6. Fonts

- Curated set loaded from **Google Fonts CDN**.
- **Upload-your-own**: load `.ttf/.otf/.woff2` via `FontFace` API client-side.
- Guarantee fonts are loaded (`document.fonts.ready`) before any render/export.

## 7. Export

- **PNG** (lossless, transparency) and **JPEG** (quality slider); WebP optional.
- Exact target pixels per preset; **@1x and @2x** options.
- sRGB; strip metadata.
- **Carousel** → export N pages as a numbered set or zip.
- Mobile **Web Share API** to push the exported file straight into Instagram.

## 8. Deployment

**PWA-first single static web app**, deployed to **Firebase Hosting** via **CircleCI**.

- One codebase serves desktop + mobile, installable, offline.
- CircleCI builds on every branch and deploys `main` to Firebase Hosting.
- No backend, no Cloud Functions — Hosting serves static assets only.
- See `DEPLOY.md` for setup (Firebase project, CI token, env vars).

## 9. Phased roadmap

1. ✅ **Scaffold + engine**: Vite/React/Konva, document model, presets,
   display-scaling, export pipeline.
2. ✅ **Images**: import (drag/picker/paste), transform, crop, persistence.
3. ✅ **Text + fonts**: inline editing, shadow, background pill, spacing.
   *(Custom font upload deferred to v2.)*
4. ✅ **Overlays/gradients + filters** (legibility scrims + adjustments/presets).
5. ✅ **Layouts/collage** with resizable unequal cells.
6. ✅ **Layers panel, undo/redo, snapping, shortcuts** (+ blend mode, lock, flip).
7. ✅ **PWA + share/export options** (PNG/JPEG @1x/@2x, Web Share). Firebase/CircleCI
   deploy config is in the repo but **deployment is intentionally not run yet**
   (running locally for now).
8. ✅ **v2 (mostly done)**: in-browser background removal, magic resize,
   templates gallery + save-as-template, custom font upload, eyedropper +
   recent-colour palette, carousel split. *(Still later: stickers/emoji,
   arbitrary-shape masking, brand palettes, animated/MP4 export.)*
