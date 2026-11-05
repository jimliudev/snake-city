// Real-district buildings, drawn by what they are used for (spec §14.4): apartment blocks
// (公寓 and taller 華廈), office towers on a podium, department stores, and schools, hospitals
// and public buildings. Generated cities keep their plain candy boxes (city.ts).

import * as THREE from 'three';
import { RENDER } from '../config';
import type { Lot } from '../map/city';
import { BuildingKind } from '../map/city';
import { boxMatrix, lotHeight, onWall, ROOF_HEIGHT, SIDEWALK_HEIGHT, type LotShape, type WallCell } from './facades';
import type { LotParts } from './lotParts';
import { COLORS, GLASS_PALETTE, INSTITUTION_PALETTE, MALL_ACCENTS, MALL_PALETTE, STONE_PALETTE, TAIWAN_PALETTE } from './palette';

const WINDOW_W = 0.34;
const WINDOW_H = 0.22;
/** How far an arcade's ground floor is set back behind the columns. */
const ARCADE_DEPTH = 0.22;
/** Towers stand this far back from the podium on street sides. */
const TOWER_INSET = 0.18;
/** Apartment blocks at least this tall are 華廈 / 大樓, with balconies and maybe a crown. */
const TALL_APARTMENT = 7;
const CROWN_FLOORS = 11;

export interface BuildingKit {
  bodies: LotParts;
  roofs: LotParts;
  /** Lit residential windows. */
  windows: LotParts;
  /** Dark glass: ribbon windows and shop fronts. */
  glass: LotParts;
  /** Coloured trim: balcony ledges, floor lines, stripes, billboard frames. */
  trim: LotParts;
}

/** Where CityView put residential windows, for the grilles. */
export type WindowSpot = { lot: number; wall: WallCell; y: number };

/** Height of an office podium in floors, or 0 for a plain block. Signs hang only on the podium. */
export function podiumFloors(lot: Lot): number {
  if (lot.kind !== BuildingKind.OFFICE) return 0;
  return lot.floors >= 8 ? 3 : lot.floors >= 5 ? 2 : 0;
}

/** Glass curtain wall, or an older tiled office with ribbon windows. */
const isGlassTower = (lot: Lot) => lot.floors >= 12 || lot.color % 2 === 0;

