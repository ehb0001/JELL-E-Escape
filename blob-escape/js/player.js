// ── Player (JELL-E) ──
// Handles player state, movement physics, animation, and rendering

class Player {
    constructor() {
        this.gridX = 0;
        this.gridY = 0;
        this.gridZ = 0;
        this.visualX = 0;
        this.visualY = 0;
        this.visualZ = 0;
        this.state = STATE.NORMAL;
        this.prevState = STATE.NORMAL;
        this.moveCount = 0;

        // Animation
        this.isMoving = false;
        this.moveStartX = 0;
        this.moveStartY = 0;
        this.moveStartZ = 0;
        this.moveEndX = 0;
        this.moveEndY = 0;
        this.moveEndZ = 0;
        this.moveProgress = 0;
        this.moveSpeed = 5.0; // Tiles per second effective speed -> duration based on distance
        this.moveDuration = 0;
        this.moveDirection = 'right';
        this.onMoveComplete = null;

        // Visual
        this.wobbleTime = 0;
        this.squishX = 1;
        this.squishY = 1;
        this.eyeTargetX = 0;
        this.eyeTargetY = 0;
        this.stateChangeTimer = 0;
        this.colorTransition = 0;
        this.prevColor = '#69F0AE';
        this.currentColor = '#69F0AE';
    }

    reset(startX, startY, startZ = 0) {
        this.gridX = startX;
        this.gridY = startY;
        this.gridZ = startZ;
        this.visualX = startX;
        this.visualY = startY;
        this.visualZ = startZ;
        // [MODIFIED] 미니맵 방향 화살표가 레벨 재시작 뒤 이전 레벨 이동 방향을 재사용하지 않도록 초기화
        this.moveStartX = startX;
        this.moveStartY = startY;
        this.moveStartZ = startZ;
        this.moveEndX = startX;
        this.moveEndY = startY;
        this.moveEndZ = startZ;
        this.state = STATE.NORMAL;
        this.prevState = STATE.NORMAL;
        this.moveCount = 0;
        this.isMoving = false;
        this.squishX = 1;
        this.squishY = 1;
        this.stateChangeTimer = 0;
        this.colorTransition = 1;
        this.prevColor = STATE_INFO[STATE.NORMAL].color;
        this.currentColor = STATE_INFO[STATE.NORMAL].color;
    }

    // ── Movement ──

    // targetZ defaults to the current Z so 2D-only callers keep working unchanged.
    startMove(direction, targetX, targetY, targetZ, callback) {
        if (typeof targetZ === 'function') {
            // Back-compat: startMove(direction, x, y, callback) with implicit Z.
            callback = targetZ;
            targetZ = this.gridZ;
        }
        if (targetZ === undefined) targetZ = this.gridZ;

        if (this.isMoving) return;

        // Don't move if already at target
        if (targetX === this.gridX && targetY === this.gridY && targetZ === this.gridZ) return;

        this.isMoving = true;
        this.moveStartX = this.gridX;
        this.moveStartY = this.gridY;
        this.moveStartZ = this.gridZ;
        this.moveEndX = targetX;
        this.moveEndY = targetY;
        this.moveEndZ = targetZ;
        this.moveProgress = 0;
        this.moveDirection = direction;
        this.onMoveComplete = callback;

        // Calculate duration based on distance
        const dist = Math.abs(targetX - this.gridX) + Math.abs(targetY - this.gridY) + Math.abs(targetZ - this.gridZ);
        this.moveDuration = Math.min(0.5, 0.08 + dist * 0.06);

        // Set eye direction (screen-space; Z-only moves don't have a 2D eye direction)
        const dir = DIR[direction];
        this.eyeTargetX = dir ? dir.x : 0;
        this.eyeTargetY = dir ? dir.y : 0;

        // Squish in movement direction
        if (targetZ !== this.moveStartZ) {
            this.squishX = 0.9;
            this.squishY = 0.9;
        } else if (dir && dir.x !== 0) {
            this.squishX = 0.8;
            this.squishY = 1.15;
        } else {
            this.squishX = 1.15;
            this.squishY = 0.8;
        }
    }

    changeState(newState, particles, pixelX, pixelY) {
        if (newState === this.state) return;

        this.prevState = this.state;
        this.prevColor = STATE_INFO[this.state].color;
        this.state = newState;
        this.currentColor = STATE_INFO[newState].color;
        this.stateChangeTimer = 0.5;
        this.colorTransition = 0;

        // Particles
        if (particles) {
            particles.burstStateChange(pixelX, pixelY, this.currentColor);
        }
    }

    // ── Update ──

