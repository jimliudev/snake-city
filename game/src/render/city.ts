// Streets, buildings and the see-through effect for buildings in front of the head (spec §7.1,
// §7.4). Real districts get Taiwanese details on top (spec §14).

import * as THREE from 'three';
import { CAMERA, MAP, OCCLUSION, RENDER } from '../config';
import { Terrain, type Grid } from '../grid';
import type { CityMap, Lot } from '../map/city';
import { addBuilding, type BuildingKit, type WindowSpot } from './buildings';
import { boxMatrix, groundBox, lotHeight, lotShapes, onWall, ROOF_HEIGHT, SIDEWALK_HEIGHT } from './facades';
import { LotParts } from './lotParts';
import { BUILDING_PALETTE, COLORS } from './palette';
import { Surroundings } from './surroundings';
import { TaiwanDecor } from './taiwan';

const WINDOW_W = 0.34;
const WINDOW_H = 0.22;

export class CityView {
  readonly object = new THREE.Group();

  private readonly lots: Lot[];
  private readonly parts: LotParts[] = [];
  private readonly decor: TaiwanDecor | null;
  private ghostKey = '';
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(city: CityMap) {
    this.lots = city.lots;
    const { grid } = city;
    const width = grid.width;
    const height = grid.height;
    const box = groundBox();
    this.disposables.push(box);

    const lambert = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) => {
      const material = new THREE.MeshLambertMaterial({ color, ...extra });
      this.disposables.push(material);
      return material;
    };

