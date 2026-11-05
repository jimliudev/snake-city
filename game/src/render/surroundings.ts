// What lies across the four boundary roads of 台北東區, outside the fence (spec §14.4). Only
// scenery: the snake never gets there. Office blocks along 忠孝東路 (north) and 敦化南路 (west),
// lower blocks along 仁愛路 (south, towards the camera, so they stay under the sight line), and
// the lawns and trees of the memorial hall park across 光復南路 (east).

import * as THREE from 'three';
import { RENDER, TAIWAN } from '../config';
import { Rng } from '../rng';
import { boxMatrix, groundBox, SIDEWALK_HEIGHT } from './facades';
import { COLORS, GLASS_PALETTE, LEAF_PALETTE, TAIWAN_PALETTE } from './palette';

/** Pavement between the fence and the buildings across the road. */
const KERB = 1.4;
/** Buildings across the road reach this far out from the fence. */
const BAND = 4;
/** Lawn across 光復南路. */
const PARK = 14;

interface Instance {
  matrix: THREE.Matrix4;
  color: THREE.ColorRepresentation;
}

export class Surroundings {
  readonly object = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(width: number, height: number) {
    const rng = new Rng(TAIWAN.SEED + 7);
    const box = groundBox();
    const trunk = new THREE.CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0);
    const crown = new THREE.IcosahedronGeometry(1, 0);
    this.disposables.push(box, trunk, crown);

    const solids: Instance[] = [];
    const glass: Instance[] = [];
    const trunks: Instance[] = [];
    const crowns: Instance[] = [];

    const tree = (x: number, z: number, scale = 1) => {
      const tall = rng.range(0.75, 0.95) * scale;
      trunks.push({ matrix: boxMatrix(x, SIDEWALK_HEIGHT, z, scale, tall, scale), color: COLORS.trunk });
      const size = rng.range(0.26, 0.34) * scale;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, SIDEWALK_HEIGHT + tall + 0.05, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI)),
        new THREE.Vector3(size * 1.1, size * 0.85, size * 1.1),
      );
      crowns.push({ matrix, color: rng.pick(LEAF_PALETTE) });
    };

    /** A row of blocks from `from` to `to` along one side; `place` turns (along, depth) into a box. */
    const blocks = (
      from: number,
      to: number,
      floors: [number, number],
      depth: [number, number],
      place: (start: number, length: number, deep: number) => { x: number; z: number; w: number; d: number },
    ) => {
      for (let at = from; at < to; ) {
        const length = Math.min(to - at, rng.int(2, 4));
        const deep = rng.range(depth[0], depth[1]);
        const { x, z, w, d } = place(at, length, deep);
        const count = rng.int(floors[0], floors[1]);
        const tall = count * RENDER.FLOOR_HEIGHT;
        const glassy = count >= 12 && rng.chance(0.6);
        const tone = rng.int(0, TAIWAN_PALETTE.length - 1);
        const skin = new THREE.Color(glassy ? GLASS_PALETTE[tone] : TAIWAN_PALETTE[tone]);
        solids.push({ matrix: boxMatrix(x, SIDEWALK_HEIGHT, z, w - 0.03, tall, d), color: skin });
        solids.push({ matrix: boxMatrix(x, SIDEWALK_HEIGHT + tall, z, w + 0.03, 0.14, d + 0.06), color: skin.clone().multiplyScalar(0.82) });
        for (let f = 0; f < count; f++) {
          const y = SIDEWALK_HEIGHT + f * RENDER.FLOOR_HEIGHT + (glassy ? 0.35 : 0.12);
          if (glassy) solids.push({ matrix: boxMatrix(x, y, z, w, 0.05, d + 0.02), color: COLORS.spandrel });
          else glass.push({ matrix: boxMatrix(x, y, z, w - 0.02, 0.17, d + 0.02), color: COLORS.glass });
        }
        at += length;
      }
    };

    // Pavements outside the fence on all four sides.
    const kerb = (x: number, z: number, w: number, d: number) =>
      solids.push({ matrix: boxMatrix(x, 0, z, w, SIDEWALK_HEIGHT, d), color: COLORS.sidewalk });
    kerb(width / 2, -KERB / 2 - 0.3, width + 2 * (KERB + 0.3), KERB);
    kerb(width / 2, height + KERB / 2 + 0.3, width + 2 * (KERB + 0.3), KERB);
    kerb(-KERB / 2 - 0.3, height / 2, KERB, height);
    kerb(width + KERB / 2 + 0.3, height / 2, KERB, height);

    // Trees on those pavements: dense on 敦化南路 and 仁愛路, sparser on the others.
    const edge = KERB / 2 + 0.3;
    for (let z = 0.5; z < height; z += 1) tree(-edge, z);
    for (let x = 0.5; x < width; x += 1) tree(x, height + edge);
    for (let x = 0.5; x < width; x += 2) tree(x, -edge);
    for (let z = 0.5; z < height; z += 2) tree(width + edge, z);

    const near = KERB + 0.3;
    // 忠孝東路 north side: tall offices and department stores.
    blocks(-near - BAND, width + near, [8, 18], [2.5, BAND], (at, length, deep) => ({
      x: at + length / 2,
      z: -near - deep / 2,
      w: length,
      d: deep,
    }));
    // 敦化南路 west side: offices and newer towers.
    blocks(0, height, [8, 16], [2.5, BAND], (at, length, deep) => ({
      x: -near - deep / 2,
      z: at + length / 2,
      w: deep,
      d: length,
    }));
    // 仁愛路 south side: kept low, it sits between the camera and the snake.
    blocks(-near - BAND, width + near, [3, 5], [2, 3], (at, length, deep) => ({
      x: at + length / 2,
      z: height + near + deep / 2,
      w: length,
      d: deep,
    }));

    // Across 光復南路: the park, lawn with clumps of trees.
    const park = new THREE.Mesh(new THREE.PlaneGeometry(PARK, height + 2 * near), new THREE.MeshLambertMaterial({ color: COLORS.lawn }));
    park.rotation.x = -Math.PI / 2;
    park.position.set(width + near + PARK / 2, 0.005, height / 2);
    park.receiveShadow = true;
    this.disposables.push(park.geometry, park.material as THREE.Material);
    this.object.add(park);
    for (let i = 0; i < 60; i++) {
      const x = width + near + rng.range(0.6, PARK - 0.5);
      const z = rng.range(-near, height + near);
      tree(x, z, rng.range(1, 1.6));
    }

    const mesh = (geometry: THREE.BufferGeometry, items: Instance[], shadows: boolean) => {
      const material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
      this.disposables.push(material);
      const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
      instanced.count = items.length;
      const color = new THREE.Color();
      items.forEach((item, index) => {
        instanced.setMatrixAt(index, item.matrix);
        instanced.setColorAt(index, color.set(item.color));
      });
      instanced.castShadow = shadows;
      instanced.receiveShadow = shadows;
      return instanced;
    };
    this.object.add(mesh(box, solids, true), mesh(box, glass, false), mesh(trunk, trunks, true), mesh(crown, crowns, true));
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.object.traverse((child) => {
      if (child instanceof THREE.InstancedMesh) child.dispose();
    });
  }
}
