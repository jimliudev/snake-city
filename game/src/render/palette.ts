// Candy-coloured low-poly palette (spec §7.4).

export const COLORS = {
  sky: '#bfe6f7',
  grass: '#8fd19e',
  fence: '#f2efe6',
  road: '#5d6170',
  alley: '#4b4658',
  street: '#6b6f7d',
  laneMark: '#f6f1e2',
  sidewalk: '#e7e1d6',
  window: '#fffaf0',
  snake: '#45b649',
  snakeStripe: '#7fd855',
  snakeBelly: '#2f8f3a',
  eyeWhite: '#ffffff',
  pupil: '#1d1d1d',
  tongue: '#ff4d6d',
  pants: '#3d4a66',
  hair: '#3b2a20',
  shrinkPuff: '#b8b3a8',
  aircon: '#e6e6e1',
  grille: '#4d5358',
  arcadeColumn: '#d9d2c3',
  tinBlue: '#3f86c6',
  tinBlueDark: '#2f6ea8',
  tinWhite: '#eef2f4',
  tinWhiteDark: '#c4ccd2',
  tankWhite: '#f6f6f2',
  tankSteel: '#b5bdc4',
  glass: '#3f5b6e',
  spandrel: '#e8ecee',
  ledge: '#ece6da',
  machineRoom: '#c9c6bf',
  billboard: '#f4f1ea',
  schoolRoof: '#b5523b',
  trunk: '#7a5a3c',
  lawn: '#7fc88f',
  curb: '#d8d2c6',
} as const;

/** Street-tree leaves: camphor and maple greens (spec §14.4). */
export const LEAF_PALETTE = ['#4f9d5a', '#5fae5f', '#3f8f52', '#6dbb68'] as const;

/** Office tower glass, bluish and a little brighter than life. Same length as TAIWAN_PALETTE. */
export const GLASS_PALETTE = ['#6f97ad', '#8aaebf', '#5b8299', '#7d9fa8', '#9bb7c2', '#6a8a9c', '#88a3b5', '#a5bcc7'] as const;

/** Office podiums: granite and stone cladding. Same length as TAIWAN_PALETTE. */
export const STONE_PALETTE = ['#d9d3c7', '#c8c2b6', '#b9b3a8', '#e4dfd4', '#cbbfae', '#a8a39b', '#d6cbbb', '#bfc3c4'] as const;

/** Department stores: pale, nearly windowless walls, with a coloured band. */
export const MALL_PALETTE = ['#efe9df', '#e3ddd2', '#f2ece6', '#e8e4e0'] as const;
export const MALL_ACCENTS = ['#c8423b', '#d9822b', '#2f5d8a', '#7a4a8c'] as const;

/** Schools, hospitals and public buildings. */
export const INSTITUTION_PALETTE = ['#f1ece0', '#e9e2cf', '#eef0ec', '#e6dcc4'] as const;

/** Building colours, picked by Lot.color. Length matches BUILDING_COLORS. */
export const BUILDING_PALETTE = [
  '#ff8fa3',
  '#ffc971',
  '#8fd3ff',
  '#b5e48c',
  '#cdb4db',
  '#ffd6a5',
  '#a0c4ff',
  '#f6a6b2',
] as const;

/**
 * Taiwanese tile and concrete colours, a little brighter than life (spec §14.3): beige, milk
 * tea, brick red, light grey, off-white, light brown, sand tile, blue-grey. Same length as
 * BUILDING_PALETTE, so Lot.color works with either.
 */
export const TAIWAN_PALETTE = [
  '#f0dcb4',
  '#dcb48f',
  '#d9785e',
  '#cfd1cc',
  '#f3efe4',
  '#bf9572',
  '#ead09a',
  '#a9bcc4',
] as const;

/** Shirt colours, picked by Person.color. Length matches SHIRT_COLORS. */
export const SHIRT_PALETTE = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#6a4c93', '#1982c4'] as const;

export const SKIN_PALETTE = ['#f6d5b8', '#e0ac85', '#a86b4c'] as const;

/**
 * Recording mode shirts (spec §15.1): neon colours that no building, road or sign uses, drawn
 * partly self-lit so they stay bright in shadow. Length matches SHIRT_COLORS.
 */
export const RECORDING_SHIRT_PALETTE = ['#ff2d95', '#00e5ff', '#b6ff00', '#ff6a00', '#c13cff', '#fff200'] as const;

export const RECORDING_PANTS = '#1c1b33';
