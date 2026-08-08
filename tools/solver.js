const fs = require('fs');
const path = require('path');

const TILE = {
    FLOOR: 0,
    WALL: 1,
    METAL_WALL: 2,
    RUBBER_WALL: 3,
    ELECTRIC_DOOR: 4,
    PORTAL: 5,
    FIRE: 6,
    ITEM_MAGNET: 10,
    ITEM_ICE: 11,
    ITEM_ELECTRIC: 12,
};

const STATE = {
    NORMAL: 'normal',
    MAGNET: 'magnet',
    ICE: 'ice',
    ELECTRIC: 'electric',
};

const CHAR_TO_TILE = {
    '#': TILE.WALL,
    ' ': TILE.WALL,
    'M': TILE.METAL_WALL,
    'R': TILE.RUBBER_WALL,
    '.': TILE.FLOOR,
    'X': TILE.PORTAL,
    'D': TILE.ELECTRIC_DOOR,
    'F': TILE.FIRE,
    'P': TILE.FLOOR,
    'm': TILE.ITEM_MAGNET,
    'i': TILE.ITEM_ICE,
    'e': TILE.ITEM_ELECTRIC,
};

const ITEM_TO_STATE = {
    [TILE.ITEM_MAGNET]: STATE.MAGNET,
    [TILE.ITEM_ICE]: STATE.ICE,
    [TILE.ITEM_ELECTRIC]: STATE.ELECTRIC,
};

const DIRS = {
    up:    { dx: 0, dy: -1, dz: 0 },
    down:  { dx: 0, dy:  1, dz: 0 },
    left:  { dx: -1, dy: 0, dz: 0 },
    right: { dx:  1, dy: 0, dz: 0 },
};

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

function isWall(tile) {
    return tile === TILE.WALL || tile === TILE.METAL_WALL || tile === TILE.RUBBER_WALL;
}

function isItem(tile) {
    return tile === TILE.ITEM_MAGNET || tile === TILE.ITEM_ICE || tile === TILE.ITEM_ELECTRIC;
}

function isBlocking(tile, state) {
    if (tile === TILE.WALL || tile === TILE.METAL_WALL || tile === TILE.RUBBER_WALL) return true;
    if (tile === TILE.ELECTRIC_DOOR) return state !== STATE.ELECTRIC;
    return false;
}

function parseLevel(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const layers = data.map;
    const depth = layers.length;
    let height = 0;
    let width = 0;

    for (const layer of layers) {
        height = Math.max(height, layer.length);
        for (const row of layer) {
            width = Math.max(width, row.length);
        }
    }

    const grid = [];
    let start = null;
    let portal = null;

    for (let z = 0; z < depth; z++) {
        const layer = layers[z];
        const grid2d = [];
        for (let y = 0; y < height; y++) {
            const row = [];
            const srcRow = y < layer.length ? layer[y] : '';
            for (let x = 0; x < width; x++) {
                const ch = x < srcRow.length ? srcRow[x] : ' ';
                const tile = CHAR_TO_TILE[ch] !== undefined ? CHAR_TO_TILE[ch] : TILE.FLOOR;
                row.push(tile);
                if (ch === 'P') start = { x, y, z };
                if (ch === 'X') portal = { x, y, z };
            }
            grid2d.push(row);
        }
        grid.push(grid2d);
    }

    return { id: data.id, name: data.name, subtitle: data.subtitle, map: grid, width, height, depth, start, portal, data };
}

function getTile(level, x, y, z, state, consumedItems, openedDoors, extinguishedFire) {
    if (x < 0 || y < 0 || z < 0 || x >= level.width || y >= level.height || z >= level.depth) return TILE.WALL;
    const key = `${x},${y},${z}`;
    if (extinguishedFire.has(key)) return TILE.WALL;
    if (openedDoors.has(key)) return TILE.FLOOR;
    if (consumedItems.has(key)) return TILE.FLOOR;
    return level.map[z][y][x];
}

function isElectricDoor(tile) {
    return tile === TILE.ELECTRIC_DOOR;
}

