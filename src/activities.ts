/**
 * Activities from James's site. james.ripixel.co.uk/life pre-renders, for every
 * recent activity, race and roundup, a set of share cards and *transparent
 * overlays* — the numbers, route, splits, HR, top sets, PB stamps… drawn once,
 * in a light and a dark tone, ready to lay over a photo (the way Strava's and
 * ROXFIT's overlays work). This module reads the site's public manifest of
 * those files and places them on the canvas as ordinary image layers.
 *
 * Replaces the FitGlue showcase import (fitglue.tech is retired). The only
 * network calls are the public manifest and its PNGs, which the site serves
 * with `Access-Control-Allow-Origin: *` so the canvas stays exportable.
 */

export const MANIFEST_URL = 'https://james.ripixel.co.uk/life/share/index.json';

export type Tone = 'light' | 'dark';

export interface Overlay {
  piece: string;
  label: string;
  tone: Tone;
  url: string;
  w: number;
  h: number;
}

export interface ActivityCard {
  /** "activity:<slug>", "event:<slug>", "roundup:<key>". */
  id: string;
  kind: 'activity' | 'event' | 'roundup';
  slug: string;
  template: string;
  title: string;
  label: string;
  date: string;
  page: string;
  /** The Story share card (photo or colour), a full 1080×1920 image. */
  image: string;
  race: boolean;
  pb: boolean;
  overlays: Overlay[];
}

export interface Manifest {
  generatedAt: string;
  cards: ActivityCard[];
}

/** One piece with both tones, as the panel and the Copilot list it. */
export interface OverlayPiece {
  piece: string;
  label: string;
  /** A layout covers the whole canvas (Story / Square); a piece is a sticker. */
  layout: boolean;
  tones: Partial<Record<Tone, Overlay>>;
}

let cached: Promise<Manifest> | null = null;

/** Forget the cached manifest (tests, or a manual refresh). */
export function clearActivityCache(): void {
  cached = null;
}

function asCard(c: unknown): ActivityCard | null {
  const o = (c ?? {}) as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string') return null;
  const overlays = (Array.isArray(o.overlays) ? o.overlays : [])
    .map((v) => v as Record<string, unknown>)
    .filter((v) => typeof v.url === 'string' && typeof v.piece === 'string' && (v.tone === 'light' || v.tone === 'dark'))
    .map((v) => ({
      piece: v.piece as string,
      label: typeof v.label === 'string' ? v.label : (v.piece as string),
      tone: v.tone as Tone,
      url: v.url as string,
      w: Number(v.w) || 0,
      h: Number(v.h) || 0,
    }));
  return {
    id: o.id,
    kind: (o.kind as ActivityCard['kind']) ?? 'activity',
    slug: typeof o.slug === 'string' ? o.slug : o.id,
    template: typeof o.template === 'string' ? o.template : '',
    title: o.title,
    label: typeof o.label === 'string' ? o.label : '',
    date: typeof o.date === 'string' ? o.date : '',
    page: typeof o.page === 'string' ? o.page : '',
    image: typeof o.image === 'string' ? o.image : '',
    race: !!o.race,
    pb: !!o.pb,
    overlays,
  };
}

/** The site's manifest, newest first (fetched once per page load). */
export function fetchManifest(fetchImpl: typeof fetch = fetch): Promise<Manifest> {
  if (!cached) {
    cached = (async () => {
      const res = await fetchImpl(MANIFEST_URL);
      if (!res.ok) throw new Error(`The site returned ${res.status} for its activity list.`);
      const data = (await res.json()) as { generatedAt?: string; cards?: unknown[] };
      const cards = (data.cards ?? []).map(asCard).filter((c): c is ActivityCard => !!c);
      return { generatedAt: data.generatedAt ?? '', cards };
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** Activities that have overlays (recent ones, and every race), newest first. */
export async function listActivities(fetchImpl?: typeof fetch): Promise<ActivityCard[]> {
  const { cards } = await fetchManifest(fetchImpl);
  return cards.filter((c) => c.overlays.length > 0);
}

/** Find one card by its id ("activity:slug"), slug, or a page URL on the site. */
export async function findActivity(ref: string, fetchImpl?: typeof fetch): Promise<ActivityCard> {
  const s = ref.trim();
  const { cards } = await fetchManifest(fetchImpl);
  let slug = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      slug = new URL(s).pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? s;
    } catch {
      /* not a URL after all */
    }
  }
  const hit = cards.find((c) => c.id === s || c.slug === slug);
  if (!hit) throw new Error(`No activity "${ref}" on the site. Call activity_list for the recent ones.`);
  return hit;
}

/** Group a card's overlays by piece, layouts first, in the manifest's order. */
export function overlayPieces(card: ActivityCard): OverlayPiece[] {
  const by = new Map<string, OverlayPiece>();
  for (const o of card.overlays) {
    let p = by.get(o.piece);
    if (!p) {
      p = { piece: o.piece, label: o.label, layout: o.piece.startsWith('layout-'), tones: {} };
      by.set(o.piece, p);
    }
    p.tones[o.tone] = o;
  }
  return [...by.values()].sort((a, b) => Number(b.layout) - Number(a.layout));
}

/** "Hyrox · 28 Oct" — a short line for a picker row. */
export function cardSummary(c: ActivityCard): string {
  const parts: string[] = [];
  if (c.label) parts.push(c.label.charAt(0).toUpperCase() + c.label.slice(1));
  const dt = new Date(c.date);
  if (!Number.isNaN(dt.getTime())) parts.push(dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  if (c.race) parts.push('race');
  else if (c.pb) parts.push('PB');
  return parts.join(' · ');
}

/**
 * Where an overlay lands on a canvas of `cw`×`ch`: a layout fills the canvas
 * (contain, centred); a piece keeps the size it was drawn at relative to a
 * 1080-wide post, capped at 80% of the canvas, centred.
 */
export function overlayBox(o: Pick<Overlay, 'w' | 'h'> & { layout: boolean }, cw: number, ch: number) {
  const w0 = o.w || 1080;
  const h0 = o.h || 1080;
  const scale = o.layout ? Math.min(cw / w0, ch / h0) : Math.min(cw / 1080, (cw * 0.8) / w0, (ch * 0.8) / h0);
  const width = Math.round(w0 * scale);
  const height = Math.round(h0 * scale);
  return { x: Math.round((cw - width) / 2), y: Math.round((ch - height) / 2), width, height };
}

/** Fetch an image from the site as a Blob (CORS-enabled, so export still works). */
export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const res = await fetchImpl(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`The site returned ${res.status} for ${url}.`);
  return res.blob();
}
