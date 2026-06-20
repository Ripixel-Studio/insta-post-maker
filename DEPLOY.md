# Deployment

This app is a purely static, client-side SPA. It builds with `npm run build` into
`dist/` and is hosted on **Firebase Hosting**, deployed automatically via **CircleCI**.

## Prerequisites

1. **Create a Firebase project** at <https://console.firebase.google.com> (Hosting is
   enabled by default; no other Firebase products are required).
2. **Install the Firebase CLI** locally if you need a deploy token or want to deploy
   manually:
   ```bash
   npm install -g firebase-tools
   ```
3. **Generate a CI deploy token:**
   ```bash
   firebase login:ci
   ```
   This opens a browser, asks you to authenticate, and prints a token. Copy it — this
   is the value for `FIREBASE_TOKEN` below.

## CircleCI environment variables

Set these in **CircleCI → Project Settings → Environment Variables**:

| Variable             | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| `FIREBASE_TOKEN`     | The token printed by `firebase login:ci`.                    |
| `FIREBASE_PROJECT_ID`| Your Firebase project ID (e.g. `insta-post-maker-1a2b3`).    |

The pipeline (`.circleci/config.yml`) runs `build` on every branch and `deploy` only
on `main` (deploy depends on a successful build; the built `dist/` is passed between
jobs via a workspace).

## Swap in your real project ID

`.firebaserc` ships with a placeholder default project. Edit it to match your real
Firebase project ID:

```json
{
  "projects": {
    "default": "your-real-project-id"
  }
}
```

(`FIREBASE_PROJECT_ID` in CircleCI also overrides this at deploy time via the
`--project` flag, so keeping them in sync is recommended but the CI deploy will use
the env var regardless.)

## Manual deploy (fallback)

If you need to deploy by hand:

```bash
npm run build
firebase deploy --only hosting
```

This uses the project in `.firebaserc`. To target a specific project explicitly:

```bash
firebase deploy --only hosting --project your-real-project-id
```

## Caching / PWA notes

`firebase.json` sets a long, immutable cache (`max-age=31536000`) for hashed build
assets under `/assets/**` and for js/css/woff2/image files, while `index.html`, the
service worker (`sw.js` / `service-worker.js`), and `manifest.webmanifest` are served
`no-cache` so PWA/service-worker updates are picked up immediately.
