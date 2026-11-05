// Converts 台北東區 from OpenStreetMap into src/map/east.json (spec §13.4).
// Run with `npm run build:map`. The raw download is cached in scripts/.osm-cache/; delete it
// to fetch fresh data. Prints a report of every road kept and how wide it became.

import fs from 'node:fs';
import path from 'node:path';
import { MAP, SNAKE } from '../src/config';
import { DIRS, Grid, ROAD_RANK, Terrain } from '../src/grid';
import { BUILDING_COLORS, BuildingKind } from '../src/map/city';
import type { DistrictData } from '../src/map/east';
import { Rng } from '../src/rng';

// npm runs scripts from the package root.
const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'scripts/.osm-cache/east-raw.json');
const BUILDING_CACHE = path.join(ROOT, 'scripts/.osm-cache/east-buildings-raw.json');
const OUT = path.join(ROOT, 'src/map/east.json');

/** South, west, north, east. A little larger than the district so the boundary roads are whole. */
const BBOX = [25.035, 121.546, 25.044, 121.56] as const;
const QUERY = `[out:json][timeout:60];way["highway"](${BBOX.join(',')});out geom tags;`;
const BUILDING_QUERY = `[out:json][timeout:90];way["building"](${BBOX.join(',')});out geom tags;`;
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const CELL_METRES = 10;

/** The four roads around the district; they become the ring road. */
const BOUNDARY = { north: '忠孝東路四段', south: '仁愛路四段', west: '敦化南路一段', east: '光復南路' } as const;
/** Parts of the boundary that are not plain roads, e.g. the roundabout at 仁愛 × 敦化. */
const BOUNDARY_EXTRA = new Set(['仁愛敦南圓環']);

/**
 * Road rank by OSM `highway` (spec §13.3): 3 main road, 2 street, 1 alley. Anything else is not
 * a road for the snake. CELLS_BY_RANK turns a rank into a width (spec §14.1).
 */
const RANK_BY_CLASS: Record<string, number> = {
  trunk: 3,
  trunk_link: 3,
  primary: 3,
  primary_link: 3,
  secondary: 3,
  secondary_link: 3,
  tertiary: 2,
  tertiary_link: 2,
  residential: 1,
  unclassified: 1,
  living_street: 1,
  service: 1,
};
/** `service=*` values that are not streets. */
const SKIPPED_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through', 'emergency_access']);
/** Per-name corrections where the OSM class gives the wrong rank. Empty while the tags look right. */
const RANK_BY_NAME: Record<string, number> = {};

const CELLS_BY_RANK: Record<number, number> = { 3: MAP.ROAD_WIDTH, 2: MAP.STREET_WIDTH, 1: MAP.ALLEY_WIDTH };
const RING = MAP.ROAD_WIDTH;

/**
 * Floors by the most major road a lot touches (spec §13.5), for buildings OSM gives no height.
 * Lots touching no road count as alley lots.
 */
const FLOORS_BY_RANK: Record<number, [number, number]> = { 3: [8, 12], 2: [5, 8], 1: [4, 5], 0: [4, 5] };
/** Real floor counts are kept, within these limits (a few towers are over 20 floors). */
const MIN_FLOORS = 2;
const MAX_FLOORS = 20;
/** For buildings tagged with a height but no floor count. */
const METRES_PER_FLOOR = 3.3;
/** Real buildings may make bigger lots than generated ones; they are drawn joined anyway. */
const REAL_LOT_MAX = 8;
const BUILDING_SEED = 2026;

/** OSM `building=*` → kind (spec §14.4). Anything not listed is an apartment block. */
const KIND_BY_CLASS: Record<string, BuildingKind> = {
  commercial: BuildingKind.OFFICE,
  office: BuildingKind.OFFICE,
  hotel: BuildingKind.OFFICE,
  retail: BuildingKind.MALL,
  department_store: BuildingKind.MALL,
  supermarket: BuildingKind.MALL,
  school: BuildingKind.SCHOOL,
  university: BuildingKind.SCHOOL,
  college: BuildingKind.SCHOOL,
  kindergarten: BuildingKind.SCHOOL,
  hospital: BuildingKind.HOSPITAL,
  public: BuildingKind.PUBLIC,
  government: BuildingKind.PUBLIC,
  civic: BuildingKind.PUBLIC,
};
/** Names that give the use away when the class does not, e.g. `building=yes` 百貨. Only for the kind; names are never shown. */
const KIND_BY_NAME: Array<[RegExp, BuildingKind]> = [
  [/百貨|購物|商場/, BuildingKind.MALL],
  [/商業|銀行|金融|金控|企業|貿易|飯店|酒店|辦公/, BuildingKind.OFFICE],
  [/醫院/, BuildingKind.HOSPITAL],
  [/國小|國中|高中|學校|幼兒園/, BuildingKind.SCHOOL],
];
/** `building=*` values that are not buildings you could walk into from the street. */
const SKIPPED_BUILDINGS = new Set(['roof', 'construction', 'ruins', 'carport']);

