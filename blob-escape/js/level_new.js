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
        this.extinguishedFire = new Set(); // Track fire tiles that were extinguished by ice
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

        // [MODIFIED] 설정에서 켜고 끄는 화면 대칭(미러) 상태 -- 사용자 취향이라 load()에서 리셋하지 않음.
        // z: X-Y 뷰(h=X축 반전, v=Y축 반전), x: Z-Y 뷰(h=Z축 반전, v=Y축 반전)
        this.mirror = {
            z: { h: false, v: false },
            x: { h: false, v: false },
        };

        // Effects state
        this.rubberHitMap = new Map(); // "x,y,z" -> timer
    }

    load(levelIndex) {
        const data = LEVELS_DATA[levelIndex];
        if (!data) return false;

        this.levelData = data;
        this.consumedItems = new Set();
        this.extinguishedFire = new Set();
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

    // Shift the current view's fixed slice by delta (+1/-1), clamped to valid range.
    shiftView(delta) {
        if (this.viewAxis === 'x') {
            this.viewX = Math.max(0, Math.min(this.width - 1, this.viewX + delta));
        } else {
            this.viewZ = Math.max(0, Math.min(this.depth - 1, this.viewZ + delta));
        }
    }

    // [MODIFIED] Q/E 트랜지션을 시작하기 전에 실제로 슬라이스가 바뀔지(경계 클램프로 no-op이 아닌지) 확인
    canShiftView(delta) {
        if (this.viewAxis === 'x') {
            const next = Math.max(0, Math.min(this.width - 1, this.viewX + delta));
            return next !== this.viewX;
        }
        const next = Math.max(0, Math.min(this.depth - 1, this.viewZ + delta));
        return next !== this.viewZ;
    }

    // Dimensions of the currently visible 2D plane, in (col, row) terms.
    // The X-view (Z-Y plane) is rendered rotated 90° clockwise from its
    // natural Z-Y layout, so cols/rows swap to depth/height.
    getViewDimensions() {
        if (this.viewAxis === 'x') return { cols: this.depth, rows: this.height };
        return { cols: this.width, rows: this.height };
    }

    // Map a point on the current 2D plane (col, row) to full 3D grid coords.
    // X-view is rotated 90° CW from its natural (col=y, row=z) layout:
    // screen-right is -Z (Z decreases rightward), screen-down is +Y.
    // [MODIFIED] mirror.h/v flips screen col/row BEFORE the rotation mapping below,
    // so the h/v flip always means "left-right"/"up-down" on screen regardless of view.
    viewToGrid(col, row) {
        const { cols, rows } = this.getViewDimensions();
        const mirror = this.mirror[this.viewAxis];
        const c = mirror.h ? (cols - 1 - col) : col;
        const r = mirror.v ? (rows - 1 - row) : row;
        if (this.viewAxis === 'x') return { x: this.viewX, y: r, z: this.depth - 1 - c };
        return { x: c, y: r, z: this.viewZ };
    }

    // Inverse of viewToGrid: map full 3D grid coords to the current 2D plane (col, row).
    // Returns null if (x,y,z) isn't on the plane currently being viewed.
    // x/y/z may be fractional (mid-animation); only the axis that is fixed for
    // the current view is checked against the view's slice (rounded), so
    // movement animations along the two free axes stay smooth.
    gridToView(x, y, z) {
        const { cols, rows } = this.getViewDimensions();
        const mirror = this.mirror[this.viewAxis];
        let col, row;
        if (this.viewAxis === 'x') {
            if (Math.round(x) !== this.viewX) return null;
            col = this.depth - 1 - z;
            row = y;
        } else {
            if (Math.round(z) !== this.viewZ) return null;
            col = x;
            row = y;
        }
        if (mirror.h) col = cols - 1 - col;
        if (mirror.v) row = rows - 1 - row;
        return { col, row };
    }

    // Convenience: grid coords -> pixel position on the current view, or null
    // if those coords aren't on the visible plane (e.g. wrong Z layer / X column).
    gridToPixelIfVisible(x, y, z) {
        const v = this.gridToView(x, y, z);
        if (!v) return null;
        return this.gridToPixel(v.col, v.row);
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
        if (this.extinguishedFire.has(key)) return TILE.WALL;
        if (this.consumedItems.has(key)) return TILE.FLOOR;
        return this.grid[z][y][x];
    }

    // [MODIFIED] 이 바닥(TILE.FLOOR) 또는 아이템 칸 위에서, E로 가는 다음 슬라이스의 같은 자리가 지나다닐 수
    // 있는 곳(바닥/포탈/아이템 -- 벽은 절대 아님)이면 계속 이어지는 샤프트로 보고, 바닥 타일(또는 아이템 밑
    // 바닥 백드롭)을 그리지 않아 게임 배경이 비쳐 보이게 함. 벽 타일은 이 규칙 대상이 아니라 항상 그대로 렌더링됨.
    // E가 바꾸는 축은 현재 뷰에 따라 다름(X-Y 뷰는 viewZ, Z-Y 뷰는 viewX) -- viewAxis 기준으로 맞춰서 다음 칸을 계산.
    // 게임플레이(이동/충돌)는 그대로 원래 타일로 취급되므로 영향 없음, 순수 렌더링 판단용.
    isOpenShaftCell(x, y, z) {
        const tile = this.getTile(x, y, z);
        if (tile !== TILE.FLOOR && !isItem(tile)) return false;

        let nextTile;
        if (this.viewAxis === 'x') {
            const nextX = x + 1;
            if (nextX >= this.width) return false;
            nextTile = this.getTile(nextX, y, z);
        } else {
            const nextZ = z + 1;
            if (nextZ >= this.depth) return false;
            nextTile = this.getTile(x, y, nextZ);
        }
        return nextTile === TILE.FLOOR || nextTile === TILE.PORTAL || isItem(nextTile);
    }

    consumeItem(x, y, z = this.viewZ) {
        this.consumedItems.add(`${x},${y},${z}`);
    }

    openDoor(x, y, z = this.viewZ) {
        this.openedDoors.add(`${x},${y},${z}`);
    }

    extinguishFire(x, y, z = this.viewZ) {
        this.extinguishedFire.add(`${x},${y},${z}`);
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
        this.renderBackground(ctx, canvasWidth, canvasHeight);
        this.renderBoard(ctx);
    }

    // [MODIFIED] Q/E·Tab 뷰 트랜지션이 배경(실험실 홀로그램 그라디언트+격자)은 건드리지 않고
    // 보드(패널+타일)만 확대/축소·플립하도록 배경과 보드 렌더를 분리.
    // 맵이 공중에 떠 있는 실험실 홀로그램 보드처럼 보이도록 배경·프레임·깊이감을 추가한 부분은 이 안에 유지.
    renderBackground(ctx, canvasWidth, canvasHeight) {
        const background = ctx.createRadialGradient(
            canvasWidth * 0.48, canvasHeight * 0.42, 0,
            canvasWidth * 0.48, canvasHeight * 0.42, Math.max(canvasWidth, canvasHeight) * 0.72
        );
        background.addColorStop(0, '#0E1B31');
        background.addColorStop(0.58, '#080F20');
        background.addColorStop(1, '#040711');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        ctx.save();
        ctx.strokeStyle = 'rgba(73, 123, 158, 0.055)';
        ctx.lineWidth = 1;
        const ambientGrid = Math.max(24, Math.round(this.tileSize * 0.85));
        for (let x = (this.offsetX % ambientGrid); x < canvasWidth; x += ambientGrid) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); ctx.stroke();
        }
        for (let y = (this.offsetY % ambientGrid); y < canvasHeight; y += ambientGrid) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
        }
        ctx.restore();
    }

    // Board panel (glow frame) + the actual tile grid -- this is the part that
    // Q/E and Tab transitions scale/flip, so it must not draw the full-canvas background.
    renderBoard(ctx) {
        const { cols, rows } = this.getViewDimensions();
        const boardW = cols * this.tileSize;
        const boardH = rows * this.tileSize;

        ctx.save();
        ctx.shadowColor = 'rgba(66, 201, 255, 0.18)';
        ctx.shadowBlur = 28;
        ctx.fillStyle = 'rgba(5, 11, 24, 0.92)';
        ctx.fillRect(this.offsetX - 10, this.offsetY - 10, boardW + 20, boardH + 20);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(118, 185, 213, 0.2)';
        ctx.strokeRect(this.offsetX - 9.5, this.offsetY - 9.5, boardW + 19, boardH + 19);
        ctx.restore();

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
        // [MODIFIED] 이 바닥 칸과 다음 슬라이스(E 방향)의 같은 자리가 지나다닐 수 있는 곳(바닥/포탈/아이템)이면
        // 위아래로 이어지는 샤프트로 보고 타일을 그리지 않아 게임 배경이 비쳐 보이게 함. 벽 타일은 항상 그대로 렌더링.
        if (tile === TILE.FLOOR && this.isOpenShaftCell(gx, gy, gz)) return;
        // 아이템도 같은 샤프트 조건이면 아이콘은 그대로 그리되 밑에 깔리는 바닥 백드롭만 빼서 배경이 비치게 함.
        const skipItemBackdrop = isItem(tile) && this.isOpenShaftCell(gx, gy, gz);

        const gap = 1;
        const innerX = px + gap;
        const innerY = py + gap;
        const innerS = s - gap * 2;

        ctx.save();

        // Base floor for items and doors
        if ((isItem(tile) && !skipItemBackdrop) || tile === TILE.PORTAL || tile === TILE.ELECTRIC_DOOR) {
            ctx.fillStyle = TILE_COLORS[TILE.FLOOR].fill;
            ctx.fillRect(innerX, innerY, innerS, innerS);
        }

        switch (tile) {
            case TILE.FLOOR:
                // [MODIFIED] 단색 바닥 대신 패널 이음새와 회로 노드를 넣어 연구시설 재질을 표현
                ctx.fillStyle = TILE_COLORS[TILE.FLOOR].fill;
                ctx.fillRect(innerX, innerY, innerS, innerS);
                ctx.strokeStyle = 'rgba(68, 111, 153, 0.17)';
                ctx.lineWidth = Math.max(0.5, s * 0.018);
                ctx.strokeRect(innerX + 0.5, innerY + 0.5, innerS - 1, innerS - 1);
                if (s >= 18) {
                    const circuitSeed = (gx * 17 + gy * 11 + gz * 7) % 4;
                    ctx.strokeStyle = 'rgba(85, 155, 179, 0.13)';
                    ctx.beginPath();
                    ctx.moveTo(innerX + innerS * 0.18, innerY + innerS * (0.25 + circuitSeed * 0.12));
                    ctx.lineTo(innerX + innerS * 0.46, innerY + innerS * (0.25 + circuitSeed * 0.12));
                    ctx.lineTo(innerX + innerS * 0.61, innerY + innerS * 0.5);
                    ctx.lineTo(innerX + innerS * 0.82, innerY + innerS * 0.5);
                    ctx.stroke();
                    ctx.fillStyle = 'rgba(120, 255, 214, 0.2)';
                    ctx.beginPath(); ctx.arc(innerX + innerS * 0.82, innerY + innerS * 0.5, Math.max(0.7, s * 0.018), 0, Math.PI * 2); ctx.fill();
                }
                break;

            case TILE.WALL:
                this._renderGradientTile(ctx, innerX, innerY, innerS, TILE_COLORS[TILE.WALL]);
                ctx.strokeStyle = 'rgba(157, 188, 218, 0.1)';
                ctx.lineWidth = Math.max(1, s * 0.035);
                ctx.strokeRect(innerX + innerS * 0.16, innerY + innerS * 0.16, innerS * 0.68, innerS * 0.68);
                break;

            case TILE.METAL_WALL:
                // [MODIFIED] 이모지 대신 볼트·합금 패널·시안 자기장 스트립으로 금속 벽의 기능을 시각화
                this._renderGradientTile(ctx, innerX, innerY, innerS, TILE_COLORS[TILE.METAL_WALL]);
                ctx.fillStyle = '#173348';
                const br = Math.max(2, s * 0.08);
                ctx.beginPath(); ctx.arc(innerX + br*2, innerY + br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(innerX + innerS - br*2, innerY + br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(innerX + br*2, innerY + innerS - br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(innerX + innerS - br*2, innerY + innerS - br*2, br, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = 'rgba(168, 238, 255, 0.46)';
                ctx.lineWidth = Math.max(1, s * 0.055);
                ctx.beginPath();
                ctx.moveTo(innerX + innerS * 0.26, innerY + innerS * 0.72);
                ctx.lineTo(innerX + innerS * 0.74, innerY + innerS * 0.28);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(66, 201, 255, 0.2)';
                ctx.lineWidth = Math.max(1, s * 0.025);
                ctx.beginPath();
                ctx.moveTo(innerX + innerS * 0.18, innerY + innerS * 0.58);
                ctx.lineTo(innerX + innerS * 0.58, innerY + innerS * 0.18);
                ctx.moveTo(innerX + innerS * 0.42, innerY + innerS * 0.82);
                ctx.lineTo(innerX + innerS * 0.82, innerY + innerS * 0.42);
                ctx.stroke();
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
                ctx.strokeStyle = 'rgba(255, 175, 181, 0.26)';
                ctx.lineWidth = Math.max(1, s * 0.04);
                ctx.strokeRect(innerX + innerS * 0.14, innerY + innerS * 0.14, innerS * 0.72, innerS * 0.72);
                ctx.fillStyle = 'rgba(255, 190, 194, 0.26)';
                for (let i = 0; i < 4; i++) {
                    const dx = innerX + innerS * (i % 2 === 0 ? 0.28 : 0.72);
                    const dy = innerY + innerS * (i < 2 ? 0.28 : 0.72);
                    ctx.beginPath(); ctx.arc(dx, dy, Math.max(1.2, s * 0.035), 0, Math.PI * 2); ctx.fill();
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

            case TILE.FIRE:
                this._renderGradientTile(ctx, innerX, innerY, innerS, TILE_COLORS[TILE.FIRE]);
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.beginPath();
                ctx.arc(px + s / 2, py + s / 2, Math.max(2, s * 0.18), 0, Math.PI * 2);
                ctx.fill();
                break;
        }
        ctx.restore();
    }

    _renderGradientTile(ctx, x, y, s, colors) {
        // [MODIFIED] 벽 재질에 외곽 그림자와 상단 림라이트를 더해 타일 높이를 명확하게 분리
        ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
        ctx.fillRect(x + Math.max(1, s * 0.06), y + Math.max(1, s * 0.08), s, s);
        const grad = ctx.createLinearGradient(x, y, x, y + s);
        grad.addColorStop(0, colors.gradient[0]);
        grad.addColorStop(1, colors.gradient[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.fillRect(x + 1, y + 1, s - 2, Math.max(1, s * 0.055));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.fillRect(x + 1, y + s - Math.max(2, s * 0.08), s - 2, Math.max(1, s * 0.06));
    }

    _renderItem(ctx, tile, px, py, s) {
        // [MODIFIED] 플랫폼별 모양이 달라지는 이모지를 제거하고 세 능력에 고유한 벡터 실루엣을 부여
        const info = TILE_COLORS[tile];
        const cx = px + s / 2;
        const cy = py + s / 2 + Math.sin(this.time * 3 + px * 0.01) * Math.max(1, s * 0.045);
        const r = s * 0.26;

        ctx.shadowColor = info.color;
        ctx.shadowBlur = 12 + Math.sin(this.time * 5) * 4;
        const core = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
        core.addColorStop(0, 'rgba(255,255,255,0.95)');
        core.addColorStop(0.18, info.color);
        core.addColorStop(1, 'rgba(8,17,34,0.94)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.time * 0.45);
        ctx.strokeStyle = `rgba(255,255,255,${0.18 + Math.sin(this.time * 2) * 0.05})`;
        ctx.lineWidth = Math.max(0.7, s * 0.018);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.42, r * 0.48, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (tile === TILE.ITEM_MAGNET) {
            ctx.strokeStyle = '#D9F7FF';
            ctx.lineWidth = Math.max(2.2, s * 0.09);
            ctx.beginPath();
            ctx.moveTo(-r * 0.48, -r * 0.38);
            ctx.lineTo(-r * 0.48, r * 0.12);
            ctx.arc(0, r * 0.08, r * 0.48, Math.PI, 0, true);
            ctx.lineTo(r * 0.48, -r * 0.38);
            ctx.stroke();
            ctx.strokeStyle = info.accent;
            ctx.lineWidth = Math.max(2.5, s * 0.1);
            ctx.beginPath();
            ctx.moveTo(-r * 0.48, -r * 0.42); ctx.lineTo(-r * 0.48, -r * 0.14);
            ctx.moveTo(r * 0.48, -r * 0.42); ctx.lineTo(r * 0.48, -r * 0.14);
            ctx.stroke();
        } else if (tile === TILE.ITEM_ICE) {
            ctx.strokeStyle = '#F4FDFF';
            ctx.lineWidth = Math.max(1.2, s * 0.045);
            for (let i = 0; i < 3; i++) {
                ctx.rotate(Math.PI / 3);
                ctx.beginPath(); ctx.moveTo(-r * 0.58, 0); ctx.lineTo(r * 0.58, 0); ctx.stroke();
            }
            ctx.fillStyle = info.accent;
            ctx.beginPath(); ctx.arc(0, 0, Math.max(1.4, s * 0.045), 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.fillStyle = '#FFF9D6';
            ctx.beginPath();
            ctx.moveTo(r * 0.12, -r * 0.68);
            ctx.lineTo(-r * 0.46, r * 0.06);
            ctx.lineTo(-r * 0.02, r * 0.02);
            ctx.lineTo(-r * 0.18, r * 0.7);
            ctx.lineTo(r * 0.5, -r * 0.12);
            ctx.lineTo(r * 0.08, -r * 0.06);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        ctx.shadowBlur = 0;
    }

    _renderPortal(ctx, px, py, s) {
        // [MODIFIED] 포탈을 다중 회전 링과 깊은 코어로 구성해 목표 지점의 존재감을 강화
        const cx = px + s / 2;
        const cy = py + s / 2;
        const r = s * 0.35;
        ctx.shadowColor = TILE_COLORS[TILE.PORTAL].glow;
        ctx.shadowBlur = 18 + Math.sin(this.time * 4) * 5;
        const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        grad.addColorStop(0, 'rgba(4,7,18,0.95)');
        grad.addColorStop(0.42, 'rgba(93,36,165,0.88)');
        grad.addColorStop(0.75, 'rgba(199,101,255,0.72)');
        grad.addColorStop(1, 'rgba(228,168,255,0.08)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.time * 0.9);
        ctx.strokeStyle = 'rgba(238, 202, 255, 0.78)';
        ctx.lineWidth = Math.max(1, s * 0.035);
        ctx.setLineDash([Math.max(2, s * 0.12), Math.max(2, s * 0.07)]);
        ctx.beginPath(); ctx.arc(0, 0, r * 0.83, 0, Math.PI * 2); ctx.stroke();
        ctx.rotate(-this.time * 1.8);
        ctx.strokeStyle = 'rgba(120, 255, 214, 0.45)';
        ctx.setLineDash([Math.max(1, s * 0.05), Math.max(2, s * 0.12)]);
        ctx.beginPath(); ctx.arc(0, 0, r * 0.54, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }

    _renderDoor(ctx, tile, innerX, innerY, innerS, px, py, s) {
        // [MODIFIED] 전기문을 단순 노란 격자에서 전력 봉인 장치로 재설계해 통과 조건을 명확하게 전달
        const colors = TILE_COLORS[tile];
        this._renderGradientTile(ctx, innerX, innerY, innerS, colors);
        ctx.shadowColor = colors.stroke;
        ctx.shadowBlur = Math.max(4, s * 0.14);
        ctx.strokeStyle = 'rgba(255, 230, 139, 0.92)';
        ctx.lineWidth = Math.max(1.2, s * 0.045);
        for (let i = 1; i <= 3; i++) {
            const bx = innerX + (innerS / 4) * i;
            const wave = Math.sin(this.time * 7 + i) * s * 0.035;
            ctx.beginPath();
            ctx.moveTo(bx, innerY + 3);
            ctx.lineTo(bx + wave, innerY + innerS * 0.38);
            ctx.lineTo(bx - wave, innerY + innerS * 0.62);
            ctx.lineTo(bx, innerY + innerS - 3);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFF6C9';
        ctx.beginPath();
        ctx.moveTo(px + s * 0.54, py + s * 0.25);
        ctx.lineTo(px + s * 0.38, py + s * 0.52);
        ctx.lineTo(px + s * 0.51, py + s * 0.49);
        ctx.lineTo(px + s * 0.45, py + s * 0.75);
        ctx.lineTo(px + s * 0.64, py + s * 0.44);
        ctx.lineTo(px + s * 0.51, py + s * 0.47);
        ctx.closePath();
        ctx.fill();
    }
}
