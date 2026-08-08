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

        ctx.save();
        ctx.translate(pos.x, pos.y);

        // Wobble
        const wobble = Math.sin(this.wobbleTime * 3) * 0.03;
        ctx.scale(this.squishX + wobble, this.squishY - wobble);

        // ── Body ──
        const info = STATE_INFO[this.state];
        const bodyColor = this._lerpColor(this.prevColor, this.currentColor, this.colorTransition);

        // Outer glow
        ctx.shadowColor = info.glow;
        ctx.shadowBlur = 15 + Math.sin(this.wobbleTime * 2) * 5;

        // Main body (jellylike blob using bezier curves)
        ctx.fillStyle = bodyColor;
        ctx.globalAlpha = info.bgAlpha;
        ctx.beginPath();
        const points = 8;
        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const wobbleR = r + Math.sin(this.wobbleTime * 4 + i * 1.3) * r * 0.06;
            const px = Math.cos(angle) * wobbleR;
            const py = Math.sin(angle) * wobbleR;
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                const prevAngle = ((i - 1) / points) * Math.PI * 2;
                const midAngle = (prevAngle + angle) / 2;
                const cpR = wobbleR * 1.15;
                const cpx = Math.cos(midAngle) * cpR;
                const cpy = Math.sin(midAngle) * cpR;
                ctx.quadraticCurveTo(cpx, cpy, px, py);
            }
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // Inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.15, -r * 0.2, r * 0.45, r * 0.35, -0.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        // ── Eyes ──
        const eyeSpacing = r * 0.35;
        const eyeY = -r * 0.1;
        const eyeR = r * 0.18;
        const pupilR = eyeR * 0.55;
        const eyeLookX = this.eyeTargetX * eyeR * 0.3;
        const eyeLookY = this.eyeTargetY * eyeR * 0.3;

        // Left eye
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + eyeLookX, eyeY + eyeLookY, pupilR, 0, Math.PI * 2);
        ctx.fill();

        // Right eye
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath();
        ctx.arc(eyeSpacing + eyeLookX, eyeY + eyeLookY, pupilR, 0, Math.PI * 2);
        ctx.fill();

        // Cute mouth
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, eyeY + r * 0.35, r * 0.15, 0, Math.PI);
        ctx.stroke();

        // ── State-specific decorations ──
        this._renderStateEffect(ctx, r, level);

        // ── State change flash ──
        if (this.stateChangeTimer > 0) {
            const flashAlpha = this.stateChangeTimer * 0.6;
            ctx.globalAlpha = flashAlpha;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, r * 1.5 * (1 - this.stateChangeTimer), 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }

    _renderStateEffect(ctx, r, level) {
        switch (this.state) {
            case STATE.MAGNET: {
                // Small metal fragments orbiting
                for (let i = 0; i < 4; i++) {
                    const angle = this.wobbleTime * 2 + (Math.PI / 2) * i;
                    const orbitR = r * 1.3;
                    const fx = Math.cos(angle) * orbitR;
                    const fy = Math.sin(angle) * orbitR;
                    ctx.fillStyle = 'rgba(144,164,174,0.6)';
                    ctx.fillRect(fx - 2, fy - 2, 4, 4);
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
                    ctx.strokeStyle = 'rgba(79, 195, 247, 0.4)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    for(let i=0; i<3; i++) {
                        const offset = (this.wobbleTime * 3 + i / 3) % 1;
                        const sx = dx * offset;
                        const sy = dy * offset;
                        ctx.moveTo(sx, sy);
                        ctx.lineTo(sx + dx*0.1, sy + dy*0.1);
                    }
                    ctx.stroke();
                    ctx.restore();
                }
                break;
            }

            case STATE.ICE:
                // Ice crystals
                ctx.fillStyle = 'rgba(178,235,242,0.6)';
                for (let i = 0; i < 3; i++) {
                    const dropY = r * 0.5 + ((this.wobbleTime * 30 + i * 20) % (r * 1.5));
                    const dropX = (i - 1) * r * 0.4;
                    ctx.beginPath();
                    ctx.moveTo(dropX, dropY - 3);
                    ctx.lineTo(dropX + 2, dropY);
                    ctx.lineTo(dropX, dropY + 3);
                    ctx.lineTo(dropX - 2, dropY);
                    ctx.fill();
                }
                break;

            case STATE.ELECTRIC:
                // Flash yellow occasionally
                if (Math.random() < 0.1) {
                    ctx.fillStyle = 'rgba(255,255,255,0.3)';
                    ctx.beginPath();
                    ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
                    ctx.fill();
                }
                // Electric sparks
                ctx.strokeStyle = 'rgba(255,213,79,0.9)';
                ctx.lineWidth = 2;
                for (let i = 0; i < 4; i++) {
                    const angle = this.wobbleTime * 15 + (Math.PI * 2 / 4) * i + Math.random() * 0.5;
                    const sparkR = r * 1.3;
                    const sx = Math.cos(angle) * sparkR;
                    const sy = Math.sin(angle) * sparkR;
                    ctx.beginPath();
                    ctx.moveTo(sx * 0.6, sy * 0.6);
                    ctx.lineTo(sx + (Math.random() - 0.5) * 8, sy + (Math.random() - 0.5) * 8);
                    ctx.lineTo(sx * 1.4 + (Math.random() - 0.5) * 10, sy * 1.4 + (Math.random() - 0.5) * 10);
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
}
