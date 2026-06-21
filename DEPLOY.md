# Deployment

This app is a purely static, client-side SPA. It builds with `npm run build` into
`dist/` and is hosted on **Firebase Hosting**.

## Live site

- **URL:** <https://insta-post-maker-ripixel.web.app>
- **Firebase project:** `insta-post-maker-ripixel`
- **Console:** <https://console.firebase.google.com/project/insta-post-maker-ripixel/overview>

The first deploy was done manually with the Firebase CLI (logged in as
ripixel@gmail.com). To ship a change, run the manual deploy below. CircleCI
automation is wired up in `.circleci/config.yml` but **not yet active** — it needs
the repo pushed to a Git remote (GitHub/Bitbucket) and the env vars set (see below).

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

## Manual deploy (current method)

```bash
npm run build
firebase deploy --only hosting
```

This uses the project in `.firebaserc` (`insta-post-maker-ripixel`). To target a
specific project explicitly:

```bash
firebase deploy --only hosting --project insta-post-maker-ripixel
```

## Caching / PWA notes

`firebase.json` sets a long, immutable cache (`max-age=31536000`) for hashed build
assets under `/assets/**` and for js/css/woff2/image files, while the root (`/`),
`index.html`, the service worker (`sw.js` / `service-worker.js`), and
`manifest.webmanifest` are served `no-cache` so PWA/service-worker updates are picked
up immediately. (Firebase matches header rules against the *request* path, so the
root `/` needs its own rule — a request to `/` never matches the `/index.html` rule.)