function resolveSlide(level, startX, startY, startZ, dx, dy, dz, state, consumedItems, openedDoors, extinguishedFire, viewAxis) {
    let x = startX;
    let y = startY;
    let z = startZ;
    let hitWallType = null;
    let hitWallX = undefined;
    let hitWallY = undefined;
    let hitWallZ = undefined;
    let moved = false;

    let perpDx = 0, perpDy = 0, perpDz = 0;
    if (dx !== 0) {
        perpDy = 1;
    } else if (dz !== 0) {
        perpDy = 1;
    } else {
        if (viewAxis === 'x') perpDz = 1;
        else perpDx = 1;
    }

    while (true) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const tile = getTile(level, nx, ny, nz, state, consumedItems, openedDoors, extinguishedFire);

        if (tile === TILE.PORTAL) {
            x = nx; y = ny; z = nz;
            moved = true;
            break;
        }

        if (tile === TILE.ELECTRIC_DOOR && state === STATE.ELECTRIC) {
        } else if (isBlocking(tile, state)) {
            hitWallType = tile;
            hitWallX = nx;
            hitWallY = ny;
            hitWallZ = nz;
            break;
        }

        x = nx; y = ny; z = nz;
        moved = true;

        if (state === STATE.MAGNET) {
            const side1x = x + perpDx, side1y = y + perpDy, side1z = z + perpDz;
            const side2x = x - perpDx, side2y = y - perpDy, side2z = z - perpDz;
            if (getTile(level, side1x, side1y, side1z, state, consumedItems, openedDoors, extinguishedFire) === TILE.METAL_WALL) {
                hitWallType = TILE.METAL_WALL;
                hitWallX = side1x; hitWallY = side1y; hitWallZ = side1z;
                break;
            }
            if (getTile(level, side2x, side2y, side2z, state, consumedItems, openedDoors, extinguishedFire) === TILE.METAL_WALL) {
                hitWallType = TILE.METAL_WALL;
                hitWallX = side2x; hitWallY = side2y; hitWallZ = side2z;
                break;
            }
        }
    }

    return { x, y, z, hitWallType, hitWallX, hitWallY, hitWallZ, moved };
}

function scanForFire(level, startX, startY, startZ, endX, endY, endZ, dx, dy, dz, state, consumedItems, openedDoors, extinguishedFire) {
    let x = startX;
    let y = startY;
    let z = startZ;

    while (x !== endX || y !== endY || z !== endZ) {
        x += dx; y += dy; z += dz;
        const tile = getTile(level, x, y, z, state, consumedItems, openedDoors, extinguishedFire);
        if (tile === TILE.FIRE) return { x, y, z };
    }
    return null;
}

