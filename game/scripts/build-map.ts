// Converts 台北東區 from OpenStreetMap into src/map/east.json (spec §13.4).
// Run with `npm run build:map`. The raw download is cached in scripts/.osm-cache/; delete it
// to fetch fresh data. Prints a report of every road kept and how wide it became.

import fs from 'node:fs';
import path from 'node:path';
import { MAP, SNAKE } from '../src/config';
import { DIRS, Grid, ROAD_RANK, Terrain } from '../src/grid';
import { BUILDING_COLORS } from '../src/map/city';
import type { DistrictData } from '../src/map/east';
import { Rng } from '../src/rng';

// npm runs scripts from the package root.
const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'scripts/.osm-cache/east-raw.json');
const OUT = path.join(ROOT, 'src/map/east.json');

/** South, west, north, east. A little larger than the district so the boundary roads are whole. */
const BBOX = [25.035, 121.546, 25.044, 121.56] as const;
const QUERY = `[out:json][timeout:60];way["highway"](${BBOX.join(',')});out geom tags;`;
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

/** Floors by the most major road a lot touches (spec §13.5). Lots touching no road count as alley lots. */
const FLOORS_BY_RANK: Record<number, [number, number]> = { 3: [8, 12], 2: [5, 8], 1: [4, 5], 0: [4, 5] };
const BUILDING_SEED = 2026;

interface OsmWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

// ---------------------------------------------------------------------------------------------
// Download

async function download(): Promise<OsmWay[]> {
  if (!fs.existsSync(CACHE)) {
    let wait = 5;
    for (let attempt = 1; ; attempt++) {
      console.log(`downloading from Overpass (attempt ${attempt})…`);
      const response = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'User-Agent': 'snake-city-build-map/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: QUERY }),
      });
      const text = await response.text();
      if (response.ok && text.trimStart().startsWith('{')) {
        fs.mkdirSync(path.dirname(CACHE), { recursive: true });
        fs.writeFileSync(CACHE, text);
        break;
      }
      if (attempt >= 6) throw new Error(`Overpass failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
      console.log(`  HTTP ${response.status}, retrying in ${wait} s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      wait *= 2;
    }
  }
  const data = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as { elements?: unknown[] };
  if (!Array.isArray(data.elements)) throw new Error(`${CACHE} is not an Overpass response; delete it and retry.`);
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

function buildLots(grid: Grid): DistrictData['lots'] {
  const rng = new Rng(BUILDING_SEED);
  const taken = new Uint8Array(grid.cellCount);
  const isFreeBuilding = (x: number, z: number) =>
    grid.inside(x, z) && !grid.walkable(grid.index(x, z)) && !taken[grid.index(x, z)];
  const lots: DistrictData['lots'] = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      if (!isFreeBuilding(x, z)) continue;
      // Grow a rectangle right, then down, up to the lot size limit.
      const limitW = rng.int(2, MAP.LOT_MAX);
      const limitD = rng.int(2, MAP.LOT_MAX);
      let w = 1;
      while (w < limitW && isFreeBuilding(x + w, z)) w++;
      let d = 1;
      while (d < limitD && Array.from({ length: w }, (_, i) => isFreeBuilding(x + i, z + d)).every(Boolean)) d++;
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) taken[grid.index(x + i, z + j)] = 1;

      // The most major road along the lot's edge sets its height.
      let widest = 0;
      for (let j = -1; j <= d; j++) {
        for (let i = -1; i <= w; i++) {
          const edge = i === -1 || i === w || j === -1 || j === d;
          const corner = (i === -1 || i === w) && (j === -1 || j === d);
          if (!edge || corner || !grid.inside(x + i, z + j)) continue;
          widest = Math.max(widest, ROAD_RANK[grid.terrain[grid.index(x + i, z + j)] as Terrain]);
        }
      }
      const [low, high] = FLOORS_BY_RANK[widest];
      lots.push([x, z, w, d, rng.int(low, high), rng.int(0, BUILDING_COLORS - 1)]);
    }
  }
  return lots;
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const ways = await download();
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
  const lots = buildLots(grid);

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
