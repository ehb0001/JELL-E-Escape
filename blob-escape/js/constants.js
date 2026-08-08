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

// [MODIFIED] 상태별 실루엣과 광원이 즉시 구분되도록 출시용 네온 팔레트와 기호로 통일
const STATE_INFO = {
    [STATE.NORMAL]:   { name: 'Stable',   icon: '●', color: '#78FFD6', glow: '#21E6A4', bgAlpha: 0.92 },
    [STATE.MAGNET]:   { name: 'Magnet',   icon: '∩', color: '#42C9FF', glow: '#168CFF', bgAlpha: 0.94 },
    [STATE.ICE]:      { name: 'Cryo',     icon: '✦', color: '#B8F4FF', glow: '#3CCBFF', bgAlpha: 0.9 },
    [STATE.ELECTRIC]: { name: 'Volt',     icon: 'ϟ', color: '#FFD66B', glow: '#FF9F1C', bgAlpha: 0.96 },
};

// ── Tile visual config ──
// [MODIFIED] 재질마다 명도·온도·발광색을 분리해 작은 타일에서도 기능을 읽을 수 있도록 개선
const TILE_COLORS = {
    [TILE.FLOOR]:         { fill: '#111A31', stroke: '#1B2C4B' },
    [TILE.WALL]:          { fill: '#263451', stroke: '#405478', gradient: ['#344563', '#17233B'] },
    [TILE.METAL_WALL]:    { fill: '#34566C', stroke: '#65C7E8', gradient: ['#507E94', '#1D3D52'], shine: '#A8EEFF' },
    [TILE.RUBBER_WALL]:   { fill: '#713C4F', stroke: '#F08A91', gradient: ['#A65367', '#4B283D'] },
    [TILE.ELECTRIC_DOOR]: { fill: '#9B6A1F', stroke: '#FFD66B', gradient: ['#F3C557', '#6F4617'] },
    [TILE.PORTAL]:        { fill: '#B65CFF', stroke: '#E4A8FF', gradient: ['#D696FF', '#6A2CC1'], glow: '#BF5CFF' },
    [TILE.ITEM_MAGNET]:   { color: '#42C9FF', accent: '#F15A73', icon: '∩' },
    [TILE.ITEM_ICE]:      { color: '#B8F4FF', accent: '#51C8FF', icon: '✦' },
    [TILE.ITEM_ELECTRIC]: { color: '#FFD66B', accent: '#FF8F3D', icon: 'ϟ' },
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
