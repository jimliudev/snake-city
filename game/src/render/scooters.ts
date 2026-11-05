// Parked scooters in real districts (spec §14.6). They only exist on screen: the rules never see
// them. When the snake's head enters their cell they tumble away and are gone for the game.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAIWAN } from '../config';
import { DIRS, DX, DZ, Terrain, type Dir, type Grid } from '../grid';
import { Rng } from '../rng';
import { FACING } from './facades';

const SCOOTER_COLORS = ['#e63946', '#f1faee', '#1d3557', '#ffb703', '#8ecae6', '#2a9d8f', '#adb5bd', '#ff70a6'] as const;
const GRAVITY = 14;
const FLIGHT_S = 1.4;

interface Scooter {
  cell: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  /** Seconds since it was hit; −1 while parked. */
  flying: number;
}

/** One scooter as a single geometry with vertex colours; the body takes the instance colour. */
function scooterGeometry(): THREE.BufferGeometry {
  const part = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number) => {
    geometry.translate(x, y, z);
    const c = new THREE.Color(color);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry.toNonIndexed();
  };
  // Front faces +z. About 0.45 long, cartoon-sized next to the people.
  const wheel = () => new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10).rotateZ(Math.PI / 2);
  const geometry = mergeGeometries([
    part(new THREE.BoxGeometry(0.16, 0.12, 0.36), '#ffffff', 0, 0.13, 0), // body
    part(new THREE.BoxGeometry(0.14, 0.05, 0.18), '#2b2b2b', 0, 0.21, -0.06), // seat
    part(new THREE.BoxGeometry(0.12, 0.2, 0.06), '#ffffff', 0, 0.22, 0.17), // front shield
    part(new THREE.BoxGeometry(0.22, 0.03, 0.03), '#3a3a3a', 0, 0.33, 0.17), // handlebar
    part(wheel(), '#222222', 0, 0.07, 0.16),
    part(wheel(), '#222222', 0, 0.07, -0.15),
  ]);
  return geometry;
}

export class Scooters {
  readonly object: THREE.InstancedMesh;
  private readonly scooters: Scooter[] = [];
  /** Scooter indexes by cell, for the ones still parked. */
  private readonly byCell = new Map<number, number[]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);

  constructor(grid: Grid, seed: number) {
    const rng = new Rng(seed ^ 0x5c007e2);
    for (let cell = 0; cell < grid.cellCount; cell++) {
      const terrain = grid.terrain[cell];
      if (terrain === Terrain.BUILDING) continue;
      // Parked against a building: the curb is the side with a building next to it.
      const curbs = DIRS.filter((dir) => {
        const next = grid.neighbor(cell, dir);
        return next >= 0 && !grid.walkable(next);
      });
      if (curbs.length === 0) continue;
      const chance = terrain === Terrain.ALLEY ? TAIWAN.SCOOTER_ALLEY_CHANCE : TAIWAN.SCOOTER_STREET_CHANCE;
      if (!rng.chance(chance)) continue;
      const curb: Dir = rng.pick(curbs);
      const count = rng.int(1, 2);
      const indexes: number[] = [];
      for (let i = 0; i < count; i++) {
        // Nose to the curb, side by side along it, slightly askew.
        const along = (i - (count - 1) / 2) * 0.3 + rng.range(-0.05, 0.05);
        const ax = -DZ[curb];
        const az = DX[curb];
        const position = new THREE.Vector3(
          grid.x(cell) + 0.5 + DX[curb] * 0.25 + ax * along,
          0,
          grid.z(cell) + 0.5 + DZ[curb] * 0.25 + az * along,
        );
        indexes.push(this.scooters.length);
        this.scooters.push({
          cell,
          position,
          rotation: new THREE.Euler(0, FACING[curb] + rng.range(-0.2, 0.2), 0),
          velocity: new THREE.Vector3(),
          spin: new THREE.Vector3(),
          flying: -1,
        });
      }
      this.byCell.set(cell, indexes);
    }

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.object = new THREE.InstancedMesh(scooterGeometry(), material, Math.max(1, this.scooters.length));
    this.object.count = this.scooters.length;
    this.object.castShadow = true;
    this.object.frustumCulled = false;
    const color = new THREE.Color();
    this.scooters.forEach((scooter, index) => {
      this.object.setColorAt(index, color.set(rng.pick(SCOOTER_COLORS)));
      this.place(index, scooter);
    });
    this.object.instanceMatrix.needsUpdate = true;
  }

  get count(): number {
    return this.scooters.length;
  }

  /** Knock away everything parked in `cell`, flung along the snake's heading. Returns how many. */
  hit(cell: number, heading: Dir): number {
    const indexes = this.byCell.get(cell);
    if (!indexes) return 0;
    this.byCell.delete(cell);
    for (const index of indexes) {
      const scooter = this.scooters[index];
      const side = (Math.random() - 0.5) * 4;
      scooter.velocity.set(DX[heading] * 4 + -DZ[heading] * side, 4 + Math.random() * 2.5, DZ[heading] * 4 + DX[heading] * side);
      scooter.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
      scooter.flying = 0;
    }
    return indexes.length;
  }

  update(deltaMs: number): void {
    const seconds = deltaMs / 1000;
    let moved = false;
    this.scooters.forEach((scooter, index) => {
      if (scooter.flying < 0 || scooter.flying > FLIGHT_S) return;
      scooter.flying += seconds;
      scooter.velocity.y -= GRAVITY * seconds;
      scooter.position.addScaledVector(scooter.velocity, seconds);
      if (scooter.position.y < 0) {
        scooter.position.y = 0;
        scooter.velocity.multiplyScalar(0.45);
        scooter.velocity.y = Math.abs(scooter.velocity.y);
      }
      scooter.rotation.x += scooter.spin.x * seconds;
      scooter.rotation.y += scooter.spin.y * seconds;
      scooter.rotation.z += scooter.spin.z * seconds;
      this.place(index, scooter);
      moved = true;
    });
    if (moved) this.object.instanceMatrix.needsUpdate = true;
  }

  private place(index: number, scooter: Scooter): void {
    // Shrink away at the end of the flight; gone for the rest of the game.
    const left = scooter.flying < 0 ? 1 : Math.max(0, Math.min(1, (FLIGHT_S - scooter.flying) / 0.3));
    this.scale.setScalar(left);
    this.quaternion.setFromEuler(scooter.rotation);
    this.matrix.compose(scooter.position, this.quaternion, this.scale);
    this.object.setMatrixAt(index, this.matrix);
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.object.dispose();
  }
}
