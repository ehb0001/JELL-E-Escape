// ── Main Game ──
// Game loop, state machine, physics, UI rendering

class Game {
    constructor() {
        this.canvas = document.getElementById('game');
        this.container = document.getElementById('game-container');
        this.ctx = this.canvas.getContext('2d');
        this.state = GAME_STATE.TITLE;
        this.currentLevel = 0;
        this.unlockedLevels = this._loadProgress();

        // Title bar DOM refs
        this.el = {
            stageNum: document.getElementById('title-bar-stage-num'),
            stageName: document.getElementById('title-bar-stage-name'),
            stateIcon: document.getElementById('title-bar-state-icon'),
            stateName: document.getElementById('title-bar-state-name'),
            moves: document.getElementById('title-bar-moves'),
            restartBtn: document.getElementById('title-bar-restart'),
        };
        this.el.restartBtn.addEventListener('click', () => {
            if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.ANIMATING) {
                this._restartLevel();
            }
        });
        document.getElementById('title-bar-stage').addEventListener('click', () => {
            if (this.state === GAME_STATE.PLAYING) {
                this.state = GAME_STATE.LEVEL_SELECT;
                this._setupLevelSelectUI();
                document.getElementById('ui-overlay').style.display = 'flex';
            }
        });

        // Systems
        this.level = new Level();
        this.player = new Player();
        this.particles = new ParticleSystem(300);
        this.audio = new Audio();
        this.input = new Input(this.canvas);

        // UI state
        this.titleAlpha = 0;
        this.clearTimer = 0;
        this.tutorialMsg = '';
        this.tutorialAlpha = 0;
        this.screenShake = 0;
        this.time = 0;

        // Transition
        this.transitionAlpha = 1;
        this.transitionTarget = 0;
        this.transitionSpeed = 3;
        this.pendingViewChange = null; // function to run once faded to black

        this._resize();
        window.addEventListener('resize', () => this._resize());
        this.input.onSwipe((dir) => this._onSwipe(dir));
        this.input.onTap((x, y) => this._handleTap(x, y));
        this.input.onViewToggle(() => this._toggleView());
        this.input.onViewShift((delta) => this._shiftView(delta));