export function addBuilding(kit: BuildingKit, index: number, lot: Lot, shape: LotShape, arcade: boolean, windowSpots: WindowSpot[]): void {
  const floor = RENDER.FLOOR_HEIGHT;
  const tall = lotHeight(lot);
  const color = new THREE.Color();
  const cx = (shape.x0 + shape.x1) / 2;
  const cz = (shape.z0 + shape.z1) / 2;
  const w = shape.x1 - shape.x0;
  const d = shape.z1 - shape.z0;
  const top = SIDEWALK_HEIGHT + tall;

  /** The body from `fromFloor` to the roof, with the arcade's ground floor set back. */
  const body = (base: THREE.Color, floors: number, x0: number, x1: number, z0: number, z1: number) => {
    const bx = (x0 + x1) / 2;
    const bz = (z0 + z1) / 2;
    const height = floors * floor;
    if (arcade) {
      // 騎樓: the ground floor sits back only on the street sides; the floors above reach out.
      const [n, e, s, wst] = shape.open.map((open) => (open ? ARCADE_DEPTH : 0));
      const gx0 = x0 + wst;
      const gx1 = x1 - e;
      const gz0 = z0 + n;
      const gz1 = z1 - s;
      kit.bodies.add(index, boxMatrix((gx0 + gx1) / 2, SIDEWALK_HEIGHT, (gz0 + gz1) / 2, gx1 - gx0, floor, gz1 - gz0), base);
      kit.bodies.add(index, boxMatrix(bx, SIDEWALK_HEIGHT + floor, bz, x1 - x0, height - floor, z1 - z0), base);
    } else {
      kit.bodies.add(index, boxMatrix(bx, SIDEWALK_HEIGHT, bz, x1 - x0, height, z1 - z0), base);
    }
  };
  const roof = (base: THREE.Color, x0: number, x1: number, z0: number, z1: number, y = top) => {
    kit.roofs.add(index, boxMatrix((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 0.06, ROOF_HEIGHT, z1 - z0 + 0.06), base.clone().multiplyScalar(0.82));
  };
  const residentialWindows = (from: number) => {
    for (const wall of shape.walls) {
      for (let f = from; f < lot.floors; f++) {
        const y = SIDEWALK_HEIGHT + f * floor + 0.1;
        kit.windows.add(index, onWall(wall, 0, y, WINDOW_W, WINDOW_H, 0.05, 0));
        windowSpots.push({ lot: index, wall, y });
      }
    }
  };
  /** One ribbon window per floor on every street wall, cell to cell. */
  const ribbons = (from: number, to: number, height = 0.17) => {
    for (const wall of shape.walls) {
      for (let f = from; f < to; f++) kit.glass.add(index, onWall(wall, 0, SIDEWALK_HEIGHT + f * floor + 0.12, 1.001, height, 0.04, 0));
    }
  };
  const shopFronts = () => {
    if (arcade) return; // Behind the columns, out of sight.
    for (const wall of shape.walls) kit.glass.add(index, onWall(wall, 0, SIDEWALK_HEIGHT + 0.04, 0.86, 0.28, 0.04, 0));
  };

  switch (lot.kind) {
    case BuildingKind.OFFICE: {
      const podium = podiumFloors(lot);
      if (podium === 0) {
        color.set(TAIWAN_PALETTE[lot.color]);
        body(color, lot.floors, shape.x0, shape.x1, shape.z0, shape.z1);
        roof(color, shape.x0, shape.x1, shape.z0, shape.z1);
        ribbons(arcade ? 1 : 0, lot.floors);
        break;
      }
      const stone = new THREE.Color(STONE_PALETTE[lot.color]);
      body(stone, podium, shape.x0, shape.x1, shape.z0, shape.z1);
      ribbons(arcade ? 1 : 0, podium, 0.24);
      // The tower steps back from the street, if the lot is big enough to show it.
      const [n, e, s, wst] = shape.open.map((open) => (open ? TOWER_INSET : 0));
      let tx0 = shape.x0 + wst;
      let tx1 = shape.x1 - e;
      let tz0 = shape.z0 + n;
      let tz1 = shape.z1 - s;
      if (tx1 - tx0 < 0.5 || tz1 - tz0 < 0.5) [tx0, tx1, tz0, tz1] = [shape.x0, shape.x1, shape.z0, shape.z1];
      const towerFloors = lot.floors - podium;
      const towerBase = SIDEWALK_HEIGHT + podium * floor;
      roof(stone, shape.x0, shape.x1, shape.z0, shape.z1, towerBase - ROOF_HEIGHT / 2);
      const glassy = isGlassTower(lot);
      const skin = new THREE.Color(glassy ? GLASS_PALETTE[lot.color] : TAIWAN_PALETTE[lot.color]);
      const tw = tx1 - tx0;
      const td = tz1 - tz0;
      kit.bodies.add(index, boxMatrix((tx0 + tx1) / 2, towerBase, (tz0 + tz1) / 2, tw, towerFloors * floor, td), skin);
      roof(skin, tx0, tx1, tz0, tz1);
      for (let f = 1; f <= towerFloors; f++) {
        const y = towerBase + f * floor - (glassy ? 0.05 : 0.2);
        if (glassy) {
          // Curtain wall: pale floor lines wrapped round the glass.
          kit.trim.add(index, boxMatrix((tx0 + tx1) / 2, y, (tz0 + tz1) / 2, tw + 0.02, 0.05, td + 0.02), COLORS.spandrel);
        } else {
          // Tiled office: a dark ribbon window on every floor, all the way round.
          kit.glass.add(index, boxMatrix((tx0 + tx1) / 2, y, (tz0 + tz1) / 2, tw + 0.02, 0.17, td + 0.02));
        }
      }
      // Lift motor room on top.
      if (lot.floors >= 10) {
        const mw = Math.min(0.8, tw * 0.4);
        const md = Math.min(0.8, td * 0.4);
        kit.roofs.add(index, boxMatrix((tx0 + tx1) / 2, top + ROOF_HEIGHT, (tz0 + tz1) / 2, mw, 0.32, md), COLORS.machineRoom);
      }
      break;
    }

    case BuildingKind.MALL: {
      color.set(MALL_PALETTE[lot.color % MALL_PALETTE.length]);
      body(color, lot.floors, shape.x0, shape.x1, shape.z0, shape.z1);
      roof(color, shape.x0, shape.x1, shape.z0, shape.z1);
      shopFronts();
      // Big blank walls with a coloured band near the top, and a billboard frame on the roof.
      const accent = MALL_ACCENTS[lot.color % MALL_ACCENTS.length];
      kit.trim.add(index, boxMatrix(cx, top - 0.5, cz, w + 0.03, 0.22, d + 0.03), accent);
      const front = shape.walls[Math.floor(shape.walls.length / 2)];
      if (front) kit.trim.add(index, onWall(front, 0, top + ROOF_HEIGHT, 0.9, 0.5, 0.05, -0.1), COLORS.billboard);
      break;
    }

    case BuildingKind.SCHOOL:
    case BuildingKind.HOSPITAL:
    case BuildingKind.PUBLIC: {
      color.set(INSTITUTION_PALETTE[lot.color % INSTITUTION_PALETTE.length]);
      body(color, lot.floors, shape.x0, shape.x1, shape.z0, shape.z1);
      roof(lot.kind === BuildingKind.SCHOOL ? new THREE.Color(COLORS.schoolRoof) : color, shape.x0, shape.x1, shape.z0, shape.z1);
      ribbons(0, lot.floors);
      break;
    }

    default: {
      // Apartments: 公寓 up to six floors, 華廈 and 大樓 above.
      color.set(TAIWAN_PALETTE[lot.color]);
      body(color, lot.floors, shape.x0, shape.x1, shape.z0, shape.z1);
      roof(color, shape.x0, shape.x1, shape.z0, shape.z1);
      residentialWindows(arcade ? 1 : 0);
      if (lot.floors >= TALL_APARTMENT) {
        // Balcony ledges along the street walls, one per floor, a shade lighter than the tiles.
        const ledge = color.clone().lerp(new THREE.Color(COLORS.ledge), 0.45);
        for (const wall of shape.walls) {
          for (let f = 1; f < lot.floors; f++) kit.trim.add(index, onWall(wall, 0, SIDEWALK_HEIGHT + f * floor - 0.03, 1.001, 0.04, 0.08), ledge);
        }
      }
      if (lot.floors >= CROWN_FLOORS && lot.color % 3 !== 0 && w >= 0.9 && d >= 0.9) {
        // 皇冠頂: a stepped crown on top of the newer blocks.
        const crown = color.clone().multiplyScalar(0.9);
        kit.roofs.add(index, boxMatrix(cx, top + ROOF_HEIGHT, cz, w * 0.6, 0.3, d * 0.6), crown);
        kit.roofs.add(index, boxMatrix(cx, top + ROOF_HEIGHT + 0.3, cz, w * 0.35, 0.18, d * 0.35), crown);
      }
    }
  }
}
