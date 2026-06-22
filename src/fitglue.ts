/**
 * FitGlue showcase import. Pulls a public activity showcase's JSON and turns it
 * into a set of "elements" (stats, charts, route, photos) that can be dropped
 * onto a post. Everything stays client-side; the only network call is the
 * public, unauthenticated showcase API.
 */

const API_BASE = 'https://fitglue.tech/api/public/showcase';

export interface StatItem {
  id: string;
  label: string;
  value: string;
}
export interface ChartItem {
  id: string;
  label: string;
  metric: string;
  series: number[];
  color: string;
}
export interface RoutePoint {
  lat: number;
  lng: number;
}
export interface ImageItem {
  id: string;
  label: string;
  url: string;
}
export interface ShowcaseElements {
  title: string;
  subtitle: string;
  stats: StatItem[];
  charts: ChartItem[];
  route: RoutePoint[] | null;
  images: ImageItem[];
}

export type ParsedInput =
  | { type: 'activity'; id: string }
  | { type: 'profile'; slug: string };

/** Classify the input as a single activity (URL/slug) or a profile (@handle). */
export function parseInput(input: string): ParsedInput | null {
  const s = input.trim();
  if (!s) return null;

  let segs: string[];
  if (/^https?:\/\//i.test(s)) {
    try {
      segs = new URL(s).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    } catch {
      return null;
    }
  } else {
    segs = s.split('/').filter(Boolean);
  }
  if (segs.length === 0) return null;
  if (segs.length >= 2) return { type: 'activity', id: segs[segs.length - 1] };

  // Single segment: "@handle" → profile, otherwise treat as an activity slug.
  const only = segs[0];
  if (only.startsWith('@')) return { type: 'profile', slug: only.slice(1) };
  return { type: 'activity', id: only };
}

export async function fetchShowcase(id: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`FitGlue returned ${res.status}`);
  return res.json();
}

export interface ProfileEntry {
  showcaseId: string;
  title: string;
  activityType?: string;
  startTime?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  routeThumbnailUrl?: string;
}

