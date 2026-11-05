// Taiwanese street details for real districts (spec §14.4): rooftop add-ons, water tanks,
// vertical signs, air conditioners, window grilles, arcades and street trees. Placed from the lot data with a
// fixed seed, so a district looks the same every game.

import * as THREE from 'three';
import { RENDER, TAIWAN } from '../config';
import { ROAD_RANK, Terrain } from '../grid';
import { BuildingKind, type Lot } from '../map/city';
import { Rng } from '../rng';
import { podiumFloors, type WindowSpot } from './buildings';
import { boxMatrix, groundBox, INSET, lotHeight, onWall, ROOF_HEIGHT, SIDEWALK_HEIGHT, type LotShape } from './facades';
import { LotParts } from './lotParts';
import { COLORS, LEAF_PALETTE } from './palette';
import { makeSignKit, SIGN_COLORS, SIGN_DEPTH } from './signs';

/** Largest side of a rooftop shack. */
const SHACK_MAX = 1.5;

const isStreet = (terrain: Terrain) => terrain === Terrain.ROAD || terrain === Terrain.STREET;

export class TaiwanDecor {
  /** Lots whose ground floor is an arcade (騎樓). */
  readonly arcade: Uint8Array;
  /** Lots on alleys only, whose windows get grilles (鐵窗). */
  readonly grilles: Uint8Array;
  readonly parts: LotParts[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(lots: Lot[], shapes: LotShape[]) {
    this.lots = lots;
    this.arcade = new Uint8Array(lots.length);
    this.grilles = new Uint8Array(lots.length);
    lots.forEach((lot, index) => {
      const walls = shapes[index].walls;
      // Department stores and institutions have their own entrances, not arcades.
      const plain = lot.kind === BuildingKind.APARTMENT || lot.kind === BuildingKind.OFFICE;
      if (plain && walls.some((wall) => isStreet(wall.outside))) this.arcade[index] = 1;
      const rank = Math.max(0, ...walls.map((wall) => ROAD_RANK[wall.outside]));
      if (lot.kind === BuildingKind.APARTMENT && rank <= ROAD_RANK[Terrain.ALLEY]) this.grilles[index] = 1;
    });
  }

  private readonly lots: Lot[];

  /** Build every detail. `windowSpots` are the window boxes CityView placed, for grilles. */
  build(windowSpots: WindowSpot[], shapes: LotShape[]): THREE.Object3D[] {
    const rng = new Rng(TAIWAN.SEED);
    const box = groundBox();
    const tank = new THREE.CylinderGeometry(0.13, 0.13, 0.28, 10).translate(0, 0.14, 0);
    const trunk = new THREE.CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0);
    const crown = new THREE.IcosahedronGeometry(1, 0);
    this.disposables.push(trunk, crown);
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
    const trunks = new LotParts(trunk, lambert(COLORS.trunk));
    const crowns = new LotParts(crown, white);
    const kit = makeSignKit();
    this.disposables.push(kit);
    const signs = kit.geometries.map((geometry) => new LotParts(geometry, kit.materials));

    this.lots.forEach((lot, index) => {
      const shape = shapes[index];
      const top = SIDEWALK_HEIGHT + lotHeight(lot) + ROOF_HEIGHT;
      const roofW = shape.x1 - shape.x0;
      const roofD = shape.z1 - shape.z0;
      const cx = (shape.x0 + shape.x1) / 2;
      const cz = (shape.z0 + shape.z1) / 2;
      const apartment = lot.kind === BuildingKind.APARTMENT;
      const podium = podiumFloors(lot);

      // 頂樓加蓋: a tin shack covering part of an apartment roof, in one corner.
      let shackCorner = { sx: 0, sz: 0 };
      if (apartment && lot.floors >= 4 && roofW >= 0.6 && roofD >= 0.6 && rng.chance(TAIWAN.SHACK_CHANCE)) {
        // A shack is a room or two, however big the roof.
        const w = Math.min(SHACK_MAX, Math.max(0.6, roofW * rng.range(0.45, 0.75)));
        const d = Math.min(SHACK_MAX, Math.max(0.6, roofD * rng.range(0.45, 0.75)));
        shackCorner = { sx: rng.chance(0.5) ? -1 : 1, sz: rng.chance(0.5) ? -1 : 1 };
        const x = cx + (shackCorner.sx * (roofW - w)) / 2;
        const z = cz + (shackCorner.sz * (roofD - d)) / 2;
        const blue = rng.chance(0.6);
        shacks.add(index, boxMatrix(x, top, z, w, 0.3, d), blue ? COLORS.tinBlue : COLORS.tinWhite);
        shackRoofs.add(index, boxMatrix(x, top + 0.3, z, w + 0.08, 0.05, d + 0.08), blue ? COLORS.tinBlueDark : COLORS.tinWhiteDark);
      }

      // 水塔: one or two in the corner away from the shack, on apartments and low offices.
      if (apartment || (lot.kind === BuildingKind.OFFICE && podium === 0)) {
        const tankCount = rng.int(1, 2);
        for (let i = 0; i < tankCount; i++) {
          const sx = shackCorner.sx === 0 ? (rng.chance(0.5) ? -1 : 1) : -shackCorner.sx;
          const sz = shackCorner.sz === 0 ? (rng.chance(0.5) ? -1 : 1) : -shackCorner.sz;
          const x = cx + sx * Math.max(0, roofW / 2 - 0.2 - i * 0.3);
          const z = cz + sz * Math.max(0, roofD / 2 - 0.2);
          tanks.add(index, boxMatrix(x, top, z, 1, 1, 1), rng.chance(0.6) ? COLORS.tankWhite : COLORS.tankSteel);
        }
      }

      // Signs hang from floor 1 (the ground floor is 0) up to SIGN_TOP_FLOOR, or the top of an
      // office podium. Department stores and institutions have none.
      const signTop = apartment ? Math.min(TAIWAN.SIGN_TOP_FLOOR, lot.floors - 1) : podium - 1;
      const signsHere = lot.kind === BuildingKind.APARTMENT || lot.kind === BuildingKind.OFFICE;
      const signRoof = SIDEWALK_HEIGHT + (apartment ? lotHeight(lot) : podium * RENDER.FLOOR_HEIGHT);
      const room = signRoof - SIDEWALK_HEIGHT - RENDER.FLOOR_HEIGHT;

      for (const wall of shape.walls) {
        if (signsHere && signTop >= 1 && isStreet(wall.outside) && rng.chance(TAIWAN.SIGN_CHANCE)) {
          // A long name that would poke above the roof becomes a shorter word.
          let word = rng.int(0, kit.geometries.length - 1);
          if (kit.heights[word] > room) word = rng.pick(kit.fitting(room));
          if (kit.heights[word] <= room + 0.05) {
            let y = SIDEWALK_HEIGHT + rng.int(1, Math.max(1, signTop - 1)) * RENDER.FLOOR_HEIGHT;
            y = Math.max(SIDEWALK_HEIGHT + RENDER.FLOOR_HEIGHT, Math.min(y, signRoof - kit.heights[word]));
            signs[word].add(index, onWall(wall, rng.range(-0.3, 0.3), y, 1, 1, 1, SIGN_DEPTH / 2), rng.pick(SIGN_COLORS));
          }
        }
        // Air conditioners beside apartment windows, above the ground floor.
        if (apartment) {
          for (let floor = 1; floor < lot.floors; floor++) {
            if (!rng.chance(TAIWAN.AIRCON_CHANCE)) continue;
            const y = SIDEWALK_HEIGHT + floor * RENDER.FLOOR_HEIGHT + 0.04;
            aircon.add(index, onWall(wall, 0.33, y, 0.24, 0.17, 0.13));
          }
        }
        // 騎樓 columns along the street side, one per cell edge.
        if (this.arcade[index] && isStreet(wall.outside)) {
          for (const along of [-0.5, 0.5]) {
            columns.add(index, onWall(wall, along * 0.92, SIDEWALK_HEIGHT, 0.09, RENDER.FLOOR_HEIGHT, 0.09, 0.045));
          }
        }
        // Street trees on the kerb of the main roads: every cell on the tree-lined 敦化南路
        // (west) and 仁愛路 (south), every other cell on 忠孝東路 and 光復南路.
        if (wall.outside === Terrain.ROAD) {
          const along = wall.dir === 0 || wall.dir === 2 ? wall.x : wall.z;
          const every = wall.dir === 3 || wall.dir === 2 ? 1 : 2;
          if (Math.floor(along) % every === 0) {
            const height = rng.range(0.75, 0.95);
            trunks.add(index, onWall(wall, 0, SIDEWALK_HEIGHT, 1, height, 1, INSET - 0.05));
            const size = rng.range(0.26, 0.34);
            const leaves = onWall(wall, 0, SIDEWALK_HEIGHT + height + 0.05, size * 1.1, size * 0.85, size * 1.1, INSET - 0.05);
            crowns.add(index, leaves.multiply(new THREE.Matrix4().makeRotationY(rng.range(0, Math.PI))), rng.pick(LEAF_PALETTE));
          }
        }
      }
    });

    // 鐵窗 over every window of alley-only lots.
    for (const spot of windowSpots) {
      if (!this.grilles[spot.lot]) continue;
      grilles.add(spot.lot, onWall(spot.wall, 0, spot.y - 0.03, 0.4, 0.28, 0.09));
    }

    this.parts.push(shacks, shackRoofs, tanks, aircon, grilles, columns, trunks, crowns, ...signs);
    return this.parts.flatMap((part) => part.build());
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