function moveOneStep(level, startX, startY, startZ, direction, state, consumedItems, openedDoors, extinguishedFire, viewAxis) {
    const delta = VIEW_DIR_3D[viewAxis][direction];
    if (!delta) return null;
    const { dx, dy, dz } = delta;

    const startState = state;
    const initialSlide = resolveSlide(level, startX, startY, startZ, dx, dy, dz, state, consumedItems, openedDoors, extinguishedFire, viewAxis);
    let x = initialSlide.x;
    let y = initialSlide.y;
    let z = initialSlide.z;
    let hitWallType = initialSlide.hitWallType;
    let hitWallX = initialSlide.hitWallX;
    let hitWallY = initialSlide.hitWallY;
    let hitWallZ = initialSlide.hitWallZ;
    let moved = initialSlide.moved;

    if (!moved && hitWallType !== TILE.RUBBER_WALL) return null;

    const firePos = scanForFire(level, startX, startY, startZ, x, y, z, dx, dy, dz, state, consumedItems, openedDoors, extinguishedFire);
    let consumed = new Set(consumedItems);
    let opened = new Set(openedDoors);
    let extinguished = new Set(extinguishedFire);
    let nextState = state;
    let itemsConsumed = [];

    if (firePos) {
        if (state !== STATE.ICE) return null;
        extinguished.add(`${firePos.x},${firePos.y},${firePos.z}`);
        nextState = STATE.NORMAL;
        const recalculated = resolveSlide(level, startX, startY, startZ, dx, dy, dz, nextState, consumed, opened, extinguished, viewAxis);
        x = recalculated.x;
        y = recalculated.y;
        z = recalculated.z;
        hitWallType = recalculated.hitWallType;
        hitWallX = recalculated.hitWallX;
        hitWallY = recalculated.hitWallY;
        hitWallZ = recalculated.hitWallZ;
        moved = recalculated.moved;
        if (!moved && hitWallType !== TILE.RUBBER_WALL) return null;
    }

    let ix = startX;
    let iy = startY;
    let iz = startZ;
    while (ix !== x || iy !== y || iz !== z) {
        ix += dx; iy += dy; iz += dz;
        const tile = getTile(level, ix, iy, iz, state, consumed, opened, extinguished);
        if (isItem(tile) && itemsConsumed.length === 0) {
            itemsConsumed.push({ x: ix, y: iy, z: iz, type: tile });
        }
    }

    for (const item of itemsConsumed) {
        consumed.add(`${item.x},${item.y},${item.z}`);
        nextState = ITEM_TO_STATE[item.type];
    }

    // Open any electric doors passed through during primary slide if we are electric.
    if (nextState === STATE.ELECTRIC) {
        let currX = startX, currY = startY, currZ = startZ;
        while (currX !== x || currY !== y || currZ !== z) {
            currX += dx; currY += dy; currZ += dz;
            const tile = getTile(level, currX, currY, currZ, STATE.ELECTRIC, consumed, opened, extinguished);
            if (tile === TILE.ELECTRIC_DOOR) {
                opened.add(`${currX},${currY},${currZ}`);
                nextState = STATE.NORMAL;
            }
        }
    }

    let bounceX = x;
    let bounceY = y;
    let bounceZ = z;
    if (hitWallType === TILE.RUBBER_WALL) {
        const backDx = -dx, backDy = -dy, backDz = -dz;
        const bx = x + backDx;
        const by = y + backDy;
        const bz = z + backDz;
        const tileBehind = getTile(level, bx, by, bz, startState, consumed, opened, extinguished);
        if (!isBlocking(tileBehind, startState)) {
            bounceX = bx; bounceY = by; bounceZ = bz;
        }
    }

    if (nextState === STATE.ELECTRIC) {
        let currX = x, currY = y, currZ = z;
        while (currX !== bounceX || currY !== bounceY || currZ !== bounceZ) {
            currX += Math.sign(bounceX - currX);
            currY += Math.sign(bounceY - currY);
            currZ += Math.sign(bounceZ - currZ);
            const tile = getTile(level, currX, currY, currZ, STATE.ELECTRIC, consumed, opened, extinguished);
            if (tile === TILE.ELECTRIC_DOOR) {
                opened.add(`${currX},${currY},${currZ}`);
                nextState = STATE.NORMAL;
            }
        }
    }

    const result = {
        x: bounceX,
        y: bounceY,
        z: bounceZ,
        state: nextState,
        consumedItems: consumed,
        openedDoors: opened,
        extinguishedFire: extinguished,
        portal: getTile(level, bounceX, bounceY, bounceZ, nextState, consumed, opened, extinguished) === TILE.PORTAL,
    };

    const pathFrom = { x, y, z, hitWallType, hitWallX, hitWallY, hitWallZ };
    return { ...result, pathFrom };
}

function serializeState(state) {
    const items = Array.from(state.consumedItems).sort().join('|');
    const doors = Array.from(state.openedDoors).sort().join('|');
    const fires = Array.from(state.extinguishedFire).sort().join('|');
    return `${state.x},${state.y},${state.z}|${state.state}|${items}|${doors}|${fires}`;
}

function findStartState(level) {
    return {
        x: level.start.x,
        y: level.start.y,
        z: level.start.z,
        state: STATE.NORMAL,
        consumedItems: new Set(),
        openedDoors: new Set(),
        extinguishedFire: new Set(),
        viewAxis: 'z',
    };
}

function isPortal(state, level) {
    return state.x === level.portal.x && state.y === level.portal.y && state.z === level.portal.z;
}

