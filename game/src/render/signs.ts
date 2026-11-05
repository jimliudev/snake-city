// Vertical shop signs with generic words, never real shop names or brands (spec §14.5).
// Every word is drawn once into a shared atlas texture.

import * as THREE from 'three';

export const SIGN_WORDS = [
  '麵', '茶', '冰', '藥局', '牙醫', '診所', '當舖', '便當', '鹽酥雞', '補習班',
  '眼鏡', '水電', '鎖', '早餐', '咖啡', '手機', '美髮', '洗衣', '五金', '檳榔',
  '銀樓', '旅社', '刻印', '豆花', '滷味', '燒臘', '按摩', '書局', '花店', '茶行',
] as const;

/** Sign backgrounds; the text is dark (spec §14.3: the brightest things in the street). */
export const SIGN_COLORS = ['#ff4d4d', '#ffd23f', '#3ddc84', '#4da3ff', '#ff9f1c', '#ffffff', '#ff6fb5'] as const;

const COLUMN = 64;
const ATLAS_W = 2048;
const ATLAS_H = 256;
const PAD = 8;

/** Sign size in world units: one character is SIGN_CHAR tall. */
export const SIGN_CHAR = 0.32;
export const SIGN_THICKNESS = 0.06;
export const SIGN_DEPTH = 0.4;

function drawAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, ATLAS_W, ATLAS_H);
  context.fillStyle = '#1b1b1f';
  context.font = `bold ${COLUMN - 12}px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  SIGN_WORDS.forEach((word, column) => {
    [...word].forEach((char, row) => {
      context.fillText(char, column * COLUMN + COLUMN / 2, PAD + row * COLUMN + COLUMN / 2);
    });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export interface SignKit {
  /** One geometry per word: a ground-based box, x thin, z sticking out of the wall. */
  geometries: THREE.BoxGeometry[];
  /** Text on the two broad faces, plain colour elsewhere; tinted by instance colour. */
  materials: THREE.Material[];
  heights: number[];
  dispose(): void;
}

export function makeSignKit(): SignKit {
  const texture = drawAtlas();
  const lettered = new THREE.MeshLambertMaterial({ map: texture });
  const plain = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const heights: number[] = [];
  const geometries = SIGN_WORDS.map((word, column) => {
    const chars = [...word].length;
    const height = chars * SIGN_CHAR + 0.08;
    heights.push(height);
    const geometry = new THREE.BoxGeometry(SIGN_THICKNESS, height, SIGN_DEPTH).translate(0, height / 2, 0);
    // Faces 0 and 1 (±x) are the broad ones; point their UVs at this word's column.
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const u0 = (column * COLUMN) / ATLAS_W;
    const u1 = ((column + 1) * COLUMN) / ATLAS_W;
    const v1 = 1;
    const v0 = 1 - (chars * COLUMN + 2 * PAD) / ATLAS_H;
    for (let i = 0; i < 8; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    uv.needsUpdate = true;
    return geometry;
  });
  const materials = [lettered, lettered, plain, plain, plain, plain];
  return {
    geometries,
    materials,
    heights,
    dispose() {
      texture.dispose();
      lettered.dispose();
      plain.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
}
