// The city as a flat grid. No three.js here, so the rules can run under Node (scripts/).

/** Main road, street (real districts only) and alley; widths are MAP.*_WIDTH. */
export const Terrain = { BUILDING: 0, ROAD: 1, ALLEY: 2, STREET: 3 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** 0 = north (−z), 1 = east (+x), 2 = south (+z), 3 = west (−x). */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DX = [0, 1, 0, -1] as const;
export const DZ = [-1, 0, 1, 0] as const;

export const opposite = (dir: Dir): Dir => ((dir + 2) % 4) as Dir;

/** How major each terrain is: buildings 0, then alley, street, main road. */
export const ROAD_RANK: Record<Terrain, number> = { 0: 0, 2: 1, 3: 2, 1: 3 };

export class Grid {
  readonly cellCount: number;
  readonly terrain: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cellCount = width * height;
    this.terrain = new Uint8Array(this.cellCount);
  }

  index(x: number, z: number): number {
    return z * this.width + x;
  }

  x(cell: number): number {
    return cell % this.width;
  }

  z(cell: number): number {
    return Math.floor(cell / this.width);
  }

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  walkable(cell: number): boolean {
    return this.terrain[cell] !== Terrain.BUILDING;
  }

  /** The cell one step away, or −1 past the map edge. */
  neighbor(cell: number, dir: Dir): number {
    const x = this.x(cell) + DX[dir];
    const z = this.z(cell) + DZ[dir];
    return this.inside(x, z) ? this.index(x, z) : -1;
  }

  /** Direction from `from` to the adjacent cell `to`. */
  dirTo(from: number, to: number): Dir {
    const dx = this.x(to) - this.x(from);
    const dz = this.z(to) - this.z(from);
    if (dx > 0) return 1;
    if (dx < 0) return 3;
    return dz > 0 ? 2 : 0;
  }

  /** Steps from the map edge, so 0 on the outermost ring. */
  edgeDistance(cell: number): number {
    const x = this.x(cell);
    const z = this.z(cell);
    return Math.min(x, z, this.width - 1 - x, this.height - 1 - z);
  }

  /**
   * Breadth-first step counts from `sources` over walkable cells, skipping cells where
   * `blocked` is true. Unreached cells are −1. Sources are always distance 0.
   */
  distances(sources: readonly number[], blocked: (cell: number) => boolean, out: Int16Array): Int16Array {
    out.fill(-1);
    const queue = new Int32Array(this.cellCount);
    let head = 0;
    let tail = 0;
    for (const source of sources) {
      out[source] = 0;
      queue[tail++] = source;
    }
    while (head < tail) {
      const cell = queue[head++];
      for (const dir of DIRS) {
        const next = this.neighbor(cell, dir);
        if (next < 0 || out[next] >= 0 || !this.walkable(next) || blocked(next)) continue;
        out[next] = out[cell] + 1;
        queue[tail++] = next;
      }
    }
    return out;
  }
}