function bfsSolve(level) {
    const start = findStartState(level);
    const queue = [{ ...start, depth: 0 }];
    const visited = new Set([serializeState(start)]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (isPortal(current, level)) return { solved: true, moves: current.depth };

        for (const direction of Object.keys(VIEW_DIR_3D[start.viewAxis])) {
            const next = moveOneStep(level, current.x, current.y, current.z, direction, current.state, current.consumedItems, current.openedDoors, current.extinguishedFire, current.viewAxis);
            if (!next) continue;
            const nextState = {
                x: next.x,
                y: next.y,
                z: next.z,
                state: next.state,
                consumedItems: next.consumedItems,
                openedDoors: next.openedDoors,
                extinguishedFire: next.extinguishedFire,
                viewAxis: start.viewAxis,
            };
            const id = serializeState(nextState);
            if (visited.has(id)) continue;
            visited.add(id);
            queue.push({ ...nextState, depth: current.depth + 1 });
        }
    }

    return { solved: false };
}

function assertBlockedDirectly(level, direction) {
    const start = findStartState(level);
    const next = moveOneStep(level, start.x, start.y, start.z, direction, start.state, start.consumedItems, start.openedDoors, start.extinguishedFire, start.viewAxis);
    if (!next) return { blocked: true };
    return {
        blocked: false,
        reason: `Direction ${direction} moved to ${next.x},${next.y},${next.z} instead of blocking`,
    };
}

function assertRequiresItem(level, itemType) {
    const start = findStartState(level);
    const queue = [{ ...start, depth: 0 }];
    const visited = new Set([serializeState(start)]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (isPortal(current, level)) return { requiresItem: false, reason: 'Portal reachable without item' };

        for (const direction of Object.keys(VIEW_DIR_3D[start.viewAxis])) {
            const next = moveOneStep(level, current.x, current.y, current.z, direction, current.state, current.consumedItems, current.openedDoors, current.extinguishedFire, current.viewAxis);
            if (!next) continue;
            if (next.state === itemType) continue;
            const nextState = {
                x: next.x,
                y: next.y,
                z: next.z,
                state: next.state,
                consumedItems: next.consumedItems,
                openedDoors: next.openedDoors,
                extinguishedFire: next.extinguishedFire,
                viewAxis: start.viewAxis,
            };
            const id = serializeState(nextState);
            if (visited.has(id)) continue;
            visited.add(id);
            queue.push({ ...nextState, depth: current.depth + 1 });
        }
    }

    return { requiresItem: true };
}

function assertSolvedWithinMoves(level, maxMoves) {
    const result = bfsSolve(level);
    return {
        solved: result.solved,
        moves: result.solved ? result.moves : null,
        within: result.solved ? result.moves <= maxMoves : false,
        reason: result.solved ? `Solved in ${result.moves} moves` : 'No solution',
    };
}

function runVerifier(filePath) {
    const level = parseLevel(filePath);
    console.log(`Level ${level.id}: ${level.name}`);
    console.log(`Start: ${level.start.x},${level.start.y},${level.start.z}; Portal: ${level.portal.x},${level.portal.y},${level.portal.z}`);

    const solve = bfsSolve(level);
    console.log(`Solve: ${solve.solved ? 'yes' : 'no'}${solve.solved ? ` in ${solve.moves} moves` : ''}`);

    const directions = ['up', 'right', 'down', 'left'];
    for (const dir of directions) {
        const blocked = assertBlockedDirectly(level, dir);
        console.log(`Blocked ${dir}: ${blocked.blocked ? 'yes' : 'no'}${blocked.reason ? ` (${blocked.reason})` : ''}`);
    }

    const requiresIce = assertRequiresItem(level, STATE.ICE);
    console.log(`Requires ice?: ${requiresIce.requiresItem ? 'yes' : 'no'}${requiresIce.reason ? ` (${requiresIce.reason})` : ''}`);

    const within5 = assertSolvedWithinMoves(level, 5);
    console.log(`Within 5 moves?: ${within5.within ? 'yes' : 'no'}${within5.reason ? ` (${within5.reason})` : ''}`);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: node tools/solver.js <level.json>');
        process.exit(1);
    }
    for (const filePath of args) {
        runVerifier(path.resolve(process.cwd(), filePath));
        console.log('');
    }
}
module.exports = {
    TILE,
    STATE,
    DIRS,
    VIEW_DIR_3D,
    parseLevel,
    getTile,
    resolveSlide,
    scanForFire,
    moveOneStep,
    bfsSolve,
    assertBlockedDirectly,
    assertRequiresItem,
    assertSolvedWithinMoves,
};