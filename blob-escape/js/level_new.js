// ── Level Data Loading ──
// Level definitions live as individual JSON files under levels/,
// listed in levels/manifest.json. loadAllLevels() fetches them and
// fills LEVELS_DATA before the game boots.

const LEVELS_DATA = [];

async function loadAllLevels() {
    const manifestRes = await fetch('levels/manifest.json');
    const manifest = await manifestRes.json();

    const levels = await Promise.all(
        manifest.map(async (fname) => {
            const res = await fetch(`levels/${fname}`);
            return res.json();
        })
    );

    levels.sort((a, b) => a.id - b.id);
    LEVELS_DATA.push(...levels);
    return LEVELS_DATA;
}


class Level {
    constructor() {
        this.grid = [];
        this.width = 0;
        this.height = 0;
        this.playerStart = { x: 0, y: 0 };
        this.portalPos = { x: 0, y: 0 };
        this.consumedItems = new Set(); // Track consumed items by "x,y"
        this.openedDoors = new Set();
        this.levelData = null;
        this.tileSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.time = 0;
        
        // Effects state
        this.rubberHitMap = new Map(); // "x,y" -> timer
    }

    load(levelIndex) {
        const data = LEVELS_DATA[levelIndex];
        if (!data) return false;

        this.levelData = data;
        this.consumedItems = new Set();
        this.openedDoors = new Set();
        this.rubberHitMap.clear();
        this.height = data.map.length;
        // Find the max width across all rows
        this.width = 0;
        for (let row of data.map) {
            if (row.length > this.width) this.width = row.length;
        }
        this.grid = [];

        for (let y = 0; y < this.height; y++) {
            const row = [];
            for (let x = 0; x < this.width; x++) {
                const ch = x < data.map[y].length ? data.map[y][x] : ' ';
                const tile = CHAR_TO_TILE[ch] !== undefined ? CHAR_TO_TILE[ch] : TILE.FLOOR;
                row.push(tile);

                if (ch === 'P') this.playerStart = { x, y };
                if (ch === 'X') this.portalPos = { x, y };
            }
            this.grid.push(row);
        }
        return true;
    }

    calculateLayout(canvasWidth, canvasHeight) {
        const hudHeight = 70;
        const padding = 15;
        const availW = canvasWidth - padding * 2;
        const availH = canvasHeight - hudHeight - padding * 2;
        this.tileSize = Math.floor(Math.min(availW / this.width, availH / this.height));
        this.offsetX = Math.floor((canvasWidth - this.tileSize * this.width) / 2);
        this.offsetY = hudHeight + Math.floor((canvasHeight - hudHeight - this.tileSize * this.height) / 2);
    }

    getTile(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return TILE.WALL;
        if (this.openedDoors.has(`${x},${y}`)) return TILE.FLOOR;
        if (this.consumedItems.has(`${x},${y}`)) return TILE.FLOOR;
        return this.grid[y][x];
    }

    consumeItem(x, y) {
        this.consumedItems.add(`${x},${y}`);
    }

    openDoor(x, y) {
        this.openedDoors.add(`${x},${y}`);
    }

    triggerRubberBounce(x, y) {
        this.rubberHitMap.set(`${x},${y}`, 0.4); // 0.4s animation
    }

    gridToPixel(gx, gy) {
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

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = this.getTile(x, y);
                const px = this.offsetX + x * this.tileSize;
                const py = this.offsetY + y * this.tileSize;
                this._renderTile(ctx, tile, px, py, this.tileSize, x, y);
            }
        }
    }

    _renderTile(ctx, tile, px, py, s, gx, gy) {
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
                const hitTime = this.rubberHitMap.get(`${gx},${gy}`);
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
