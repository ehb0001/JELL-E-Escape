// ── Tile Types ──
const TILE = {
    FLOOR: 0,
    WALL: 1,
    METAL_WALL: 2,   // Silver wall - attracts magnet-state player
    RUBBER_WALL: 3,  // Brown bouncy wall - bounces player back 2 tiles
    ELECTRIC_DOOR: 4,// Yellow door - only electric state can pass
    PORTAL: 5,       // Exit
    ITEM_MAGNET: 10,
    ITEM_ICE: 11,
    ITEM_ELECTRIC: 12,
};

// ── Player States ──
const STATE = {
    NORMAL: 'normal',
    MAGNET: 'magnet',
    ICE: 'ice',
    ELECTRIC: 'electric',
};

const STATE_INFO = {
    [STATE.NORMAL]:   { name: 'Normal',   icon: '○', color: '#69F0AE', glow: '#00E676', bgAlpha: 0.7 },
    [STATE.MAGNET]:   { name: 'Magnet',   icon: '🧲', color: '#4FC3F7', glow: '#039BE5', bgAlpha: 0.8 },
    [STATE.ICE]:      { name: 'Ice',      icon: '❄️', color: '#B2EBF2', glow: '#00BCD4', bgAlpha: 0.6 },
    [STATE.ELECTRIC]: { name: 'Electric', icon: '⚡', color: '#FFD54F', glow: '#FFC107', bgAlpha: 0.9 },
};

// ── Tile visual config ──
const TILE_COLORS = {
    [TILE.FLOOR]:         { fill: '#252540', stroke: '#2a2a50' },
    [TILE.WALL]:          { fill: '#3D3D5C', stroke: '#4a4a6a', gradient: ['#3D3D5C', '#2D2D44'] },
    [TILE.METAL_WALL]:    { fill: '#546E7A', stroke: '#78909C', gradient: ['#78909C', '#455A64'], shine: '#90A4AE' },
    [TILE.RUBBER_WALL]:   { fill: '#6D4C41', stroke: '#8D6E63', gradient: ['#A1887F', '#5D4037'] },
    [TILE.ELECTRIC_DOOR]: { fill: '#FFD54F', stroke: '#FFC107', gradient: ['#FFE082', '#FFD54F'] },
    [TILE.PORTAL]:        { fill: '#E040FB', stroke: '#AB47BC', gradient: ['#EA80FC', '#CE93D8'], glow: '#E040FB' },
    [TILE.ITEM_MAGNET]:   { color: '#4FC3F7', icon: '🧲' },
    [TILE.ITEM_ICE]:      { color: '#B2EBF2', icon: '❄️' },
    [TILE.ITEM_ELECTRIC]: { color: '#FFD54F', icon: '⚡' },
};

// ── Map char → tile ──
const CHAR_TO_TILE = {
    '#': TILE.WALL,
    ' ': TILE.WALL,
    'M': TILE.METAL_WALL,
    'R': TILE.RUBBER_WALL,
    '.': TILE.FLOOR,
    'X': TILE.PORTAL,
    'D': TILE.ELECTRIC_DOOR,
    'P': TILE.FLOOR,
    'm': TILE.ITEM_MAGNET,
    'i': TILE.ITEM_ICE,
    'e': TILE.ITEM_ELECTRIC
};

// ── Helpers ──
function isWall(t) { return t === TILE.WALL || t === TILE.METAL_WALL || t === TILE.RUBBER_WALL; }
function isItem(t) { return t === TILE.ITEM_MAGNET || t === TILE.ITEM_ICE || t === TILE.ITEM_ELECTRIC; }

function isBlocking(t, state) {
    if (t === TILE.WALL || t === TILE.METAL_WALL || t === TILE.RUBBER_WALL) return true;
    if (t === TILE.ELECTRIC_DOOR) return state !== STATE.ELECTRIC;
    return false;
}

const ITEM_TO_STATE = {
    [TILE.ITEM_MAGNET]: STATE.MAGNET,
    [TILE.ITEM_ICE]: STATE.ICE,
    [TILE.ITEM_ELECTRIC]: STATE.ELECTRIC,
};

const DIR = {
    up:    { x:  0, y: -1 }, down:  { x:  0, y:  1 },
    left:  { x: -1, y:  0 }, right: { x:  1, y:  0 },
};

// Screen-space swipe directions -> 3D grid delta, per view axis.
// 'z' view (X-Y plane, default): up/down move Y, left/right move X.
// 'x' view (Z-Y plane, rotated 90° CW so screen-right is -Z): up/down move Y, left/right move Z.
const VIEW_DIR_3D = {
    z: {
        up:    { dx: 0, dy: -1, dz: 0 },
        down:  { dx: 0, dy:  1, dz: 0 },
        left:  { dx: -1, dy: 0, dz: 0 },
        right: { dx:  1, dy: 0, dz: 0 },
    },
    x: {
        up:    { dx: 0, dy: -1, dz: 0 },
        down:  { dx: 0, dy:  1, dz: 0 },
        left:  { dx: 0, dy: 0, dz:  1 },
        right: { dx: 0, dy: 0, dz: -1 },
    },
};

// Clockwise perpendicular for ice slip
const ICE_SLIP = { up: DIR.right, right: DIR.down, down: DIR.left, left: DIR.up };

const GAME_STATE = {
    TITLE: 'title', LEVEL_SELECT: 'level_select',
    PLAYING: 'playing', ANIMATING: 'animating', LEVEL_CLEAR: 'level_clear',
};