interface OsmWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

// ---------------------------------------------------------------------------------------------
// Download

async function download(cache: string, query: string): Promise<OsmWay[]> {
  if (!fs.existsSync(cache)) {
    let wait = 5;
    for (let attempt = 1; ; attempt++) {
      console.log(`downloading ${path.basename(cache)} from Overpass (attempt ${attempt})…`);
      const response = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'User-Agent': 'snake-city-build-map/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      const text = await response.text();
      if (response.ok && text.trimStart().startsWith('{')) {
        fs.mkdirSync(path.dirname(cache), { recursive: true });
        fs.writeFileSync(cache, text);
        break;
      }
      if (attempt >= 6) throw new Error(`Overpass failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
      console.log(`  HTTP ${response.status}, retrying in ${wait} s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      wait *= 2;
    }
  }
  const data = JSON.parse(fs.readFileSync(cache, 'utf8')) as { elements?: unknown[] };
  if (!Array.isArray(data.elements)) throw new Error(`${cache} is not an Overpass response; delete it and retry.`);
  return data.elements.filter((element): element is OsmWay => {
    const way = element as OsmWay;
    return way.type === 'way' && Array.isArray(way.geometry) && way.geometry.length >= 2;
  });
}

// ---------------------------------------------------------------------------------------------
// Geometry

interface Point {
  x: number;
  z: number;
}

const LAT0 = (BBOX[0] + BBOX[2]) / 2;
const LON0 = (BBOX[1] + BBOX[3]) / 2;

/** Metres east (x) and south (z) of the box centre; equirectangular is fine at this size. */
function project(lat: number, lon: number): Point {
  return {
    x: (lon - LON0) * Math.cos((LAT0 * Math.PI) / 180) * 111_320,
    z: -(lat - LAT0) * 110_574,
  };
}

const insideBox = (p: { lat: number; lon: number }) => p.lat >= BBOX[0] && p.lat <= BBOX[2] && p.lon >= BBOX[1] && p.lon <= BBOX[3];

/** Least-squares slope of `along` → `across`. */
function slope(points: Point[], along: 'x' | 'z'): number {
  const across = along === 'x' ? 'z' : 'x';
  const n = points.length;
  const ma = points.reduce((sum, p) => sum + p[along], 0) / n;
  const mc = points.reduce((sum, p) => sum + p[across], 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p[along] - ma) * (p[across] - mc);
    den += (p[along] - ma) ** 2;
  }
  return num / den;
}

const rotate = (p: Point, angle: number): Point => ({
  x: p.x * Math.cos(angle) - p.z * Math.sin(angle),
  z: p.x * Math.sin(angle) + p.z * Math.cos(angle),
});

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Clip segment a→b to the rectangle; null when it misses. Liang–Barsky. */
function clip(a: Point, b: Point, min: Point, max: Point): [Point, Point] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [p, q] of [
    [-dx, a.x - min.x],
    [dx, max.x - a.x],
    [-dz, a.z - min.z],
    [dz, max.z - a.z],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (t0 > t1) return null;
  return [
    { x: a.x + t0 * dx, z: a.z + t0 * dz },
    { x: a.x + t1 * dx, z: a.z + t1 * dz },
  ];
}

// ---------------------------------------------------------------------------------------------
// Road graph, pruned of dead ends before drawing (spec §13.4 step 4)

interface Edge {
  a: string;
  b: string;
  from: Point;
  to: Point;
  rank: number;
  name: string;
}

const key = (p: Point) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;

/** Drop edges ending in a node nothing else uses, until none are left. Anchored nodes stay. */
function pruneGraph(edges: Edge[], anchored: (node: string) => boolean): Edge[] {
  let alive = edges;
  for (;;) {
    const degree = new Map<string, number>();
    for (const edge of alive) {
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }
    const dead = (node: string) => degree.get(node) === 1 && !anchored(node);
    const next = alive.filter((edge) => edge.a !== edge.b && !dead(edge.a) && !dead(edge.b));
    if (next.length === alive.length) return next;
    alive = next;
  }
}

