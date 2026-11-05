import * as THREE from 'three';
import { CAMERA } from '../config';

/** High tilted view from the south, north always up, sliding after the head without turning (spec §7.1). */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.FOV, 1, 0.5, 300);
  readonly focus = new THREE.Vector3();
  /** Unit vector from the focus towards the camera. */
  private readonly direction: THREE.Vector3;
  private distance: number = CAMERA.DISTANCE;
  private targetDistance: number = CAMERA.DISTANCE;
  private followRate: number = CAMERA.FOLLOW;
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();

  constructor() {
    const elevation = THREE.MathUtils.degToRad(CAMERA.ELEVATION);
    this.direction = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation));
  }

  /** Recording mode moves in closer and follows tighter (spec §15.2). The zoom eases over a moment. */
  setFraming(distance: number, followRate: number): void {
    this.targetDistance = distance;
    this.followRate = followRate;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  follow(target: THREE.Vector3, deltaMs: number): void {
    const ease = (rate: number) => 1 - Math.exp((-rate * deltaMs) / 1000);
    this.focus.lerp(target, ease(this.followRate));
    this.distance += (this.targetDistance - this.distance) * ease(4);
    this.place();
  }

  snap(target: THREE.Vector3): void {
    this.focus.copy(target);
    this.distance = this.targetDistance;
    this.place();
  }

  private place(): void {
    this.camera.position.copy(this.focus).addScaledVector(this.direction, this.distance);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }

  /** Where the four screen corners hit the ground, for the view outline on the minimap. */
  groundCorners(): Array<{ x: number; z: number }> {
    const corners: Array<{ x: number; z: number }> = [];
    const hit = new THREE.Vector3();
    for (const [x, y] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
      if (this.raycaster.ray.intersectPlane(this.ground, hit)) corners.push({ x: hit.x, z: hit.z });
    }
    return corners;
  }
}