    // Ground outside the map, then the street surface over the whole map.
    const reach = Math.max(width, height) * 6;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(reach, reach), lambert(COLORS.grass));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(width / 2, -0.02, height / 2);
    grass.receiveShadow = true;
    this.disposables.push(grass.geometry);

    const street = new THREE.Mesh(new THREE.PlaneGeometry(width, height), lambert(COLORS.road));
    street.rotation.x = -Math.PI / 2;
    street.position.set(width / 2, 0, height / 2);
    street.receiveShadow = true;
    this.disposables.push(street.geometry);
    this.object.add(grass, street);

    // Low fence around the edge: the city limits.
    const fence = new THREE.InstancedMesh(box, lambert(COLORS.fence), 4);
    const t = 0.3;
    fence.setMatrixAt(0, boxMatrix(width / 2, 0, -t / 2, width + 2 * t, 0.5, t));
    fence.setMatrixAt(1, boxMatrix(width / 2, 0, height + t / 2, width + 2 * t, 0.5, t));
    fence.setMatrixAt(2, boxMatrix(-t / 2, 0, height / 2, t, 0.5, height));
    fence.setMatrixAt(3, boxMatrix(width + t / 2, 0, height / 2, t, 0.5, height));
    fence.castShadow = true;
    this.object.add(fence);

    // Alleys and streets are tinted tiles over the road surface.
    for (const [terrain, color] of [
      [Terrain.ALLEY, COLORS.alley],
      [Terrain.STREET, COLORS.street],
    ] as const) {
      const cells: number[] = [];
      for (let cell = 0; cell < grid.cellCount; cell++) if (grid.terrain[cell] === terrain) cells.push(cell);
      const tiles = new THREE.InstancedMesh(box, lambert(color), Math.max(1, cells.length));
      tiles.count = cells.length;
      cells.forEach((cell, index) => {
        tiles.setMatrixAt(index, boxMatrix(grid.x(cell) + 0.5, 0, grid.z(cell) + 0.5, 1, 0.01, 1));
      });
      tiles.receiveShadow = true;
      this.object.add(tiles);
    }

    this.object.add(this.laneMarks(grid, box, lambert(COLORS.laneMark)));

    // Sidewalk slab under every lot.
    const sidewalks = new THREE.InstancedMesh(box, lambert(COLORS.sidewalk), Math.max(1, this.lots.length));
    sidewalks.count = this.lots.length;
    this.lots.forEach((lot, index) => {
      sidewalks.setMatrixAt(index, boxMatrix(lot.x + lot.w / 2, 0, lot.z + lot.d / 2, lot.w, SIDEWALK_HEIGHT, lot.d));
    });
    sidewalks.receiveShadow = true;
    this.object.add(sidewalks);

    // Buildings. Bodies and roofs have a translucent twin for the see-through effect; details
    // just disappear. Real districts build wall to wall and draw each building by its use.
    const real = city.id === 'east';
    const shapes = lotShapes(grid, this.lots, real);
    this.decor = real ? new TaiwanDecor(this.lots, shapes) : null;
    const white = lambert('#ffffff');
    const ghost = lambert('#ffffff', { transparent: true, opacity: OCCLUSION.OPACITY, depthWrite: false });
    const kit: BuildingKit = {
      bodies: new LotParts(box, white, ghost),
      roofs: new LotParts(box, white, ghost),
      windows: new LotParts(box, lambert(COLORS.window), null, false),
      glass: new LotParts(box, lambert(COLORS.glass), null, false),
      trim: new LotParts(box, white, null, false),
    };
    const windowSpots: WindowSpot[] = [];

    const color = new THREE.Color();
    this.lots.forEach((lot, index) => {
      const shape = shapes[index];
      if (this.decor) {
        addBuilding(kit, index, lot, shape, this.decor.arcade[index] === 1, windowSpots);
        return;
      }
      // Generated cities: a candy box with a roof and one window per wall cell per floor.
      const tall = lotHeight(lot);
      const cx = (shape.x0 + shape.x1) / 2;
      const cz = (shape.z0 + shape.z1) / 2;
      const w = shape.x1 - shape.x0;
      const d = shape.z1 - shape.z0;
      color.set(BUILDING_PALETTE[lot.color]);
      kit.bodies.add(index, boxMatrix(cx, SIDEWALK_HEIGHT, cz, w, tall, d), color);
      kit.roofs.add(index, boxMatrix(cx, SIDEWALK_HEIGHT + tall, cz, w + 0.1, ROOF_HEIGHT, d + 0.1), color.clone().multiplyScalar(0.82));
      for (const wall of shape.walls) {
        for (let floor = 0; floor < lot.floors; floor++) {
          const y = SIDEWALK_HEIGHT + floor * RENDER.FLOOR_HEIGHT + 0.1;
          kit.windows.add(index, onWall(wall, 0, y, WINDOW_W, WINDOW_H, 0.05, 0));
        }
      }
    });
    this.parts.push(kit.bodies, kit.roofs, kit.windows, kit.glass, kit.trim);
    for (const part of this.parts) this.object.add(...part.build());

    if (this.decor) {
      this.object.add(...this.decor.build(windowSpots, shapes));
      this.parts.push(...this.decor.parts);
      const surroundings = new Surroundings(width, height);
      this.disposables.push(surroundings);
      this.object.add(surroundings.object);
    }

    this.setGhosts([]);
  }

  /**
   * Dashes down the middle of main roads and streets, every other cell, not across junctions.
   * An even width puts the line on the seam between the two middle cells (spec §14.1).
   */
  private laneMarks(grid: Grid, box: THREE.BoxGeometry, material: THREE.Material): THREE.InstancedMesh {
    const widths: Partial<Record<Terrain, number>> = { [Terrain.ROAD]: MAP.ROAD_WIDTH, [Terrain.STREET]: MAP.STREET_WIDTH };
    const is = (x: number, z: number, terrain: Terrain) => grid.inside(x, z) && grid.terrain[grid.index(x, z)] === terrain;
    /** Cells of `terrain` before this one and in total, along the x (dx = 1) or z axis. */
    const run = (x: number, z: number, terrain: Terrain, dx: number, dz: number) => {
      let before = 0;
      while (is(x - (before + 1) * dx, z - (before + 1) * dz, terrain)) before++;
      let after = 0;
      while (is(x + (after + 1) * dx, z + (after + 1) * dz, terrain)) after++;
      return { before, total: before + 1 + after };
    };
    const marks: THREE.Matrix4[] = [];
    for (let z = 0; z < grid.height; z++) {
      for (let x = 0; x < grid.width; x++) {
        const terrain = grid.terrain[grid.index(x, z)] as Terrain;
        const width = widths[terrain];
        if (width === undefined) continue;
        const middle = Math.floor((width - 1) / 2);
        const seam = width % 2 === 0 ? 1 : 0.5;
        const across = run(x, z, terrain, 0, 1);
        const along = run(x, z, terrain, 1, 0);
        // Across the road (north–south) it is exactly one road wide: an east–west road.
        if (across.total === width && across.before === middle && along.total !== width && x % 2 === 0) {
          marks.push(boxMatrix(x + 0.5, 0, z + seam, 0.55, 0.015, 0.09));
        }
        if (along.total === width && along.before === middle && across.total !== width && z % 2 === 0) {
          marks.push(boxMatrix(x + seam, 0, z + 0.5, 0.09, 0.015, 0.55));
        }
      }
    }
    const mesh = new THREE.InstancedMesh(box, material, Math.max(1, marks.length));
    mesh.count = marks.length;
    marks.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    return mesh;
  }

  /** Make lots between the camera and the head see-through. `focus` is the head's ground position. */
  updateOcclusion(focus: THREE.Vector3): void {
    const left = focus.x - OCCLUSION.HALF_WIDTH;
    const right = focus.x + OCCLUSION.HALF_WIDTH;
    const north = focus.z - OCCLUSION.BEHIND;
    const south = focus.z + OCCLUSION.DEPTH;
    // The sight line from the head rises towards the camera; only lots poking above it block the view.
    const rise = Math.tan(THREE.MathUtils.degToRad(CAMERA.ELEVATION));
    const ghosts: number[] = [];
    this.lots.forEach((lot, index) => {
      if (!(lot.x < right && lot.x + lot.w > left && lot.z < south && lot.z + lot.d > north)) return;
      const top = SIDEWALK_HEIGHT + lotHeight(lot) + ROOF_HEIGHT;
      const sightHeight = Math.max(0, lot.z - focus.z) * rise;
      if (top > sightHeight - OCCLUSION.MARGIN) ghosts.push(index);
    });
    this.setGhosts(ghosts);
  }

  private setGhosts(ghosts: number[]): void {
    const key = `ghosts:${ghosts.join(',')}`;
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    const isGhost = new Uint8Array(this.lots.length);
    for (const index of ghosts) isGhost[index] = 1;
    for (const part of this.parts) part.setGhosts(isGhost);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.decor?.dispose();
    this.object.traverse((child) => {
      if (child instanceof THREE.InstancedMesh) child.dispose();
    });
  }
}
