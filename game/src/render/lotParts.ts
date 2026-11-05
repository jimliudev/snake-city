import * as THREE from 'three';

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Instances that belong to building lots: bodies, roofs, windows, signs… When a lot turns
 * see-through (spec §7.1), its instances are hidden, or moved to a translucent twin mesh when
 * one is given.
 */
export class LotParts {
  private readonly matrices: THREE.Matrix4[] = [];
  private readonly colors: Array<THREE.Color | null> = [];
  private readonly lotOf: number[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private ghostMesh: THREE.InstancedMesh | null = null;

  constructor(
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material | THREE.Material[],
    private readonly ghostMaterial: THREE.Material | null = null,
    private readonly shadows = true,
  ) {}

  add(lot: number, matrix: THREE.Matrix4, color?: THREE.ColorRepresentation): void {
    this.matrices.push(matrix);
    this.colors.push(color === undefined ? null : new THREE.Color(color));
    this.lotOf.push(lot);
  }

  get count(): number {
    return this.matrices.length;
  }

  build(): THREE.InstancedMesh[] {
    const make = (material: THREE.Material | THREE.Material[]) => {
      const mesh = new THREE.InstancedMesh(this.geometry, material, Math.max(1, this.matrices.length));
      mesh.count = this.matrices.length;
      this.colors.forEach((color, index) => {
        if (color) mesh.setColorAt(index, color);
      });
      // Instances come and go with the see-through effect, so precomputed bounds go stale.
      mesh.frustumCulled = false;
      return mesh;
    };
    this.mesh = make(this.material);
    this.mesh.castShadow = this.shadows;
    this.mesh.receiveShadow = this.shadows;
    const meshes = [this.mesh];
    if (this.ghostMaterial) {
      this.ghostMesh = make(this.ghostMaterial);
      meshes.push(this.ghostMesh);
    }
    this.setGhosts(new Uint8Array(0));
    return meshes;
  }

  /** `isGhost[lot]` is 1 for lots shown see-through. */
  setGhosts(isGhost: Uint8Array): void {
    if (!this.mesh) return;
    this.matrices.forEach((matrix, index) => {
      const ghost = isGhost[this.lotOf[index]] === 1;
      this.mesh!.setMatrixAt(index, ghost ? hidden : matrix);
      this.ghostMesh?.setMatrixAt(index, ghost ? matrix : hidden);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.ghostMesh) this.ghostMesh.instanceMatrix.needsUpdate = true;
  }
}