// ---------------------------------------------------------------------------------------------
// Rasterising

const TERRAIN_BY_RANK: Record<number, Terrain> = { 3: Terrain.ROAD, 2: Terrain.STREET, 1: Terrain.ALLEY };

function paint(grid: Grid, x: number, z: number, rank: number): void {
  if (!grid.inside(x, z)) return;
  const cell = grid.index(x, z);
  if (ROAD_RANK[grid.terrain[cell] as Terrain] < rank) grid.terrain[cell] = TERRAIN_BY_RANK[rank];
}

/**
 * Draw a road of `rank` along a segment in cell coordinates. The centre track is kept
 * 4-connected (no diagonal-only steps), so the snake can follow any road it can see.
 */
function drawSegment(grid: Grid, from: Point, to: Point, rank: number): void {
  const width = CELLS_BY_RANK[rank];
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.z - from.z);
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(length * 4));
  let previous: { x: number; z: number } | null = null;
  const band = (x: number, z: number, centre: number) => {
    const low = Math.round(centre - width / 2);
    for (let k = 0; k < width; k++) {
      if (horizontal) paint(grid, x, low + k, rank);
      else paint(grid, low + k, z, rank);
    }
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const cell = { x: Math.floor(x), z: Math.floor(z) };
    if (previous && previous.x !== cell.x && previous.z !== cell.z) {
      // Diagonal step: fill the corner so the track stays 4-connected.
      if (horizontal) band(cell.x, previous.z, previous.z + 0.5);
      else band(previous.x, cell.z, previous.x + 0.5);
    }
    band(cell.x, cell.z, horizontal ? z : x);
    previous = cell;
  }
}

/** Fill streets with fewer than two ways out, again and again (spec §13.4 step 4). */
function pruneDeadEnds(grid: Grid): number {
  let filled = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (let cell = 0; cell < grid.cellCount; cell++) {
      if (!grid.walkable(cell)) continue;
      const exits = DIRS.filter((dir) => {
        const next = grid.neighbor(cell, dir);
        return next >= 0 && grid.walkable(next);
      }).length;
      if (exits < 2) {
        grid.terrain[cell] = Terrain.BUILDING;
        filled++;
        changed = true;
      }
    }
  }
  return filled;
}

/** Keep only streets connected to the ring road. */
function keepConnected(grid: Grid): number {
  const distance = grid.distances([0], () => false, new Int16Array(grid.cellCount));
  let filled = 0;
  for (let cell = 0; cell < grid.cellCount; cell++) {
    if (grid.walkable(cell) && distance[cell] < 0) {
      grid.terrain[cell] = Terrain.BUILDING;
      filled++;
    }
  }
  return filled;
}

// ---------------------------------------------------------------------------------------------
// Buildings (spec §13.5)

/** A real building from OSM, outlined in cell coordinates. */
interface RealBuilding {
  outline: Point[];
  area: number;
  /** Floors from `building:levels` or `height`; 0 when OSM does not say. */
  floors: number;
  kind: BuildingKind;
}

function realBuilding(way: OsmWay, toCell: (lat: number, lon: number) => Point): RealBuilding | null {
  const tags = way.tags ?? {};
  if (SKIPPED_BUILDINGS.has(tags.building ?? '') || tags.location === 'underground') return null;
  const outline = way.geometry!.map((p) => toCell(p.lat, p.lon));
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    area += a.x * b.z - b.x * a.z;
  }
  area = Math.abs(area) / 2;
  if (area <= 0) return null;
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  const metres = Number.parseFloat(tags.height ?? '');
  const floors = levels > 0 ? Math.round(levels) : metres > 0 ? Math.round(metres / METRES_PER_FLOOR) : 0;
  let kind = KIND_BY_CLASS[tags.building ?? ''] ?? BuildingKind.APARTMENT;
  if (kind === BuildingKind.APARTMENT && tags.building !== 'apartments' && tags.building !== 'residential') {
    kind = KIND_BY_NAME.find(([pattern]) => pattern.test(tags.name ?? ''))?.[1] ?? kind;
  }
  return { outline, area, floors, kind };
}

