// Sidebar map orientation and true-ratio top-view minimap.

class SidebarMapUI {
    constructor() {
        this.orientationCanvas = document.getElementById('map-orientation');
        this.minimapCanvas = document.getElementById('topview-minimap');
        this.minimapViewport = document.getElementById('minimap-viewport');
        this.viewLabel = document.getElementById('view-label');
        this.viewDetail = document.getElementById('view-detail');
        this.ratioLabel = document.getElementById('minimap-ratio');
        this.lastOrientationKey = '';
        this.lastMinimapKey = '';
        this.lastTextKey = '';
    }

    resize() {
        this.lastOrientationKey = '';
        this.lastMinimapKey = '';
        this.lastTextKey = '';
    }

    // [MODIFIED] viewToggleEnabled: false인 레벨은 game.js가 이 카드들을 아예 호출하지 않고(콘텐츠
    // DOM을 안내 문구로 교체) 대체하므로, 이 클래스는 그 판단을 신경 쓰지 않고 항상 정상 렌더링만 함.
    render(level, player, force = false) {
        if (!level || !level.levelData || !this.orientationCanvas || !this.minimapCanvas) return;

        const pulseFrame = Math.floor(performance.now() / 120);
        const orientationKey = [
            level.levelData.id,
            level.width, level.height, level.depth,
            level.viewAxis, level.viewX, level.viewZ,
            this.orientationCanvas.clientWidth, this.orientationCanvas.clientHeight,
        ].join('|');
        const minimapKey = [
            orientationKey,
            player.visualX.toFixed(3), player.visualZ.toFixed(3),
            player.moveStartX, player.moveStartZ, player.moveEndX, player.moveEndZ,
            this.minimapViewport.clientWidth, this.minimapViewport.clientHeight,
            pulseFrame,
        ].join('|');
        const textKey = [level.levelData.id, level.viewAxis, level.viewX, level.viewZ].join('|');

        // [MODIFIED] Each sidebar section now redraws only when its own inputs change.
        if (force || orientationKey !== this.lastOrientationKey) {
            this.lastOrientationKey = orientationKey;
            this._drawOrientation(level);
        }
        if (force || minimapKey !== this.lastMinimapKey) {
            this.lastMinimapKey = minimapKey;
            this._drawMinimap(level, player);
        }
        if (force || textKey !== this.lastTextKey) {
            this.lastTextKey = textKey;
            this._updateText(level);
        }
    }

