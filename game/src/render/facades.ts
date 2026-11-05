// Where the walls of a lot are, cell by cell, and what each wall faces.

import * as THREE from 'three';
import { RENDER } from '../config';
import { DX, DZ, Terrain, type Dir, type Grid } from '../grid';
import type { Lot } from '../map/city';

export const SIDEWALK_HEIGHT = 0.12;
/** Buildings stand this far in from the lot edge. */
export const INSET = 0.14;
export const ROOF_HEIGHT = 0.14;

/** Rotation about y that turns a model's +z towards `dir`. */
export const FACING: Record<Dir, number> = { 0: Math.PI, 1: Math.PI / 2, 2: 0, 3: -Math.PI / 2 };

/** One cell-wide stretch of wall. */
export interface WallCell {
  dir: Dir;
  /** Centre of the stretch on the wall plane, at ground level. */
  x: number;
  z: number;
  /** Terrain just outside, or BUILDING past the map edge. */
  outside: Terrain;
}

export function lotHeight(lot: Lot): number {
  return lot.floors * RENDER.FLOOR_HEIGHT;
}

/** Every one-cell stretch of the lot's four walls. */
export function wallCells(grid: Grid, lot: Lot, inset = INSET): WallCell[] {
  const cells: WallCell[] = [];
  const outside = (x: number, z: number): Terrain =>
    grid.inside(x, z) ? (grid.terrain[grid.index(x, z)] as Terrain) : Terrain.BUILDING;
  for (let i = 0; i < lot.w; i++) {
    const x = lot.x + i;
    cells.push({ dir: 0, x: x + 0.5, z: lot.z + inset, outside: outside(x, lot.z - 1) });
    cells.push({ dir: 2, x: x + 0.5, z: lot.z + lot.d - inset, outside: outside(x, lot.z + lot.d) });
  }
  for (let i = 0; i < lot.d; i++) {
    const z = lot.z + i;
    cells.push({ dir: 3, x: lot.x + inset, z: z + 0.5, outside: outside(lot.x - 1, z) });
    cells.push({ dir: 1, x: lot.x + lot.w - inset, z: z + 0.5, outside: outside(lot.x + lot.w, z) });
  }
  return cells;
}

/**
 * A matrix for a ground-based unit box `w` wide (along the wall), `h` tall and `d` deep (out
 * of the wall), standing on the wall at `along` from the cell centre and `y` up.
 */
export function onWall(wall: WallCell, along: number, y: number, w: number, h: number, d: number, out = d / 2): THREE.Matrix4 {
  // Along the wall is the facing turned a quarter to the right.
  const ax = -DZ[wall.dir];
  const az = DX[wall.dir];
  const position = new THREE.Vector3(wall.x + ax * along + DX[wall.dir] * out, y, wall.z + az * along + DZ[wall.dir] * out);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), FACING[wall.dir]);
  // Local x runs along the wall, local z out of it.
  return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(w, h, d));
}

export function boxMatrix(x: number, y: number, z: number, w: number, h: number, d: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
}

/** A unit box resting on y = 0, so scaling its height keeps the bottom on the ground. */
export function groundBox(): THREE.BoxGeometry {
  return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}