/** Even–odd point-in-polygon test. */
function inside(p: Point, outline: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** For every building cell, the smallest real building over its centre, or −1. */
function buildingOfCells(grid: Grid, buildings: RealBuilding[]): Int32Array {
  const owner = new Int32Array(grid.cellCount).fill(-1);
  buildings.forEach((building, index) => {
    const xs = building.outline.map((p) => p.x);
    const zs = building.outline.map((p) => p.z);
    for (let z = Math.max(0, Math.floor(Math.min(...zs))); z <= Math.min(grid.height - 1, Math.floor(Math.max(...zs))); z++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(grid.width - 1, Math.floor(Math.max(...xs))); x++) {
        const cell = grid.index(x, z);
        if (grid.walkable(cell) || !inside({ x: x + 0.5, z: z + 0.5 }, building.outline)) continue;
        if (owner[cell] < 0 || buildings[owner[cell]].area > building.area) owner[cell] = index;
      }
    }
  });
  return owner;
}

/**
 * Cut the building cells into rectangular lots, each inside one real building (or inside none).
 * Lots of the same real building share a group, floors, kind and colour.
 */
function buildLots(grid: Grid, buildings: RealBuilding[]): { lots: DistrictData['lots']; realCells: number; realFloors: number } {
  const rng = new Rng(BUILDING_SEED);
  const owner = buildingOfCells(grid, buildings);
  const taken = new Uint8Array(grid.cellCount);
  const rects: Array<{ x: number; z: number; w: number; d: number; owner: number }> = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const start = grid.inside(x, z) ? owner[grid.index(x, z)] : -1;
      const isFree = (fx: number, fz: number) =>
        grid.inside(fx, fz) && !grid.walkable(grid.index(fx, fz)) && !taken[grid.index(fx, fz)] && owner[grid.index(fx, fz)] === start;
      if (!isFree(x, z)) continue;
      // Grow a rectangle right, then down, up to the lot size limit.
      const max = start >= 0 ? REAL_LOT_MAX : MAP.LOT_MAX;
      const limitW = start >= 0 ? max : rng.int(2, max);
      const limitD = start >= 0 ? max : rng.int(2, max);
      let w = 1;
      while (w < limitW && isFree(x + w, z)) w++;
      let d = 1;
      while (d < limitD && Array.from({ length: w }, (_, i) => isFree(x + i, z + d)).every(Boolean)) d++;
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) taken[grid.index(x + i, z + j)] = 1;
      rects.push({ x, z, w, d, owner: start });
    }
  }

  /** The most major road along a rectangle's edge. */
  const widestRoad = (r: { x: number; z: number; w: number; d: number }) => {
    let widest = 0;
    for (let j = -1; j <= r.d; j++) {
      for (let i = -1; i <= r.w; i++) {
        const edge = i === -1 || i === r.w || j === -1 || j === r.d;
        const corner = (i === -1 || i === r.w) && (j === -1 || j === r.d);
        if (!edge || corner || !grid.inside(r.x + i, r.z + j)) continue;
        widest = Math.max(widest, ROAD_RANK[grid.terrain[grid.index(r.x + i, r.z + j)] as Terrain]);
      }
    }
    return widest;
  };

  // One look per real building: its parts are joined, so they must match.
  const looks = new Map<number, { floors: number; color: number; kind: BuildingKind; group: number }>();
  let realCells = 0;
  let realFloors = 0;
  const lots: DistrictData['lots'] = rects.map((rect, index) => {
    let look = rect.owner >= 0 ? looks.get(rect.owner) : undefined;
    if (!look) {
      const building = rect.owner >= 0 ? buildings[rect.owner] : null;
      const widest = Math.max(...rects.filter((r) => r === rect || (rect.owner >= 0 && r.owner === rect.owner)).map(widestRoad));
      const [low, high] = FLOORS_BY_RANK[widest];
      const guess = rng.int(low, high);
      const floors = building?.floors ? Math.min(MAX_FLOORS, Math.max(MIN_FLOORS, building.floors)) : guess;
      // Unknown buildings on the main roads are mostly offices.
      const kind = building?.kind ?? (widest === 3 ? BuildingKind.OFFICE : BuildingKind.APARTMENT);
      look = { floors, color: rng.int(0, BUILDING_COLORS - 1), kind, group: index };
      if (rect.owner >= 0) looks.set(rect.owner, look);
    }
    if (rect.owner >= 0) {
      realCells += rect.w * rect.d;
      if (buildings[rect.owner].floors) realFloors += rect.w * rect.d;
    }
    return [rect.x, rect.z, rect.w, rect.d, look.floors, look.color, look.kind, look.group];
  });
  return { lots, realCells, realFloors };
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const ways = await download(CACHE, QUERY);
  const buildingWays = await download(BUILDING_CACHE, BUILDING_QUERY);
  const named = (name: string) => ways.filter((way) => way.tags?.name === name);
  const boundaryPoints = (name: string) =>
    named(name)
      .flatMap((way) => way.geometry!)
      .filter(insideBox)
      .map((p) => project(p.lat, p.lon));

  // Turn the map so the boundary roads run as straight as possible along the grid.
  const north = boundaryPoints(BOUNDARY.north);
  const south = boundaryPoints(BOUNDARY.south);
  const west = boundaryPoints(BOUNDARY.west);
  const east = boundaryPoints(BOUNDARY.east);
  for (const [side, points] of Object.entries({ north, south, west, east })) {
    if (points.length < 2) throw new Error(`Boundary road '${BOUNDARY[side as keyof typeof BOUNDARY]}' not found.`);
  }
  const alpha = Math.atan(mean([slope(north, 'x'), slope(south, 'x')]));
  const beta = Math.atan(mean([slope(west, 'z'), slope(east, 'z')]));
  const angle = (beta - alpha) / 2;
  const turn = (points: Point[]) => points.map((p) => rotate(p, angle));

  // Centre lines of the ring, in rotated metres.
  const top = mean(turn(north).map((p) => p.z));
  const bottom = mean(turn(south).map((p) => p.z));
  const left = mean(turn(west).map((p) => p.x));
  const right = mean(turn(east).map((p) => p.x));
  const width = Math.round((right - left) / CELL_METRES) + RING;
  const height = Math.round((bottom - top) / CELL_METRES) + RING;
  // Rotated metres → cell coordinates; the ring's centre lines land in the middle of its RING cells.
  const toCell = (p: Point): Point => ({
    x: ((p.x - left) / (right - left)) * (width - RING) + RING / 2,
    z: ((p.z - top) / (bottom - top)) * (height - RING) + RING / 2,
  });

  // Every other road, as graph edges clipped to the inside of the ring.
  const boundaryNames = new Set<string>([...Object.values(BOUNDARY), ...BOUNDARY_EXTRA]);
  const ringNodes = new Set<string>();
  const edges: Edge[] = [];
  const skipped = new Map<string, number>();
  const inner = { min: { x: RING / 2, z: RING / 2 }, max: { x: width - RING / 2, z: height - RING / 2 } };
  for (const way of ways) {
    const tags = way.tags ?? {};
    const name = tags.name ?? '(無名)';
    const points = way.geometry!.map((p) => toCell(rotate(project(p.lat, p.lon), angle)));
    if (boundaryNames.has(name)) {
      for (const p of points) ringNodes.add(key(p));
      continue;
    }
    let rank = RANK_BY_NAME[name] ?? RANK_BY_CLASS[tags.highway ?? ''];
    if (tags.highway === 'service' && SKIPPED_SERVICE.has(tags.service ?? '')) rank = 0;
    if (tags.access === 'private' || tags.access === 'no') rank = 0;
    if (!rank) {
      const reason = `${tags.highway}${tags.service ? `/${tags.service}` : ''}${tags.access ? ` access=${tags.access}` : ''}`;
      skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      continue;
    }
    for (let i = 1; i < points.length; i++) {
      const clipped = clip(points[i - 1], points[i], inner.min, inner.max);
      if (!clipped) continue;
      const [from, to] = clipped;
      edges.push({ a: key(from), b: key(to), from, to, rank, name });
    }
  }

  // Nodes on or right next to the ring connect to it, so they never count as dead ends.
  const nearRing = (node: string) => {
    const [x, z] = node.split(',').map(Number);
    return x < RING + 1 || z < RING + 1 || x > width - RING - 1 || z > height - RING - 1;
  };
  const kept = pruneGraph(edges, (node) => ringNodes.has(node) || nearRing(node));

  // Draw: ring road first, then the kept edges, widest wins.
  const grid = new Grid(width, height);
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (x < RING || z < RING || x >= width - RING || z >= height - RING) grid.terrain[grid.index(x, z)] = Terrain.ROAD;
    }
  }
  for (const edge of kept) drawSegment(grid, edge.from, edge.to, edge.rank);
  const deadEndCells = pruneDeadEnds(grid);
  const cutOffCells = keepConnected(grid);
  const buildings = buildingWays
    .map((way) => realBuilding(way, (lat, lon) => toCell(rotate(project(lat, lon), angle))))
    .filter((building): building is RealBuilding => building !== null);
  const { lots, realCells, realFloors } = buildLots(grid, buildings);

  const rows: string[] = [];
  const CHAR: Record<Terrain, string> = { 0: '#', 1: 'R', 2: 'A', 3: 'S' };
  for (let z = 0; z < height; z++) {
    let row = '';
    for (let x = 0; x < width; x++) row += CHAR[grid.terrain[grid.index(x, z)] as Terrain];
    rows.push(row);
  }
  const district: DistrictData = {
    name: '台北東區',
    attribution: '© OpenStreetMap contributors',
    width,
    height,
    rows,
    lots,
  };
  // One row or lot per line, so diffs stay readable.
  const json = [
    '{',
    `  "name": ${JSON.stringify(district.name)},`,
    `  "attribution": ${JSON.stringify(district.attribution)},`,
    `  "width": ${width},`,
    `  "height": ${height},`,
    '  "rows": [',
    rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n'),
    '  ],',
    '  "lots": [',
    lots.map((lot) => `    ${JSON.stringify(lot)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(OUT, json);

  // Report.
  const byName = new Map<string, { rank: number; edges: number; keptEdges: number }>();
  for (const edge of edges) {
    const entry = byName.get(edge.name) ?? { rank: edge.rank, edges: 0, keptEdges: 0 };
    entry.edges++;
    byName.set(edge.name, entry);
  }
  for (const edge of kept) byName.get(edge.name)!.keptEdges++;
  const counts: Record<string, number> = { R: 0, S: 0, A: 0, '#': 0 };
  for (const row of rows) for (const char of row) counts[char]++;
  let openPatches = 0;
  for (let z = 1; z < height - 1; z++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid.terrain[grid.index(x, z)] !== Terrain.ALLEY) continue;
      let open = true;
      for (let j = -1; j <= 1 && open; j++) for (let i = -1; i <= 1; i++) if (!grid.walkable(grid.index(x + i, z + j))) open = false;
      if (open) openPatches++;
    }
  }

  console.log(`\n台北東區 → ${path.relative(ROOT, OUT)}`);
  console.log(`rotation ${((angle * 180) / Math.PI).toFixed(2)}°, ring ${((right - left) | 0)} m × ${((bottom - top) | 0)} m`);
  console.log(`grid ${width} × ${height} = ${width * height} cells (random city: ${MAP.SIZE} × ${MAP.SIZE} = ${MAP.SIZE ** 2})`);
  console.log(`walkable ${counts.R + counts.S + counts.A}: main road ${counts.R}, street ${counts.S}, alley ${counts.A}; buildings ${counts['#']} in ${lots.length} lots`);
  console.log(`road graph: ${edges.length} segments, ${kept.length} kept after dead-end pruning`);
  console.log(`grid pruning: ${deadEndCells} dead-end cells filled, ${cutOffCells} cut-off cells filled`);
  console.log(`alley cells with no building around them (open patches): ${openPatches}`);
  const kindNames = ['apartment', 'office', 'mall', 'school', 'hospital', 'public'];
  const kindCells = new Map<string, number>();
  for (const lot of lots) kindCells.set(kindNames[lot[6]], (kindCells.get(kindNames[lot[6]]) ?? 0) + lot[2] * lot[3]);
  console.log(`real buildings: ${buildings.length} from OSM; ${realCells} of ${counts['#']} building cells under one, ${realFloors} with a real floor count`);
  console.log(`building cells by kind: ${[...kindCells].map(([kind, cells]) => `${kind} ${cells}`).join(', ')}`);
  console.log('\nroads (name: width, segments kept / inside):');
  for (const [name, entry] of [...byName].sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))) {
    console.log(`  ${name}: ${CELLS_BY_RANK[entry.rank]} cells, ${entry.keptEdges} / ${entry.edges}`);
  }
  console.log('\nskipped ways (class: count):');
  for (const [reason, count] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`  ${reason}: ${count}`);
  console.log('');
  for (const row of rows) console.log(row.replaceAll('#', '·'));
  if (SNAKE.INITIAL_LENGTH > Math.min(width, height)) throw new Error('Map too small for the snake.');
}

await main();
