// ── Level Data Loading ──
// Level definitions live as individual JSON files under levels/,
// listed in levels/manifest.json. loadAllLevels() fetches them and
// fills LEVELS_DATA before the game boots.

const LEVELS_DATA = [];

async function loadAllLevels() {
    const manifestRes = await fetch('levels/manifest.json', { cache: 'no-store' });
    const manifest = await manifestRes.json();

    const levels = await Promise.all(
        manifest.map(async (fname) => {
            const res = await fetch(`levels/${fname}`, { cache: 'no-store' });
            return res.json();
        })
    );

    levels.sort((a, b) => a.id - b.id);
    LEVELS_DATA.push(...levels);
    return LEVELS_DATA;
}


class Level {
    constructor() {
        this.grid = [];       // grid[z][y][x]
        this.width = 0;       // X extent
        this.height = 0;      // Y extent
        this.depth = 0;       // Z extent (number of layers)
        this.playerStart = { x: 0, y: 0, z: 0 };
        this.portalPos = { x: 0, y: 0, z: 0 };
        this.consumedItems = new Set(); // Track consumed items by "x,y,z"
        this.openedDoors = new Set();
        this.levelData = null;
        this.tileSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.time = 0;

        // View: which axis is fixed to slice the 3D grid into a 2D plane.
        // 'z' (default) shows the X-Y plane at layer viewZ (today's view).
        // 'x' shows the Z-Y plane at column viewX.
        this.viewAxis = 'z';
        this.viewZ = 0;
        this.viewX = 0;

        // Effects state
        this.rubberHitMap = new Map(); // "x,y,z" -> timer
    }

    load(levelIndex) {
        const data = LEVELS_DATA[levelIndex];
        if (!data) return false;

        this.levelData = data;
        this.consumedItems = new Set();
        this.openedDoors = new Set();
        this.rubberHitMap.clear();

        const layers = data.map;
        this.depth = layers.length;
        this.height = 0;
        this.width = 0;
        for (const layer of layers) {
            if (layer.length > this.height) this.height = layer.length;
            for (const row of layer) {
                if (row.length > this.width) this.width = row.length;
            }
        }

        this.grid = [];
        for (let z = 0; z < this.depth; z++) {
            const layer = layers[z];
            const grid2d = [];
            for (let y = 0; y < this.height; y++) {
                const row = [];
                const srcRow = y < layer.length ? layer[y] : '';
                for (let x = 0; x < this.width; x++) {
                    const ch = x < srcRow.length ? srcRow[x] : ' ';
                    const tile = CHAR_TO_TILE[ch] !== undefined ? CHAR_TO_TILE[ch] : TILE.FLOOR;
                    row.push(tile);

                    if (ch === 'P') this.playerStart = { x, y, z };
                    if (ch === 'X') this.portalPos = { x, y, z };
                }
                grid2d.push(row);
            }
            this.grid.push(grid2d);
        }

        this.viewAxis = 'z';
        this.viewZ = this.playerStart.z;
        this.viewX = this.playerStart.x;
        return true;
    }

    // ── View (axis) control ──

    setView(axis, index) {
        this.viewAxis = axis;
        if (axis === 'z') this.viewZ = index;
        else if (axis === 'x') this.viewX = index;
    }

    // Dimensions of the currently visible 2D plane, in (col, row) terms.
    getViewDimensions() {
        if (this.viewAxis === 'x') return { cols: this.height, rows: this.depth };
        return { cols: this.width, rows: this.height };
    }

    // Map a point on the current 2D plane (col, row) to full 3D grid coords.
    viewToGrid(col, row) {
        if (this.viewAxis === 'x') return { x: this.viewX, y: col, z: row };
        return { x: col, y: row, z: this.viewZ };
    }

    calculateLayout(canvasWidth, canvasHeight) {
        const padding = 15;
        const availW = canvasWidth - padding * 2;
        const availH = canvasHeight - padding * 2;
        const { cols, rows } = this.getViewDimensions();
        this.tileSize = Math.floor(Math.min(availW / cols, availH / rows));
        this.offsetX = Math.floor((canvasWidth - this.tileSize * cols) / 2);
        this.offsetY = Math.floor((canvasHeight - this.tileSize * rows) / 2);
    }

    getTile(x, y, z = this.viewZ) {
        if (x < 0 || y < 0 || z < 0 || x >= this.width || y >= this.height || z >= this.depth) return TILE.WALL;
        const key = `${x},${y},${z}`;
        if (this.openedDoors.has(key)) return TILE.FLOOR;
        if (this.consumedItems.has(key)) return TILE.FLOOR;
        return this.grid[z][y][x];
    }

    consumeItem(x, y, z = this.viewZ) {
        this.consumedItems.add(`${x},${y},${z}`);
    }

    openDoor(x, y, z = this.viewZ) {
        this.openedDoors.add(`${x},${y},${z}`);
    }

    triggerRubberBounce(x, y, z = this.viewZ) {
        this.rubberHitMap.set(`${x},${y},${z}`, 0.4); // 0.4s animation
    }

    gridToPixel(gx, gy) {
        // gx, gy here are coordinates on the current 2D view plane (col, row),
        // matching the historical (x, y) call sites.
        return {
            x: this.offsetX + gx * this.tileSize + this.tileSize / 2,
            y: this.offsetY + gy * this.tileSize + this.tileSize / 2,
        };
    }

    update(dt) {
        this.time += dt;

        // Update rubber hits
        for (const [key, time] of this.rubberHitMap.entries()) {
            if (time <= dt) {
                this.rubberHitMap.delete(key);
            } else {
                this.rubberHitMap.set(key, time - dt);
            }
        }
    }

