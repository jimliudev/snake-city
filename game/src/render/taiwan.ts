// Taiwanese street details for real districts (spec §14.4): rooftop add-ons, water tanks,
// vertical signs, air conditioners, window grilles and arcades. Placed from the lot data with a
// fixed seed, so a district looks the same every game.

import * as THREE from 'three';
import { RENDER, TAIWAN } from '../config';
import { ROAD_RANK, Terrain, type Grid } from '../grid';
import type { Lot } from '../map/city';
import { Rng } from '../rng';
import { boxMatrix, groundBox, INSET, lotHeight, onWall, ROOF_HEIGHT, SIDEWALK_HEIGHT, wallCells, type WallCell } from './facades';
import { LotParts } from './lotParts';
import { COLORS } from './palette';
import { makeSignKit, SIGN_COLORS, SIGN_DEPTH } from './signs';

const isStreet = (terrain: Terrain) => terrain === Terrain.ROAD || terrain === Terrain.STREET;

export class TaiwanDecor {
  /** Lots whose ground floor is an arcade (騎樓). */
  readonly arcade: Uint8Array;
  /** Lots on alleys only, whose windows get grilles (鐵窗). */
  readonly grilles: Uint8Array;
  readonly parts: LotParts[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly grid: Grid,
    private readonly lots: Lot[],
  ) {
    this.arcade = new Uint8Array(lots.length);
    this.grilles = new Uint8Array(lots.length);
    lots.forEach((lot, index) => {
      const walls = wallCells(grid, lot);
      if (walls.some((wall) => isStreet(wall.outside))) this.arcade[index] = 1;
      const rank = Math.max(...walls.map((wall) => ROAD_RANK[wall.outside]));
      if (rank <= ROAD_RANK[Terrain.ALLEY]) this.grilles[index] = 1;
    });
  }

  /** Build every detail. `windowSpots` are the window boxes CityView placed, for grilles. */
  build(windowSpots: Array<{ lot: number; wall: WallCell; y: number }>): THREE.Object3D[] {
    const rng = new Rng(TAIWAN.SEED);
    const box = groundBox();
    const tank = new THREE.CylinderGeometry(0.13, 0.13, 0.28, 10).translate(0, 0.14, 0);
    const lambert = (color: THREE.ColorRepresentation) => {
      const material = new THREE.MeshLambertMaterial({ color });
      this.disposables.push(material);
      return material;
    };
    const white = lambert('#ffffff');
    this.disposables.push(box, tank);

    const shacks = new LotParts(box, white);
    const shackRoofs = new LotParts(box, white);
    const tanks = new LotParts(tank, white);
    const aircon = new LotParts(box, lambert(COLORS.aircon));
    const grilles = new LotParts(box, lambert(COLORS.grille), null, false);
    const columns = new LotParts(box, lambert(COLORS.arcadeColumn));
    const kit = makeSignKit();
    this.disposables.push(kit);
    const signs = kit.geometries.map((geometry) => new LotParts(geometry, kit.materials));

    this.lots.forEach((lot, index) => {
      const top = SIDEWALK_HEIGHT + lotHeight(lot) + ROOF_HEIGHT;
      const roofW = lot.w - 2 * INSET;
      const roofD = lot.d - 2 * INSET;
      const cx = lot.x + lot.w / 2;
      const cz = lot.z + lot.d / 2;

      // 頂樓加蓋: a tin shack covering part of the roof, in one corner.
      let shackCorner = { sx: 0, sz: 0 };
      if (lot.floors >= 4 && rng.chance(TAIWAN.SHACK_CHANCE)) {
        const w = Math.max(0.6, roofW * rng.range(0.45, 0.75));
        const d = Math.max(0.6, roofD * rng.range(0.45, 0.75));
        shackCorner = { sx: rng.chance(0.5) ? -1 : 1, sz: rng.chance(0.5) ? -1 : 1 };
        const x = cx + (shackCorner.sx * (roofW - w)) / 2;
        const z = cz + (shackCorner.sz * (roofD - d)) / 2;
        const blue = rng.chance(0.6);
        shacks.add(index, boxMatrix(x, top, z, w, 0.3, d), blue ? COLORS.tinBlue : COLORS.tinWhite);
        shackRoofs.add(index, boxMatrix(x, top + 0.3, z, w + 0.08, 0.05, d + 0.08), blue ? COLORS.tinBlueDark : COLORS.tinWhiteDark);
      }

      // 水塔: one or two in the corner away from the shack.
      const tankCount = rng.int(1, 2);
      for (let i = 0; i < tankCount; i++) {
        const sx = shackCorner.sx === 0 ? (rng.chance(0.5) ? -1 : 1) : -shackCorner.sx;
        const sz = shackCorner.sz === 0 ? (rng.chance(0.5) ? -1 : 1) : -shackCorner.sz;
        const x = cx + sx * Math.max(0, roofW / 2 - 0.2 - i * 0.3);
        const z = cz + sz * Math.max(0, roofD / 2 - 0.2);
        tanks.add(index, boxMatrix(x, top, z, 1, 1, 1), rng.chance(0.6) ? COLORS.tankWhite : COLORS.tankSteel);
      }

      for (const wall of wallCells(this.grid, lot)) {
        // Signs only face roads and streets, on floors 1–4 (the ground floor is 0).
        if (isStreet(wall.outside) && rng.chance(TAIWAN.SIGN_CHANCE)) {
          const word = rng.int(0, kit.geometries.length - 1);
          const lowest = 1;
          const highest = Math.max(lowest, Math.min(TAIWAN.SIGN_TOP_FLOOR, lot.floors - 1) - 1);
          let y = SIDEWALK_HEIGHT + rng.int(lowest, highest) * RENDER.FLOOR_HEIGHT;
          y = Math.min(y, SIDEWALK_HEIGHT + lotHeight(lot) - kit.heights[word]);
          signs[word].add(index, onWall(wall, rng.range(-0.3, 0.3), y, 1, 1, 1, SIGN_DEPTH / 2), rng.pick(SIGN_COLORS));
        }
        // Air conditioners beside the windows, above the ground floor.
        for (let floor = 1; floor < lot.floors; floor++) {
          if (!rng.chance(TAIWAN.AIRCON_CHANCE)) continue;
          const y = SIDEWALK_HEIGHT + floor * RENDER.FLOOR_HEIGHT + 0.04;
          aircon.add(index, onWall(wall, 0.33, y, 0.24, 0.17, 0.13));
        }
        // 騎樓 columns along the street side, one per cell edge.
        if (this.arcade[index] && isStreet(wall.outside)) {
          for (const along of [-0.5, 0.5]) {
            columns.add(index, onWall(wall, along * 0.92, SIDEWALK_HEIGHT, 0.09, RENDER.FLOOR_HEIGHT, 0.09, 0.045));
          }
        }
      }
    });

    // 鐵窗 over every window of alley-only lots.
    for (const spot of windowSpots) {
      if (!this.grilles[spot.lot]) continue;
      grilles.add(spot.lot, onWall(spot.wall, 0, spot.y - 0.03, 0.4, 0.28, 0.09));
    }

    this.parts.push(shacks, shackRoofs, tanks, aircon, grilles, columns, ...signs);
    return this.parts.flatMap((part) => part.build());
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