    _prepareCanvas(canvas, cssWidth, cssHeight) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(cssWidth));
        const height = Math.max(1, Math.round(cssHeight));
        const pixelWidth = Math.max(1, Math.round(width * dpr));
        const pixelHeight = Math.max(1, Math.round(height * dpr));

        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        return { ctx, width, height };
    }

    _drawOrientation(level) {
        const canvas = this.orientationCanvas;
        const { ctx, width, height } = this._prepareCanvas(
            canvas,
            canvas.clientWidth || 180,
            canvas.clientHeight || 142
        );

        // [MODIFIED] 방향도를 단순 와이어 박스에서 실험실 홀로그램 계측 화면으로 시각적으로 통일
        const screenGlow = ctx.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.46, width * 0.62);
        screenGlow.addColorStop(0, 'rgba(66, 201, 255, 0.075)');
        screenGlow.addColorStop(1, 'rgba(4, 9, 20, 0)');
        ctx.fillStyle = screenGlow;
        ctx.fillRect(0, 0, width, height);

        const mapW = Math.max(1, level.width);
        const mapH = Math.max(1, level.height);
        const mapD = Math.max(1, level.depth);
        const padding = 17;
        const zSkewX = 0.58;
        const zSkewY = 0.34;
        const unit = Math.min(
            (width - padding * 2) / (mapW + mapD * zSkewX),
            (height - padding * 2) / (mapH + mapD * zSkewY)
        );

        const projectedW = (mapW + mapD * zSkewX) * unit;
        const projectedH = (mapH + mapD * zSkewY) * unit;
        const origin = {
            x: (width - projectedW) / 2 + mapD * zSkewX * unit,
            y: (height + projectedH) / 2,
        };
        const vx = { x: mapW * unit, y: 0 };
        const vy = { x: 0, y: -mapH * unit };
        const vz = { x: -mapD * zSkewX * unit, y: -mapD * zSkewY * unit };

        const add = (...points) => points.reduce((sum, point) => ({
            x: sum.x + point.x,
            y: sum.y + point.y,
        }), { x: 0, y: 0 });
        const scale = (vector, amount) => ({ x: vector.x * amount, y: vector.y * amount });

        const a = origin;
        const b = add(origin, vx);
        const c = add(origin, vx, vy);
        const d = add(origin, vy);
        const a2 = add(a, vz);
        const b2 = add(b, vz);
        const c2 = add(c, vz);
        const d2 = add(d, vz);

        this._polygon(ctx, [a2, b2, c2, d2], 'rgba(19, 42, 65, 0.46)', 'rgba(100, 168, 201, 0.24)');
        this._polygon(ctx, [a, d, d2, a2], 'rgba(15, 32, 53, 0.8)', 'rgba(102, 178, 207, 0.34)');
        this._polygon(ctx, [d, c, c2, d2], 'rgba(31, 59, 79, 0.58)', 'rgba(136, 204, 224, 0.38)');
        this._polygon(ctx, [a, b, c, d], 'rgba(9, 23, 43, 0.76)', 'rgba(146, 211, 224, 0.42)');

        let slice;
        if (level.viewAxis === 'z') {
            const t = (level.viewZ + 0.5) / mapD;
            const shift = scale(vz, t);
            slice = [add(a, shift), add(b, shift), add(c, shift), add(d, shift)];
        } else {
            const t = (level.viewX + 0.5) / mapW;
            const shift = scale(vx, t);
            slice = [add(a, shift), add(d, shift), add(d2, shift), add(a2, shift)];
        }

        ctx.save();
        ctx.shadowColor = '#78FFD6';
        ctx.shadowBlur = 13;
        this._polygon(ctx, slice, 'rgba(120, 255, 214, 0.17)', '#78FFD6', 1.6);
        ctx.restore();

        ctx.fillStyle = '#718CA8';
        ctx.font = '7px "Orbitron", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(`X ${mapW}`, b.x - 22, b.y + 8);
        ctx.fillText(`Y ${mapH}`, d.x - 3, d.y - 7);
        ctx.fillText(`Z ${mapD}`, a2.x - 1, a2.y + 8);

        canvas.setAttribute(
            'aria-label',
            `${level.viewAxis === 'z' ? '정면' : '측면'} 시점, ` +
            `맵 크기 X ${mapW}, Y ${mapH}, Z ${mapD}`
        );
    }

    _drawMinimap(level, player) {
        // [MODIFIED] 미니맵 색 체계를 본 화면의 재질·목표·플레이어 광원과 맞춰 동일한 세계관으로 연결
        const viewportWidth = Math.max(1, (this.minimapViewport.clientWidth || 190) - 18);
        const viewportHeight = Math.max(1, (this.minimapViewport.clientHeight || 164) - 18);
        const ratio = level.width / Math.max(1, level.depth);

        let cssWidth = viewportWidth;
        let cssHeight = cssWidth / ratio;
        if (cssHeight > viewportHeight) {
            cssHeight = viewportHeight;
            cssWidth = cssHeight * ratio;
        }

        cssWidth = Math.max(1, cssWidth);
        cssHeight = Math.max(1, cssHeight);
        const widthStyle = `${cssWidth}px`;
        const heightStyle = `${cssHeight}px`;
        if (this.minimapCanvas.style.width !== widthStyle) this.minimapCanvas.style.width = widthStyle;
        if (this.minimapCanvas.style.height !== heightStyle) this.minimapCanvas.style.height = heightStyle;

        const { ctx, width, height } = this._prepareCanvas(this.minimapCanvas, cssWidth, cssHeight);
        const cellW = width / level.width;
        const cellH = height / level.depth;
        // [MODIFIED] 탑뷰 미니맵 상하 반전 -- z=0 층이 아래쪽에 오도록 세로 위치를 뒤집어서 그림
        const flipZTop = (z) => (level.depth - 1 - z) * cellH;

        ctx.fillStyle = '#081225';
        ctx.fillRect(0, 0, width, height);

        // [MODIFIED] 벽/통로 색구분(칸별 hasWalkable/hasWall 스캔) 제거 -- 공간 구조 노출 없이
        // 단일 타일 색으로만 채우고, 위치 정보는 아래 슬라이스 하이라이트/목표/플레이어 마커로만 표시
        ctx.fillStyle = 'rgba(24, 39, 65, 0.7)';
        for (let z = 0; z < level.depth; z++) {
            for (let x = 0; x < level.width; x++) {
                ctx.fillRect(x * cellW, flipZTop(z), Math.ceil(cellW), Math.ceil(cellH));
            }
        }

        if (level.viewAxis === 'z') {
            ctx.fillStyle = 'rgba(120, 255, 214, 0.14)';
            ctx.fillRect(0, flipZTop(level.viewZ), width, cellH);
            ctx.strokeStyle = 'rgba(120, 255, 214, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, flipZTop(level.viewZ) + 0.5, width - 1, Math.max(1, cellH - 1));
        } else {
            ctx.fillStyle = 'rgba(120, 255, 214, 0.14)';
            ctx.fillRect(level.viewX * cellW, 0, cellW, height);
            ctx.strokeStyle = 'rgba(120, 255, 214, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(level.viewX * cellW + 0.5, 0.5, Math.max(1, cellW - 1), height - 1);
        }

        if (cellW >= 8 && cellH >= 8) {
            ctx.strokeStyle = 'rgba(117, 133, 174, 0.15)';
            ctx.lineWidth = 0.5;
            for (let x = 1; x < level.width; x++) {
                ctx.beginPath();
                ctx.moveTo(x * cellW, 0);
                ctx.lineTo(x * cellW, height);
                ctx.stroke();
            }
            for (let z = 1; z < level.depth; z++) {
                ctx.beginPath();
                ctx.moveTo(0, z * cellH);
                ctx.lineTo(width, z * cellH);
                ctx.stroke();
            }
        }

        const goalX = (level.portalPos.x + 0.5) * cellW;
        const goalZ = (level.depth - (level.portalPos.z + 0.5)) * cellH;
        const markerSize = Math.max(3, Math.min(8, Math.min(cellW, cellH) * 0.34));
        const pulse = 0.75 + Math.sin(performance.now() / 220) * 0.22;

        ctx.save();
        ctx.strokeStyle = `rgba(191, 92, 255, ${pulse})`;
        ctx.lineWidth = Math.max(1, markerSize * 0.22);
        ctx.shadowColor = '#BF5CFF';
        ctx.shadowBlur = markerSize;
        ctx.beginPath();
        ctx.arc(goalX, goalZ, markerSize, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(goalX, goalZ, Math.max(1.2, markerSize * 0.28), 0, Math.PI * 2);
        ctx.fillStyle = '#EBC5FF';
        ctx.fill();
        ctx.restore();

        const playerX = (player.visualX + 0.5) * cellW;
        const playerZ = (level.depth - (player.visualZ + 0.5)) * cellH;
        const facingX = player.moveEndX - player.moveStartX;
        const facingZ = -(player.moveEndZ - player.moveStartZ); // flipped to match the flipped Z axis above
        const angle = facingX === 0 && facingZ === 0 ? 0 : Math.atan2(facingZ, facingX);
        const arrowSize = Math.max(3.5, Math.min(9, Math.min(cellW, cellH) * 0.42));

        ctx.save();
        ctx.translate(playerX, playerZ);
        ctx.rotate(angle);
        ctx.fillStyle = '#78FFD6';
        ctx.shadowColor = '#78FFD6';
        ctx.shadowBlur = arrowSize;
        ctx.beginPath();
        ctx.moveTo(arrowSize, 0);
        ctx.lineTo(-arrowSize * 0.7, arrowSize * 0.62);
        ctx.lineTo(-arrowSize * 0.36, 0);
        ctx.lineTo(-arrowSize * 0.7, -arrowSize * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        const ariaLabel =
            `실제 X 대 Z 비율 ${level.width} 대 ${level.depth}, ` +
            `플레이어 X ${player.gridX + 1}, Z ${player.gridZ + 1}, ` +
            `목표 X ${level.portalPos.x + 1}, Z ${level.portalPos.z + 1}`;
        if (this.minimapCanvas.getAttribute('aria-label') !== ariaLabel) {
            this.minimapCanvas.setAttribute('aria-label', ariaLabel);
        }
    }

    _updateText(level) {
        const isFront = level.viewAxis === 'z';
        const current = isFront ? level.viewZ + 1 : level.viewX + 1;
        const total = isFront ? level.depth : level.width;
        const axis = isFront ? 'Z' : 'X';
        const divisor = this._gcd(level.width, level.depth);

        this.viewLabel.textContent = isFront ? '정면 (X-Y)' : '측면 (Z-Y)';
        this.viewDetail.textContent = `${axis} 슬라이스 ${current} / ${total} · Q / E로 이동`;
        this.ratioLabel.textContent =
            `실제 크기 ${level.width} × ${level.depth} · X:Z = ` +
            `${level.width / divisor}:${level.depth / divisor}`;
    }

    _polygon(ctx, points, fill, stroke, lineWidth = 1) {
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }

    _gcd(a, b) {
        let x = Math.abs(a);
        let y = Math.abs(b);
        while (y) [x, y] = [y, x % y];
        return x || 1;
    }
}