    render(ctx, canvasWidth, canvasHeight) {
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        const { cols, rows } = this.getViewDimensions();
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const g = this.viewToGrid(col, row);
                const tile = this.getTile(g.x, g.y, g.z);
                const px = this.offsetX + col * this.tileSize;
                const py = this.offsetY + row * this.tileSize;
                this._renderTile(ctx, tile, px, py, this.tileSize, g.x, g.y, g.z);
            }
        }
    }

    _renderTile(ctx, tile, px, py, s, gx, gy, gz = this.viewZ) {
        const gap = 1;
        const innerX = px + gap;
        const innerY = py + gap;
        const innerS = s - gap * 2;

        ctx.save();

        // Base floor for items and doors
        if (isItem(tile) || tile === TILE.PORTAL || tile === TILE.ELECTRIC_DOOR) {
            ctx.fillStyle = TILE_COLORS[TILE.FLOOR].fill;
            ctx.fillRect(innerX, innerY, innerS, innerS);
        }

        switch (tile) {
            case TILE.FLOOR:
                ctx.fillStyle = TILE_COLORS[TILE.FLOOR].fill;
                ctx.fillRect(innerX, innerY, innerS, innerS);
                ctx.fillStyle = '#2e2e52';
                ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, 1.5, 0, Math.PI * 2); ctx.fill();
                break;

            case TILE.WALL:
                this._renderGradientTile(ctx, innerX, innerY, innerS, TILE_COLORS[TILE.WALL]);
                break;

            case TILE.METAL_WALL:
                this._renderGradientTile(ctx, innerX, innerY, innerS, TILE_COLORS[TILE.METAL_WALL]);
                ctx.fillStyle = '#455A64';
                const br = Math.max(2, s * 0.08);
                ctx.beginPath(); ctx.arc(innerX + br*2, innerY + br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(innerX + innerS - br*2, innerY + br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(innerX + br*2, innerY + innerS - br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(innerX + innerS - br*2, innerY + innerS - br*2, br, 0, Math.PI * 2); ctx.fill();
                // Magnet symbol on metal wall
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.font = `${Math.floor(s * 0.4)}px sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('🧲', px + s / 2, py + s / 2);
                break;

            case TILE.RUBBER_WALL: {
                let scale = 1.0;
                const hitTime = this.rubberHitMap.get(`${gx},${gy},${gz}`);
                if (hitTime !== undefined) {
                    // Squash and stretch
                    const t = 1 - (hitTime / 0.4);
                    scale = 1.0 + Math.sin(t * Math.PI * 3) * 0.2 * Math.exp(-t * 3);
                }
                
                ctx.translate(innerX + innerS/2, innerY + innerS/2);
                ctx.scale(scale, scale);
                ctx.translate(-(innerX + innerS/2), -(innerY + innerS/2));
                
                this._renderGradientTile(ctx, innerX, innerY, innerS, TILE_COLORS[TILE.RUBBER_WALL]);
                ctx.fillStyle = 'rgba(121,85,72,0.5)';
                for (let i = 0; i < 5; i++) {
                    const dx = innerX + innerS * (0.2 + (i % 3) * 0.3);
                    const dy = innerY + innerS * (0.3 + Math.floor(i / 3) * 0.4);
                    ctx.beginPath(); ctx.arc(dx, dy, Math.max(1.5, s * 0.04), 0, Math.PI * 2); ctx.fill();
                }
                break;
            }

            case TILE.ITEM_MAGNET:
            case TILE.ITEM_ICE:
            case TILE.ITEM_ELECTRIC:
                this._renderItem(ctx, tile, px, py, s);
                break;

            case TILE.PORTAL:
                this._renderPortal(ctx, px, py, s);
                break;

            case TILE.ELECTRIC_DOOR:
                this._renderDoor(ctx, tile, innerX, innerY, innerS, px, py, s);
                break;
        }
        ctx.restore();
    }

    _renderGradientTile(ctx, x, y, s, colors) {
        const grad = ctx.createLinearGradient(x, y, x, y + s);
        grad.addColorStop(0, colors.gradient[0]);
        grad.addColorStop(1, colors.gradient[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    }

    _renderItem(ctx, tile, px, py, s) {
        const info = TILE_COLORS[tile];
        const cx = px + s / 2;
        const cy = py + s / 2 + Math.sin(this.time * 3) * 2; // hover effect

        ctx.shadowColor = info.color;
        ctx.shadowBlur = 10 + Math.sin(this.time * 5) * 5;
        ctx.fillStyle = info.color;
        
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.25, 0, Math.PI * 2);
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1.0;

        ctx.font = `${Math.floor(s * 0.35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info.icon, cx, cy);
        ctx.shadowBlur = 0;
    }

    _renderPortal(ctx, px, py, s) {
        const cx = px + s / 2;
        const cy = py + s / 2;
        const r = s * 0.35;
        ctx.shadowColor = '#E040FB';
        ctx.shadowBlur = 15 + Math.sin(this.time * 4) * 5;
        const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        grad.addColorStop(0, 'rgba(234,128,252,0.8)');
        grad.addColorStop(1, 'rgba(171,71,188,0.2)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }

    _renderDoor(ctx, tile, innerX, innerY, innerS, px, py, s) {
        const colors = TILE_COLORS[tile];
        this._renderGradientTile(ctx, innerX, innerY, innerS, colors);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2;
        for (let i = 1; i <= 3; i++) {
            const bx = innerX + (innerS / 4) * i;
            ctx.beginPath(); ctx.moveTo(bx, innerY + 3); ctx.lineTo(bx, innerY + innerS - 3); ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.floor(s * 0.3)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⚡', px + s / 2, py + s / 2);
    }
}
