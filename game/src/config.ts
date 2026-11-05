// All tunable numbers live here. See ../spec.md for where each one was decided.
// 1 grid cell = 1 world unit.

export const MAP = {
  SIZE: 60,
  /** Width of the ring road along the map edge and of every main road (spec §14.1). */
  ROAD_WIDTH: 4,
  /** Width of a street in a real district. */
  STREET_WIDTH: 3,
  ALLEY_WIDTH: 2,
  /** Rectangles wider or taller than this get split by a main road. */
  BLOCK_MAX: 34,
  /** A split never leaves a block narrower than this. */
  BLOCK_MIN: 12,
  /** Blocks at least this long on one side may get an alley. */
  ALLEY_MIN_BLOCK: 10,
  ALLEY_CHANCE: 0.8,
  /** Buildings inside a block are cut into lots of at most this many cells per side. */
  LOT_MAX: 4,
  FLOORS_MIN: 1,
  FLOORS_MAX: 6,
} as const;

export const SNAKE = {
  INITIAL_LENGTH: 4,
  /** Cells per second at the initial length. */
  SPEED_BASE: 5,
  SPEED_MAX: 10,
  /** Extra cells per second for every segment beyond the initial length. */
  SPEED_K: 0.05,
  INPUT_QUEUE: 2,
} as const;

export const PEOPLE = {
  /** People on the street in normal play; eaten ones are replaced from the ring road. */
  COUNT: 30,
  /** One step every 500 ms = 2 cells per second, independent of the snake's speed. */
  STEP_MS: 500,
  /** People flee when the snake's head is this many steps away or closer. */
  FLEE_RADIUS: 5,
  /** People placed at the start are at least this many steps from the head. */
  SPAWN_MIN_DIST: 15,
  /** Replacements pick randomly among this many ring-road cells furthest from the head. */
  SPAWN_FAR_PICK: 10,
  /** Steps a replacement walks inward before it starts wandering. */
  ENTER_STEPS: 4,
  /** Chance per step that a wanderer turns at a junction even though it could go straight. */
  TURN_CHANCE: 0.25,
} as const;

export const HUNGER = {
  GRACE_MS: 15_000,
  SHRINK_MS: 2_000,
} as const;

export const SCORE = {
  /** One best score per map: `snake-city:best:random`, `snake-city:best:east` (spec §13.1). */
  STORAGE_PREFIX: 'snake-city:best:',
  /** Before there were two maps; read once and moved to the random city's key. */
  LEGACY_KEY: 'snake-city:best',
} as const;

export const DEATH = {
  /** Restart is ignored for this long after dying, so a held key does not skip the result. */
  RESTART_DELAY_MS: 750,
} as const;

export const CAMERA = {
  /** Narrow and far away, so the view angle is nearly the same across the screen and alleys show. */
  FOV: 22,
  /** Angle above the ground, in degrees. */
  ELEVATION: 68,
  /** Distance from the focus point; about 20 × 20 cells are visible. */
  DISTANCE: 46,
  /** Fraction of the remaining distance the focus covers per second (exponential smoothing). */
  FOLLOW: 8,
} as const;

export const OCCLUSION = {
  /** Buildings overlapping this box around the head (in cells) turn see-through. */
  HALF_WIDTH: 3,
  /** How far south (towards the camera) the box reaches. */
  DEPTH: 5,
  /** How far north the box reaches, for tall buildings right behind the head. */
  BEHIND: 0,
  /** Also hide lots that come within this height of the sight line, so the body near the head shows. */
  MARGIN: 1,
  OPACITY: 0.28,
} as const;

export const RENDER = {
  MAX_PIXEL_RATIO: 2,
  MAX_DELTA_MS: 100,
  FLOOR_HEIGHT: 0.4,
  PARTICLES: 240,
  /** Instanced body segments; more than any map has walkable cells. */
  MAX_SEGMENTS: 8192,
} as const;

/** Taiwanese street details in real districts (spec §14.4, §14.6). */
export const TAIWAN = {
  /** Details are placed with this seed, so a district looks the same every game. */
  SEED: 2026,
  /** Share of lots with 4+ floors that have a tin rooftop shack. */
  SHACK_CHANCE: 0.6,
  /** Chance per wall cell facing a road or street of a vertical sign. */
  SIGN_CHANCE: 0.6,
  /** Signs hang no higher than this floor (the ground floor is 0). */
  SIGN_TOP_FLOOR: 4,
  /** Chance per wall cell per floor of an air conditioner. */
  AIRCON_CHANCE: 0.3,
  /** Chance that a road or street cell next to a building has parked scooters. */
  SCOOTER_STREET_CHANCE: 0.4,
  SCOOTER_ALLEY_CHANCE: 0.1,
} as const;

/** Recording mode for vertical short videos, toggled with R (spec §15). Normal play is untouched. */
export const RECORDING = {
  /** People are drawn this much bigger. */
  PERSON_SCALE: 2.5,
  /**
   * Camera distance from the head; CAMERA.DISTANCE in normal play. The frame is about 14 cells
   * tall whatever the window shape, so a 9:16 window or a 9:16 crop of a wide one look the same.
   */
  CAMERA_DISTANCE: 34,
  /** Faster than CAMERA.FOLLOW, so the head stays near the middle of a narrow frame. */
  FOLLOW: 12,
  /** The crowd is one person per this many walkable cells (normal play: PEOPLE.COUNT). */
  CELLS_PER_PERSON: 35,
  /** Length of the head bounce and the new tail segment's pop when eating. */
  POP_MS: 350,
  /** How long the "+1" floats up. */
  PLUS_MS: 900,
} as const;

export const MINIMAP = {
  /** Length of the corner map's longer side, in CSS pixels. */
  CORNER_PX: 180,
  /** Share of the shorter window side used by the enlarged map (M). */
  ENLARGED: 0.8,
} as const;