    update(dt) {
        this.wobbleTime += dt;

        // Color transition
        if (this.colorTransition < 1) {
            this.colorTransition = Math.min(1, this.colorTransition + dt * 4);
        }

        // State change flash timer
        if (this.stateChangeTimer > 0) {
            this.stateChangeTimer = Math.max(0, this.stateChangeTimer - dt);
        }

        // Squish recovery
        this.squishX += (1 - this.squishX) * dt * 8;
        this.squishY += (1 - this.squishY) * dt * 8;

        // Movement animation
        if (this.isMoving) {
            this.moveProgress += dt / this.moveDuration;

            if (this.moveProgress >= 1) {
                this.moveProgress = 1;
                this.isMoving = false;
                this.gridX = this.moveEndX;
                this.gridY = this.moveEndY;
                this.gridZ = this.moveEndZ;
                this.visualX = this.moveEndX;
                this.visualY = this.moveEndY;
                this.visualZ = this.moveEndZ;

                // Landing squish
                const dir = DIR[this.moveDirection];
                if (this.moveEndZ !== this.moveStartZ) {
                    this.squishX = 1.1;
                    this.squishY = 1.1;
                } else if (dir && dir.x !== 0) {
                    this.squishX = 1.2;
                    this.squishY = 0.8;
                } else {
                    this.squishX = 0.8;
                    this.squishY = 1.2;
                }

                if (this.onMoveComplete) {
                    const cb = this.onMoveComplete;
                    this.onMoveComplete = null;
                    cb();
                }
            } else {
                // Ease-out interpolation
                const t = 1 - Math.pow(1 - this.moveProgress, 3);
                this.visualX = this.moveStartX + (this.moveEndX - this.moveStartX) * t;
                this.visualY = this.moveStartY + (this.moveEndY - this.moveStartY) * t;
                this.visualZ = this.moveStartZ + (this.moveEndZ - this.moveStartZ) * t;
            }
        }
    }

    // ── Rendering ──