/** List a handle's public activities (most recent first). */
export async function fetchProfile(slug: string): Promise<ProfileEntry[]> {
  const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(slug)}?page=1`);
  if (!res.ok) throw new Error(`FitGlue returned ${res.status}`);
  const data = (await res.json()) as { profile?: { entries?: ProfileEntry[] } };
  return data.profile?.entries ?? [];
}

/** Short label for a profile entry, e.g. "Run · 10.0 km · 49:12". */
export function entrySummary(e: ProfileEntry): string {
  const parts: string[] = [];
  if (e.activityType) parts.push(prettyType(e.activityType));
  if (e.distanceMeters && e.distanceMeters > 0) parts.push(`${(e.distanceMeters / 1000).toFixed(1)} km`);
  if (e.durationSeconds && e.durationSeconds > 0) parts.push(fmtDuration(e.durationSeconds));
  if (e.startTime) {
    const dt = new Date(e.startTime);
    if (!Number.isNaN(dt.getTime())) {
      parts.push(dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
    }
  }
  return parts.join(' · ');
}

/* --------------------------------- helpers -------------------------------- */

let uid = 0;
const nid = (p: string) => `${p}_${(uid += 1)}`;

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

function prettyType(t: string): string {
  return (t || '')
    .replace(/^ACTIVITY_TYPE_/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const CHART_COLORS: Record<string, string> = {
  heartRate: '#ff3b5c',
  altitude: '#4ade80',
  speed: '#22d3ee',
  power: '#f59e0b',
  cadence: '#c084fc',
};
const CHART_LABELS: Record<string, string> = {
  heartRate: 'Heart rate',
  altitude: 'Elevation',
  speed: 'Speed',
  power: 'Power',
  cadence: 'Cadence',
};

/** Downsample a numeric series to at most `max` points. */
function downsample(values: number[], max = 320): number[] {
  if (values.length <= max) return values;
  const step = values.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(values[Math.floor(i * step)]);
  return out;
}

interface Record_ {
  heartRate?: number;
  power?: number;
  cadence?: number;
  speed?: number;
  altitude?: number;
  positionLat?: number;
  positionLong?: number;
}

export function extractElements(data: unknown): ShowcaseElements {
  const d = (data ?? {}) as Record<string, unknown>;
  const enr = (d.enrichments ?? {}) as Record<string, unknown>;
  const activityData = (d.activityData ?? {}) as Record<string, unknown>;
  const sessions = (activityData.sessions ?? []) as Record<string, unknown>[];
  const sess = sessions[0] ?? {};
  const records: Record_[] = sessions.flatMap((s) =>
    ((s.laps ?? []) as Record<string, unknown>[]).flatMap(
      (l) => (l.records ?? []) as Record_[],
    ),
  );

  const get = (obj: unknown, ...keys: string[]): number | undefined => {
    let cur: unknown = obj;
    for (const k of keys) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'number' ? cur : undefined;
  };

  /* ---- stats ---- */
  const stats: StatItem[] = [];
  const push = (label: string, value: string | undefined | null) => {
    if (value != null && value !== '') stats.push({ id: nid('stat'), label, value });
  };

  const distM = get(sess, 'totalDistance');
  if (distM && distM > 0) push('Distance', `${(distM / 1000).toFixed(2)} km`);
  const dur = get(sess, 'totalElapsedTime');
  if (dur && dur > 0) push('Duration', fmtDuration(dur));
  const pace = get(enr, 'pace', 'avgPaceSecondsPerKm');
  if (pace && pace > 0) push('Avg pace', fmtPace(pace));
  const avgHr = get(enr, 'heartRate', 'avgBpm');
  if (avgHr) push('Avg HR', `${Math.round(avgHr)} bpm`);
  const maxHr = get(enr, 'heartRate', 'maxBpm');
  if (maxHr) push('Max HR', `${Math.round(maxHr)} bpm`);
  const kcal = get(enr, 'calories', 'kcal') ?? get(sess, 'totalCalories');
  if (kcal) push('Calories', `${Math.round(kcal)} kcal`);
  const gain = get(enr, 'elevation', 'totalGainM');
  if (gain && gain > 0) push('Elevation', `${Math.round(gain)} m`);
  const cad = get(enr, 'cadence', 'avgRpm');
  if (cad) push('Avg cadence', `${Math.round(cad)} rpm`);
  const pwr = get(enr, 'power', 'avgWatts');
  if (pwr) push('Avg power', `${Math.round(pwr)} W`);
  const effort = get(enr, 'effortScore', 'score');
  if (effort) push('Effort', `${Math.round(effort)}/100`);
  const trimp = get(enr, 'trainingLoad', 'trimp');
  if (trimp) push('Training load', `${Math.round(trimp)}`);

  /* ---- charts ---- */
  const charts: ChartItem[] = [];
  for (const metric of ['heartRate', 'altitude', 'speed', 'power', 'cadence'] as const) {
    const series = downsample(
      records.map((r) => Number(r[metric] ?? 0)),
    ).map((v) => (Number.isFinite(v) ? v : 0));
    const nonZero = series.filter((v) => v > 0).length;
    if (nonZero >= 20) {
      charts.push({
        id: nid('chart'),
        label: CHART_LABELS[metric],
        metric,
        series,
        color: CHART_COLORS[metric],
      });
    }
  }

  /* ---- route ---- */
  const pts = records
    .filter((r) => r.positionLat && r.positionLong)
    .map((r) => ({ lat: r.positionLat as number, lng: r.positionLong as number }));
  const route = pts.length >= 10 ? pts : null;

  /* ---- images ---- */
  const images: ImageItem[] = [];
  const photoUrls = (d.photoUrls ?? []) as string[];
  photoUrls.forEach((url, i) => images.push({ id: nid('img'), label: `Photo ${i + 1}`, url }));
  const banner = (enr.aiBanner as Record<string, unknown> | undefined)?.imageUrl;
  if (typeof banner === 'string') images.push({ id: nid('img'), label: 'AI banner', url: banner });
  const heat = (enr.muscleHeatmap as Record<string, unknown> | undefined)?.imageUrl;
  if (typeof heat === 'string') images.push({ id: nid('img'), label: 'Muscle map', url: heat });

  /* ---- title / subtitle ---- */
  const title = (d.title as string) || 'Activity';
  const typeLabel = prettyType(d.activityType as string);
  let dateLabel = '';
  const start = d.startTime as string | undefined;
  if (start) {
    const dt = new Date(start);
    if (!Number.isNaN(dt.getTime())) {
      dateLabel = dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  const subtitle = [typeLabel, dateLabel].filter(Boolean).join(' · ');

  return { title, subtitle, stats, charts, route, images };
}