        // Start loop
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._loop(t));
    }

    // ── Resize ──

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.ANIMATING) {
            this.level.calculateLayout(this.width, this.height);
        }
    }

    // ── Game Loop ──

    _loop(now) {
        const dt = Math.min(0.1, (now - this.lastTime) / 1000);
        this.lastTime = now;
        this.time += dt;

        this._update(dt);
        this._render();

        requestAnimationFrame((t) => this._loop(t));
    }

    _update(dt) {
        // Transition fade
        if (this.transitionAlpha !== this.transitionTarget) {
            const dir = this.transitionTarget > this.transitionAlpha ? 1 : -1;
            this.transitionAlpha += dir * dt * this.transitionSpeed;
            if (dir > 0 && this.transitionAlpha >= this.transitionTarget) this.transitionAlpha = this.transitionTarget;
            if (dir < 0 && this.transitionAlpha <= this.transitionTarget) this.transitionAlpha = this.transitionTarget;

            if (this.pendingViewChange && this.transitionAlpha >= 1) {
                const change = this.pendingViewChange;
                this.pendingViewChange = null;
                change();
                this.transitionTarget = 0;
                this.transitionSpeed = 3;
            }
        }

        // Screen shake decay
        if (this.screenShake > 0) {
            this.screenShake *= 0.9;
            if (this.screenShake < 0.3) this.screenShake = 0;
        }

        // Tutorial alpha
        if (this.tutorialMsg) {
            this.tutorialAlpha = Math.min(1, this.tutorialAlpha + dt * 2);
        } else {
            this.tutorialAlpha = Math.max(0, this.tutorialAlpha - dt * 3);
        }

        switch (this.state) {
            case GAME_STATE.TITLE:
                this.titleAlpha = Math.min(1, this.titleAlpha + dt * 1.5);
                break;

            case GAME_STATE.PLAYING:
            case GAME_STATE.ANIMATING:
                this.level.update(dt);
                this.player.update(dt);
                this.particles.update(dt);
                break;

            case GAME_STATE.LEVEL_CLEAR:
                this.clearTimer += dt;
                this.particles.update(dt);
                this.level.update(dt);
                break;
        }
    }

    // ── Input ──

    _onSwipe(direction) {
        switch (this.state) {
            case GAME_STATE.TITLE:
                this._startLevelSelect();
                break;

            case GAME_STATE.LEVEL_SELECT:
                // Handle in click events
                break;

            case GAME_STATE.PLAYING:
                this._movePlayer(direction);
                break;

            case GAME_STATE.LEVEL_CLEAR:
                if (this.clearTimer > 1) {
                    this._nextLevel();
                }
                break;
        }
    }

    // ── View (axis) switching ──

    _toggleView() {
        if (this.state !== GAME_STATE.PLAYING) return;
        if (this.pendingViewChange) return;

        this.pendingViewChange = () => {
            // Reset the fixed slice to wherever the player currently is on the new axis.
            const nextAxis = this.level.viewAxis === 'z' ? 'x' : 'z';
            const index = nextAxis === 'z' ? this.player.gridZ : this.player.gridX;
            this.level.setView(nextAxis, index);
            this.level.calculateLayout(this.width, this.height);
        };
        this.transitionSpeed = 8;
        this.transitionTarget = 1;
    }

    _shiftView(delta) {
        if (this.state !== GAME_STATE.PLAYING) return;
        if (this.pendingViewChange) return;

        this.pendingViewChange = () => {
            this.level.shiftView(delta);
            this.level.calculateLayout(this.width, this.height);
        };
        this.transitionSpeed = 8;
        this.transitionTarget = 1;
    }

    // ── State Transitions ──

    _startLevelSelect() {
        this.state = GAME_STATE.LEVEL_SELECT;
        this.audio.playButtonClick();
        this._setupLevelSelectUI();
        document.body.classList.remove('at-title');
        this._resize();
    }

    _setupLevelSelectUI() {
        const overlay = document.getElementById('ui-overlay');
        overlay.innerHTML = '';
        overlay.style.display = 'flex';

        const container = document.createElement('div');
        container.className = 'level-select-container';

        const title = document.createElement('h2');
        title.textContent = 'Select Stage';
        title.className = 'level-select-title';
        container.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'level-grid';

        LEVELS_DATA.forEach((lvl, i) => {
            const btn = document.createElement('button');
            const unlocked = i <= this.unlockedLevels;
            btn.className = `level-btn ${unlocked ? 'unlocked' : 'locked'}`;
            btn.innerHTML = unlocked
                ? `<span class="level-num">${lvl.id}</span><span class="level-name">${lvl.name}</span>`
                : `<span class="level-num">🔒</span><span class="level-name">Locked</span>`;
            if (unlocked) {
                btn.addEventListener('click', () => {
                    this.audio.playButtonClick();
                    overlay.style.display = 'none';
                    this._loadLevel(i);
                });
            }
            grid.appendChild(btn);
        });

        container.appendChild(grid);
        overlay.appendChild(container);
    }

    _loadLevel(index) {
        this.currentLevel = index;
        this.level.load(index);
        this.level.calculateLayout(this.width, this.height);
        this.player.reset(this.level.playerStart.x, this.level.playerStart.y, this.level.playerStart.z);
        this.state = GAME_STATE.PLAYING;
        this.transitionAlpha = 1;
        this.transitionTarget = 0;

        // Tutorial messages
        const messages = [
            'Swipe to slide JELL-E!',
            'Hit the Metal wall to gain Magnet power!',
            'Hit the Glass wall to gain Slippery power!',
            'Hit the Rubber wall to gain Bouncy power!',
            'Hit the Electric wall to gain Electric power!',
        ];
        this.tutorialMsg = messages[index] || '';
        setTimeout(() => { this.tutorialMsg = ''; }, 4000);
    }

    _nextLevel() {
        if (this.currentLevel + 1 < LEVELS_DATA.length) {
            this._loadLevel(this.currentLevel + 1);
        } else {
            // All levels complete!
            this.state = GAME_STATE.LEVEL_SELECT;
            this._setupLevelSelectUI();
            document.getElementById('ui-overlay').style.display = 'flex';
        }
    }

    // ── Physics / Movement ──

    // Convert a 3D grid coord to screen pixels, or null if that layer/column
    // isn't the one currently in view.
    _gridToPixel(x, y, z) {
        return this.level.gridToPixelIfVisible(x, y, z);
    }

    // Resolve a screen-space swipe direction to a 3D grid delta for whichever
    // plane (X-Y or Z-Y) is currently in view.
    _moveDelta(direction) {
        const table = VIEW_DIR_3D[this.level.viewAxis] || VIEW_DIR_3D.z;
        return table[direction] || null;
    }

    _movePlayer(direction) {
        if (this.player.isMoving) return;

        const delta = this._moveDelta(direction);
        if (!delta) return;
        const { dx, dy, dz } = delta;

        if (this.iceKickWait) {
            this._resolveIceKick(direction);
            return;
        }

        const startX = this.player.gridX;
        const startY = this.player.gridY;
        const startZ = this.player.gridZ;
        let x = startX;
        let y = startY;
        let z = startZ;
        let hitWallType = null;
        let hitWallX = undefined;
        let hitWallY = undefined;
        let hitWallZ = undefined;
        let moved = false;

        // Perpendicular axis within the current view plane (not the move axis itself),
        // used by the magnet snap check. Movement always stays within one 2D plane:
        // X-Y view moves along X or Y (perpendicular is the other of the two);
        // Z-Y view moves along Z or Y (perpendicular is the other of the two).
        let perpDx = 0, perpDy = 0, perpDz = 0;
        if (dx !== 0) {
            perpDy = 1; // X-Y view, moving along X -> perpendicular is Y
        } else if (dz !== 0) {
            perpDy = 1; // Z-Y view, moving along Z -> perpendicular is Y
        } else {
            // Moving along Y: perpendicular is X (X-Y view) or Z (Z-Y view).
            if (this.level.viewAxis === 'x') perpDz = 1;
            else perpDx = 1;
        }

        while (true) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            const tile = this.level.getTile(nx, ny, nz);

            if (tile === TILE.PORTAL) {
                x = nx; y = ny; z = nz;
                moved = true;
                break;
            }

            if (tile === TILE.ELECTRIC_DOOR && this.player.state === STATE.ELECTRIC) {
                // If sliding through an electric door with electric state, we do NOT stop
                // But we will handle opening it in the secondary move callback
            } else if (isBlocking(tile, this.player.state)) {
                hitWallType = tile;
                hitWallX = nx;
                hitWallY = ny;
                hitWallZ = nz;
                break;
            }

            x = nx; y = ny; z = nz;
            moved = true;

            // Magnet: stop if a metal wall is right beside the tile just entered
            // (checked along the perpendicular axis of the current view plane).
            if (this.player.state === STATE.MAGNET) {
                const side1x = x + perpDx, side1y = y + perpDy, side1z = z + perpDz;
                const side2x = x - perpDx, side2y = y - perpDy, side2z = z - perpDz;
                if (this.level.getTile(side1x, side1y, side1z) === TILE.METAL_WALL) {
                    hitWallType = TILE.METAL_WALL;
                    hitWallX = side1x; hitWallY = side1y; hitWallZ = side1z;
                    break;
                }
                if (this.level.getTile(side2x, side2y, side2z) === TILE.METAL_WALL) {
                    hitWallType = TILE.METAL_WALL;
                    hitWallX = side2x; hitWallY = side2y; hitWallZ = side2z;
                    break;
                }
            }
        }

        // Items picked up mid-move only take visual/state effect this turn;
        // their gameplay effect (ice kick, magnet snap, electric passage) starts next turn.
        const startState = this.player.state;
        let itemsConsumed = [];
        let ix = this.player.gridX;
        let iy = this.player.gridY;
        let iz = this.player.gridZ;

        while(ix !== x || iy !== y || iz !== z) {
            ix += dx; iy += dy; iz += dz;
            const iTile = this.level.getTile(ix, iy, iz);
            if (isItem(iTile) && itemsConsumed.length === 0) {
                itemsConsumed.push({x: ix, y: iy, z: iz, type: iTile});
            }
        }

        let bounceX = x;
        let bounceY = y;
        let bounceZ = z;

        const pendingIceKick = hitWallType !== null && startState === STATE.ICE;

        if (hitWallType === TILE.RUBBER_WALL) {
            const backDx = -dx, backDy = -dy, backDz = -dz;
            let bounces = 0;
            while(bounces < 2) {
                const bx = bounceX + backDx;
                const by = bounceY + backDy;
                const bz = bounceZ + backDz;
                if(isBlocking(this.level.getTile(bx, by, bz), startState) ||
                   (bx === this.player.gridX && by === this.player.gridY && bz === this.player.gridZ)) {
                    break;
                }
                bounceX = bx; bounceY = by; bounceZ = bz;
                bounces++;
            }
        }

        if (!moved) return;

        this.audio.playMove();
        this.state = GAME_STATE.ANIMATING;
        this.input.disable();

        if (this.player.moveCount === 0) this.tutorialMsg = '';
        this.player.moveCount++;

        let finalX = bounceX;
        let finalY = bounceY;
        let finalZ = bounceZ;

        const finishMove = () => {
             this._onMoveComplete(finalX, finalY, finalZ, hitWallType, itemsConsumed, hitWallX, hitWallY, hitWallZ);
        };

        const doSecondaryMove = () => {
             itemsConsumed.forEach(item => {
                 this.level.consumeItem(item.x, item.y, item.z);
                 const pos = this._gridToPixel(item.x, item.y, item.z);
                 if (pos) {
                     this.particles.burstStateChange(pos.x, pos.y, TILE_COLORS[item.type].color);
                     this.audio.playStateChange();
                 }
                 this.player.changeState(ITEM_TO_STATE[item.type], null, pos && pos.x, pos && pos.y);
             });

             // Check if we passed through any electric doors in the primary move
             let origX = startX;
             let origY = startY;
             let origZ = startZ;
             let dpx = Math.sign(x - origX);
             let dpy = Math.sign(y - origY);
             let dpz = Math.sign(z - origZ);
             if (dpx !== 0 || dpy !== 0 || dpz !== 0) {
                 let currX = origX, currY = origY, currZ = origZ;
                 while(currX !== x || currY !== y || currZ !== z) {
                     currX += dpx; currY += dpy; currZ += dpz;
                     if (this.level.getTile(currX, currY, currZ) === TILE.ELECTRIC_DOOR && this.player.state === STATE.ELECTRIC) {
                         this.level.openDoor(currX, currY, currZ);
                         const pos = this._gridToPixel(currX, currY, currZ);
                         if (pos) {
                             this.particles.burstStateChange(pos.x, pos.y, '#ffffff');
                             this.audio.playStateChange();
                         }
                         this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
                     }
                 }
             }

             // Check if we passed through any electric doors in the secondary (bounce) move
             let px = x, py = y, pz = z;
             let tx = bounceX, ty = bounceY, tz = bounceZ;
             let dbx = Math.sign(tx - px);
             let dby = Math.sign(ty - py);
             let dbz = Math.sign(tz - pz);
             if (dbx !== 0 || dby !== 0 || dbz !== 0) {
                 let currX = px, currY = py, currZ = pz;
                 while(currX !== tx || currY !== ty || currZ !== tz) {
                     currX += dbx; currY += dby; currZ += dbz;
                     if (this.level.getTile(currX, currY, currZ) === TILE.ELECTRIC_DOOR && this.player.state === STATE.ELECTRIC) {
                         this.level.openDoor(currX, currY, currZ);
                         const pos = this._gridToPixel(currX, currY, currZ);
                         if (pos) {
                             this.particles.burstStateChange(pos.x, pos.y, '#ffffff');
                             this.audio.playStateChange();
                         }
                         this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
                     }
                 }
             }

             if (bounceX !== x || bounceY !== y || bounceZ !== z) {
                 const backDirName = Object.keys(VIEW_DIR_3D[this.level.viewAxis]).find(key => {
                     const d = VIEW_DIR_3D[this.level.viewAxis][key];
                     return d.dx === -dx && d.dy === -dy && d.dz === -dz;
                 });
                 this.player.startMove(backDirName, bounceX, bounceY, bounceZ, finishMove);
             } else if (pendingIceKick) {
                 this._enterIceKickWait(x, y, z, direction);
             } else {
                 finishMove();
             }
        };

        this.player.startMove(direction, x, y, z, doSecondaryMove);
    }

    // ── Ice kick (post-slide direction choice) ──

    _enterIceKickWait(x, y, z, incomingDirection) {
        this.player.gridX = x;
        this.player.gridY = y;
        this.player.gridZ = z;
        this.player.visualX = x;
        this.player.visualY = y;
        this.player.visualZ = z;
        this.player.isMoving = false;
        this.state = GAME_STATE.PLAYING;
        this.input.enable();
        this.iceKickWait = { x, y, z, incomingDirection, viewAxis: this.level.viewAxis };
    }

    _resolveIceKick(direction) {
        const wait = this.iceKickWait;
        const delta = this._moveDelta(direction);
        if (!delta) return;
        const inDelta = VIEW_DIR_3D[wait.viewAxis][wait.incomingDirection];

        // Ignore the direction we were traveling and its opposite; only perpendicular kicks resolve the wait.
        const isPerpendicular = (delta.dx !== inDelta.dx || delta.dy !== inDelta.dy || delta.dz !== inDelta.dz)
            && (delta.dx !== -inDelta.dx || delta.dy !== -inDelta.dy || delta.dz !== -inDelta.dz);
        if (!isPerpendicular) return;

        this.iceKickWait = null;

        const kx = wait.x + delta.dx;
        const ky = wait.y + delta.dy;
        const kz = wait.z + delta.dz;
        const tile = this.level.getTile(kx, ky, kz);

        if (isBlocking(tile, this.player.state)) {
            const pos = this._gridToPixel(kx, ky, kz);
            if (pos) {
                this.particles.burstWallHit(pos.x, pos.y, tile);
                this.audio.playHitWall(tile);
            }
            this.screenShake = 3;
            if (tile === TILE.RUBBER_WALL) this.level.triggerRubberBounce(kx, ky, kz);
            // Ice is consumed even when the kick is blocked by a wall.
            this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
            return;
        }

        this.audio.playMove();
        this.state = GAME_STATE.ANIMATING;
        this.input.disable();

        this.player.startMove(direction, kx, ky, kz, () => {
            const pos = this._gridToPixel(kx, ky, kz);
            if (isItem(tile)) {
                this.level.consumeItem(kx, ky, kz);
                if (pos) {
                    this.particles.burstStateChange(pos.x, pos.y, TILE_COLORS[tile].color);
                    this.audio.playStateChange();
                }
                this.player.changeState(ITEM_TO_STATE[tile], null, pos && pos.x, pos && pos.y);
            } else if (tile === TILE.ELECTRIC_DOOR && this.player.state === STATE.ELECTRIC) {
                this.level.openDoor(kx, ky, kz);
                if (pos) {
                    this.particles.burstStateChange(pos.x, pos.y, '#ffffff');
                    this.audio.playStateChange();
                }
                this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
            } else {
                // Ice kick consumed the ice state
                this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
            }
            this._onMoveComplete(kx, ky, kz, null, [], undefined, undefined, undefined);
        });
    }

    _onMoveComplete(x, y, z, hitWallType, itemsConsumed, hitWallX, hitWallY, hitWallZ) {
        const pos = this._gridToPixel(
            hitWallX !== undefined ? hitWallX : x,
            hitWallY !== undefined ? hitWallY : y,
            hitWallZ !== undefined ? hitWallZ : z);

        if (isWall(hitWallType)) {
            if (pos) {
                this.particles.burstWallHit(pos.x, pos.y, hitWallType);
                this.audio.playHitWall(hitWallType);
            }
            this.screenShake = 3;

            if (hitWallType === TILE.RUBBER_WALL) {
                this.level.triggerRubberBounce(hitWallX, hitWallY, hitWallZ);
            }

            if (hitWallType === TILE.METAL_WALL && this.player.state === STATE.MAGNET) {
                // Magnet consumed: snapping onto a metal wall resets the state
                this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
            }
        }

        const currentTile = this.level.getTile(x, y, z);
        if (currentTile === TILE.PORTAL) {
            this._levelClear();
            return;
        }

        this.state = GAME_STATE.PLAYING;
        this.input.enable();
    }

    _levelClear() {
        this.state = GAME_STATE.LEVEL_CLEAR;
        this.clearTimer = 0;
        this.input.enable();

        // Update progress
        if (this.currentLevel >= this.unlockedLevels) {
            this.unlockedLevels = this.currentLevel + 1;
            this._saveProgress();
        }

        // Celebration effects
        const pos = this._gridToPixel(this.player.gridX, this.player.gridY, this.player.gridZ);
        if (pos) this.particles.burstCelebration(pos.x, pos.y);
        this.audio.playClear();
    }

    _restartLevel() {
        this.audio.playRestart();
        this._loadLevel(this.currentLevel);
    }

    // ── Save/Load ──

    _saveProgress() {
        try {
            localStorage.setItem('jelle_progress', JSON.stringify(this.unlockedLevels));
        } catch (e) { /* ignore */ }
    }

    _loadProgress() {
        // Unlock all levels for easy access and verification
        return 36;
    }

    // ── Rendering ──

    _render() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.save();

        // Screen shake
        if (this.screenShake > 0) {
            const sx = (Math.random() - 0.5) * this.screenShake;
            const sy = (Math.random() - 0.5) * this.screenShake;
            ctx.translate(sx, sy);
        }

        switch (this.state) {
            case GAME_STATE.TITLE:
                this._renderTitle(ctx, w, h);
                break;

            case GAME_STATE.LEVEL_SELECT:
                this._renderLevelSelectBg(ctx, w, h);
                break;

            case GAME_STATE.PLAYING:
            case GAME_STATE.ANIMATING:
                this._renderGame(ctx, w, h);
                break;

            case GAME_STATE.LEVEL_CLEAR:
                this._renderGame(ctx, w, h);
                this._renderClearOverlay(ctx, w, h);
                break;
        }

        // Transition overlay
        if (this.transitionAlpha > 0.01) {
            ctx.fillStyle = `rgba(10,10,26,${this.transitionAlpha})`;
            ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();
    }

    _renderTitle(ctx, w, h) {
        // Background
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, w, h);

        // Animated background particles
        for (let i = 0; i < 30; i++) {
            const x = (Math.sin(this.time * 0.3 + i * 2.1) * 0.5 + 0.5) * w;
            const y = (Math.cos(this.time * 0.2 + i * 1.7) * 0.5 + 0.5) * h;
            const alpha = 0.1 + Math.sin(this.time + i) * 0.05;
            const size = 2 + Math.sin(this.time * 0.5 + i) * 1;
            ctx.fillStyle = `rgba(105,240,174,${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = this.titleAlpha;

        // Title
        ctx.save();
        ctx.shadowColor = '#69F0AE';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#69F0AE';
        ctx.font = 'bold 42px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('JELL-E', w / 2, h * 0.32);
        ctx.restore();

        // Subtitle
        ctx.fillStyle = '#8888aa';
        ctx.font = '16px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Escape the Lab', w / 2, h * 0.40);

        // Jelly character preview
        this._renderTitleJelly(ctx, w / 2, h * 0.55);

        // Tap prompt
        const promptAlpha = 0.4 + Math.sin(this.time * 2) * 0.3;
        ctx.globalAlpha = this.titleAlpha * promptAlpha;
        ctx.fillStyle = '#aaaacc';
        ctx.font = '14px "Orbitron", sans-serif';
        ctx.fillText('Tap anywhere to start', w / 2, h * 0.78);

        ctx.globalAlpha = 1;
    }

    _renderTitleJelly(ctx, x, y) {
        const r = 35;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1 + Math.sin(this.time * 3) * 0.05, 1 - Math.sin(this.time * 3) * 0.05);

        // Glow
        ctx.shadowColor = '#69F0AE';
        ctx.shadowBlur = 25;

        // Body
        ctx.fillStyle = 'rgba(105,240,174,0.7)';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.ellipse(-5, -8, r * 0.4, r * 0.3, -0.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        // Eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(-10, -5, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, -5, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(-10 + Math.sin(this.time) * 2, -5, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(10 + Math.sin(this.time) * 2, -5, 4, 0, Math.PI * 2); ctx.fill();

        // Mouth
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 5, 6, 0, Math.PI);
        ctx.stroke();

        ctx.restore();
    }

    _renderLevelSelectBg(ctx, w, h) {
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, w, h);

        // Subtle grid pattern
        ctx.strokeStyle = 'rgba(40,40,80,0.3)';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = 0; x < w; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
    }

    _renderGame(ctx, w, h) {
        // Level grid
        this.level.render(ctx, w, h);

        // Portal particles (only if the portal's own layer is currently in view)
        const portalPos = this.level.gridToPixelIfVisible(
            this.level.portalPos.x, this.level.portalPos.y, this.level.portalPos.z);
        if (portalPos) {
            this.particles.emitPortalSwirl(portalPos.x, portalPos.y, this.time);
        }

        // Player trail particles (during movement)
        if (this.player.isMoving) {
            const pPos = this._gridToPixel(this.player.visualX, this.player.visualY, this.player.visualZ);
            if (pPos) {
                if (this.player.state === STATE.ICE) {
                    if (Math.random() < 0.3) {
                        this.particles.emitIceTrail(pPos.x, pPos.y);
                    }
                } else {
                    this.particles.emitTrail(pPos.x, pPos.y, STATE_INFO[this.player.state].color);
                }
            }
        }

        // Electric wall sparks (only meaningful on the X-Y view)
        if (this.level.viewAxis === 'z' && Math.random() < 0.3) {
            for (let y = 0; y < this.level.height; y++) {
                for (let x = 0; x < this.level.width; x++) {
                    if (this.level.getTile(x, y) === TILE.ELECTRIC && Math.random() < 0.03) {
                        const ep = this._gridToPixel(x, y, this.level.viewZ);
                        if (ep) this.particles.emitSparks(ep.x, ep.y);
                    }
                }
            }
        }

        // Particles
        this.particles.render(ctx);

        // Player
        this.player.render(ctx, this.level);

        // HUD (DOM-based, updated separately from render)
        this._updateHUD();

        // Tutorial
        if (this.tutorialAlpha > 0.01) {
            ctx.globalAlpha = this.tutorialAlpha * 0.9;
            ctx.fillStyle = 'rgba(10,10,26,0.7)';
            const tw = ctx.measureText(this.tutorialMsg).width + 40;

            ctx.font = '13px "Orbitron", sans-serif';
            const textW = ctx.measureText(this.tutorialMsg).width + 40;
            const tx = (w - textW) / 2;
            const ty = this.height - 70;

            this._roundRect(ctx, tx, ty, textW, 36, 18);
            ctx.fill();

            ctx.fillStyle = '#ccc';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.tutorialMsg, w / 2, ty + 18);
            ctx.globalAlpha = 1;
        }
    }

    _updateHUD() {
        const stateInfo = STATE_INFO[this.player.state];

        this.el.stageNum.textContent = `Stage ${this.level.levelData.id}`;
        this.el.stageName.textContent = this.level.levelData.name;
        this.el.stateIcon.textContent = stateInfo.icon;
        this.el.stateIcon.style.color = stateInfo.color;
        this.el.stateName.textContent = stateInfo.name;
        this.el.stateName.style.color = stateInfo.color;
        this.el.moves.textContent = `Moves: ${this.player.moveCount}`;
    }

    _handleTap(clientX, clientY) {
        if (this.state === GAME_STATE.TITLE) {
            this._startLevelSelect();
            return;
        }
    }

    _renderClearOverlay(ctx, w, h) {
        const alpha = Math.min(1, this.clearTimer * 2);
        ctx.globalAlpha = alpha;

        // Dark overlay
        ctx.fillStyle = 'rgba(10,10,26,0.6)';
        ctx.fillRect(0, 0, w, h);

        // Clear message
        const centerY = h * 0.4;

        ctx.save();
        ctx.shadowColor = '#FFD54F';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#FFD54F';
        ctx.font = 'bold 32px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Stage Clear!', w / 2, centerY);
        ctx.restore();

        ctx.fillStyle = '#aaa';
        ctx.font = '16px "Orbitron", sans-serif';
        ctx.fillText(`Moves: ${this.player.moveCount}`, w / 2, centerY + 45);

        // Next prompt
        if (this.clearTimer > 1) {
            const promptAlpha = 0.5 + Math.sin(this.time * 3) * 0.3;
            ctx.globalAlpha = alpha * promptAlpha;
            ctx.fillStyle = '#aaaacc';
            ctx.font = '14px "Orbitron", sans-serif';

            const hasNext = this.currentLevel + 1 < LEVELS_DATA.length;
            ctx.fillText(hasNext ? 'Swipe for next stage' : 'All stages cleared! Swipe to return.', w / 2, centerY + 90);
        }

        ctx.globalAlpha = 1;
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }
}

// ── Initialize ──
window.addEventListener('DOMContentLoaded', async () => {
    await loadAllLevels();
    window.game = new Game();
});