    render(ctx, level) {
        // visualZ is fractional mid-flight; gridToPixelIfVisible only rounds the
        // axis fixed by the current view, so the two free axes (including a
        // fractional Z on the Z-Y view) still animate smoothly on screen.
        const pos = level.gridToPixelIfVisible(this.visualX, this.visualY, this.visualZ);
        if (!pos) return; // player's plane isn't the one currently in view
        const s = level.tileSize;
        const r = s * 0.35;

        // [MODIFIED] 캐릭터를 반투명 젤 재질·림라이트·표정·상태 실루엣을 가진 출시용 마스코트로 재구성
        ctx.save();
        ctx.translate(pos.x, pos.y);
        const shadow = ctx.createRadialGradient(0, r * 0.82, 0, 0, r * 0.82, r * 1.05);
        shadow.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
        shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.ellipse(0, r * 0.83, r * 0.92, r * 0.27, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(pos.x, pos.y);

        const wobble = Math.sin(this.wobbleTime * 3) * 0.026;
        ctx.scale(this.squishX + wobble, this.squishY - wobble);

        const info = STATE_INFO[this.state];
        const bodyColor = this._lerpColor(this.prevColor, this.currentColor, this.colorTransition);

        // State effects sit behind the translucent body so the silhouette stays readable.
        this._renderStateEffect(ctx, r, level);

        ctx.shadowColor = info.glow;
        ctx.shadowBlur = 18 + Math.sin(this.wobbleTime * 2) * 5;
        const bodyGradient = ctx.createRadialGradient(-r * 0.32, -r * 0.42, r * 0.05, 0, r * 0.08, r * 1.2);
        bodyGradient.addColorStop(0, '#F5FFFD');
        bodyGradient.addColorStop(0.16, bodyColor);
        bodyGradient.addColorStop(0.72, bodyColor);
        bodyGradient.addColorStop(1, '#153D38');
        ctx.fillStyle = bodyGradient;
        ctx.globalAlpha = info.bgAlpha;
        this._traceJellyBody(ctx, r, this.wobbleTime);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(226, 255, 249, 0.48)';
        ctx.lineWidth = Math.max(1, r * 0.065);
        this._traceJellyBody(ctx, r * 0.965, this.wobbleTime);
        ctx.stroke();

        ctx.save();
        this._traceJellyBody(ctx, r * 0.92, this.wobbleTime);
        ctx.clip();
        const lowerGel = ctx.createLinearGradient(0, -r, 0, r);
        lowerGel.addColorStop(0.38, 'rgba(255,255,255,0)');
        lowerGel.addColorStop(1, 'rgba(0,22,30,0.26)');
        ctx.fillStyle = lowerGel;
        ctx.fillRect(-r * 1.2, -r, r * 2.4, r * 2.2);
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.28, -r * 0.38, r * 0.29, r * 0.17, -0.45, 0, Math.PI * 2);
        ctx.fill();

        const eyeSpacing = r * 0.34;
        const eyeY = -r * 0.08;
        const eyeW = r * 0.22;
        const eyeH = r * 0.25;
        const pupilR = eyeW * 0.48;
        const eyeLookX = this.eyeTargetX * eyeW * 0.3;
        const eyeLookY = this.eyeTargetY * eyeH * 0.24;

        for (const side of [-1, 1]) {
            const ex = eyeSpacing * side;
            ctx.fillStyle = 'rgba(5, 15, 28, 0.82)';
            ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeW * 1.18, eyeH * 1.14, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#F7FFFF';
            ctx.beginPath(); ctx.ellipse(ex, eyeY - r * 0.015, eyeW, eyeH, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#092033';
            ctx.beginPath(); ctx.arc(ex + eyeLookX, eyeY + eyeLookY, pupilR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath(); ctx.arc(ex + eyeLookX - pupilR * 0.28, eyeY + eyeLookY - pupilR * 0.32, pupilR * 0.28, 0, Math.PI * 2); ctx.fill();
        }

        ctx.fillStyle = 'rgba(7, 27, 35, 0.58)';
        ctx.beginPath();
        ctx.ellipse(0, r * 0.33, r * 0.12, r * 0.085, 0, 0, Math.PI);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 161, 170, 0.19)';
        ctx.beginPath(); ctx.ellipse(-r * 0.58, r * 0.22, r * 0.12, r * 0.055, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.58, r * 0.22, r * 0.12, r * 0.055, 0, 0, Math.PI * 2); ctx.fill();

        if (this.stateChangeTimer > 0) {
            const flashAlpha = Math.min(1, this.stateChangeTimer * 2);
            ctx.globalAlpha = flashAlpha;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = Math.max(1, r * 0.08);
            ctx.beginPath();
            ctx.arc(0, 0, r * (1.05 + (0.5 - this.stateChangeTimer) * 1.8), 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }

    _renderStateEffect(ctx, r, level) {
        switch (this.state) {
            case STATE.MAGNET: {
                // [MODIFIED] 자석 상태를 회전 금속편과 끌림 빔으로 표현해 몸체 뒤에서도 식별 가능하게 함
                for (let i = 0; i < 4; i++) {
                    const angle = this.wobbleTime * 1.8 + (Math.PI / 2) * i;
                    const orbitR = r * 1.34;
                    const fx = Math.cos(angle) * orbitR;
                    const fy = Math.sin(angle) * orbitR;
                    ctx.save();
                    ctx.translate(fx, fy);
                    ctx.rotate(angle);
                    ctx.fillStyle = 'rgba(180, 235, 255, 0.82)';
                    ctx.shadowColor = '#42C9FF';
                    ctx.shadowBlur = 7;
                    ctx.fillRect(-Math.max(1.5, r * 0.1), -Math.max(1, r * 0.045), Math.max(3, r * 0.2), Math.max(2, r * 0.09));
                    ctx.restore();
                }

                // Draw magnetic pull lines to nearest M wall on the player's own layer
                const pz = this.gridZ;
                let mx = null, my = null, dist = Infinity;
                for (let yy = 0; yy < level.height; yy++) {
                    for (let xx = 0; xx < level.width; xx++) {
                        if (level.getTile(xx, yy, pz) === TILE.METAL_WALL) {
                            if (xx === this.gridX || yy === this.gridY) {
                                let clear = true;
                                if (xx === this.gridX) {
                                    const minY = Math.min(yy, this.gridY);
                                    const maxY = Math.max(yy, this.gridY);
                                    for(let j=minY+1; j<maxY; j++) if(isBlocking(level.getTile(xx, j, pz), this.state)) clear = false;
                                } else {
                                    const minX = Math.min(xx, this.gridX);
                                    const maxX = Math.max(xx, this.gridX);
                                    for(let j=minX+1; j<maxX; j++) if(isBlocking(level.getTile(j, this.gridY, pz), this.state)) clear = false;
                                }
                                if (clear) {
                                    const d = Math.abs(xx - this.gridX) + Math.abs(yy - this.gridY);
                                    if (d < dist) { dist = d; mx = xx; my = yy; }
                                }
                            }
                        }
                    }
                }

                if (mx !== null && dist > 0) {
                    const mPos = level.gridToPixelIfVisible(mx, my, pz);
                    const pPos = level.gridToPixelIfVisible(this.visualX, this.visualY, pz);
                    if (!mPos || !pPos) break;
                    const dx = mPos.x - pPos.x;
                    const dy = mPos.y - pPos.y;
                    
                    ctx.save();
                    ctx.strokeStyle = 'rgba(66, 201, 255, 0.36)';
                    ctx.lineWidth = Math.max(1, r * 0.055);
                    ctx.setLineDash([Math.max(3, r * 0.22), Math.max(4, r * 0.34)]);
                    ctx.lineDashOffset = -this.wobbleTime * 18;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(dx, dy);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
                break;
            }

            case STATE.ICE:
                // [MODIFIED] 냉기 상태를 몸 주변에 고정된 결정 왕관으로 표시해 랜덤 노이즈 없이 선명하게 유지
                ctx.fillStyle = 'rgba(214, 250, 255, 0.82)';
                ctx.shadowColor = '#3CCBFF';
                ctx.shadowBlur = 8;
                for (let i = 0; i < 5; i++) {
                    const angle = -Math.PI * 0.85 + i * (Math.PI * 0.42);
                    const orbit = r * (1.18 + Math.sin(this.wobbleTime * 2 + i) * 0.035);
                    const dropX = Math.cos(angle) * orbit;
                    const dropY = Math.sin(angle) * orbit;
                    const size = Math.max(2, r * 0.14);
                    ctx.beginPath();
                    ctx.moveTo(dropX, dropY - size);
                    ctx.lineTo(dropX + size * 0.48, dropY);
                    ctx.lineTo(dropX, dropY + size);
                    ctx.lineTo(dropX - size * 0.48, dropY);
                    ctx.closePath();
                    ctx.fill();
                }
                break;

            case STATE.ELECTRIC:
                // [MODIFIED] 프레임마다 튀던 랜덤 번쩍임을 결정적 전기 아크로 교체해 화면 떨림과 플리커를 줄임
                ctx.strokeStyle = 'rgba(255, 224, 122, 0.92)';
                ctx.lineWidth = Math.max(1.2, r * 0.065);
                ctx.shadowColor = '#FF9F1C';
                ctx.shadowBlur = 8;
                for (let i = 0; i < 4; i++) {
                    const angle = this.wobbleTime * 3.8 + (Math.PI * 2 / 4) * i;
                    const sparkR = r * 1.35;
                    const sx = Math.cos(angle) * sparkR;
                    const sy = Math.sin(angle) * sparkR;
                    const bend = Math.sin(this.wobbleTime * 11 + i * 2.7) * r * 0.14;
                    ctx.beginPath();
                    ctx.moveTo(sx * 0.6, sy * 0.6);
                    ctx.lineTo(sx * 0.88 - Math.sin(angle) * bend, sy * 0.88 + Math.cos(angle) * bend);
                    ctx.lineTo(sx * 1.14, sy * 1.14);
                    ctx.stroke();
                }
                break;
        }
    }

    _lerpColor(colorA, colorB, t) {
        if (t >= 1) return colorB;
        if (t <= 0) return colorA;

        // Parse hex colors
        const a = this._hexToRgb(colorA);
        const b = this._hexToRgb(colorB);
        if (!a || !b) return colorB;

        const r = Math.round(a.r + (b.r - a.r) * t);
        const g = Math.round(a.g + (b.g - a.g) * t);
        const bl = Math.round(a.b + (b.b - a.b) * t);

        return `rgb(${r},${g},${bl})`;
    }

    _hexToRgb(hex) {
        const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!match) return null;
        return {
            r: parseInt(match[1], 16),
            g: parseInt(match[2], 16),
            b: parseInt(match[3], 16),
        };
    }

    _traceJellyBody(ctx, r, phase) {
        // New rendering helper is kept at the end of the class per repository placement rules.
        const points = 12;
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const bottomWeight = Math.max(0, Math.sin(angle));
            const pulse = Math.sin(phase * 3.2 + i * 1.17) * r * 0.025;
            const localR = r + pulse + bottomWeight * r * 0.055;
            const px = Math.cos(angle) * localR;
            const py = Math.sin(angle) * localR * (0.96 + bottomWeight * 0.05);
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                const prevAngle = ((i - 1) / points) * Math.PI * 2;
                const midAngle = (prevAngle + angle) / 2;
                const cpR = localR * 1.04;
                ctx.quadraticCurveTo(
                    Math.cos(midAngle) * cpR,
                    Math.sin(midAngle) * cpR,
                    px,
                    py
                );
            }
        }
        ctx.closePath();
    }
}
