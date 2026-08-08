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
        // [MODIFIED] 게임의 뷰·플레이어 상태를 우측 방향도와 미니맵에 동기화하기 위한 전용 UI 시스템
        this.sidebarUI = new SidebarMapUI();

        // [MODIFIED] X-Y/Z-Y 뷰 대칭, 효과음 온/오프 설정 -- 저장된 값을 불러와 level.mirror/audio에 적용하고
        // 사이드바 설정 카드의 체크박스와 양방향으로 동기화
        this._setupSettingsUI();

        // UI state
        this.titleAlpha = 0;
        this.clearTimer = 0;
        this.tutorialMsg = '';
        this.tutorialAlpha = 0;
        this.screenShake = 0;
        this.time = 0;

        // Transition (level-load fade to/from black; unrelated to Tab/Q/E view transitions below)
        this.transitionAlpha = 1;
        this.transitionTarget = 0;
        this.transitionSpeed = 3;

        // [MODIFIED] Q/E 슬라이스 이동 전용 줌+페이드 트랜지션.
        // 이전 프레임을 오프스크린에 스냅샷해뒀다가, 새 슬라이스와 반대 방향으로 확대/축소시키며 크로스페이드.
        this.depthSnapshotCanvas = document.createElement('canvas');
        this.depthSnapshotCtx = this.depthSnapshotCanvas.getContext('2d');
        this.depthTransition = null; // { t, duration, direction }
        this.depthTransitionDuration = 0.32;

        // [MODIFIED] Tab 축 전환 전용 카드 플립 트랜지션(scaleX 1->0->1, 중간 지점에서 뷰 교체).
        this.flipTransition = null; // { t, duration, applied, change }
        this.flipTransitionDuration = 0.36;

        this._resize();
        window.addEventListener('resize', () => this._resize());
        this.input.onSwipe((dir) => this._onSwipe(dir));
        this.input.onTap((x, y) => this._handleTap(x, y));
        this.input.onViewToggle((hoverPoint) => this._toggleView(hoverPoint));
        this.input.onViewShift((delta) => this._shiftView(delta));
        // [MODIFIED] Tab 롱프레스 중 보드 위 마우스가 가리키는 칸을 하이라이트하기 위한 프리뷰 상태
        this.tabHoverHighlight = null; // { x, y } in canvas CSS px, or null
        this.input.onViewTogglePreview((active, x, y) => {
            this.tabHoverHighlight = active ? { x, y } : null;
        });

        // Start loop
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._loop(t));
    }

    // ── Resize ──

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        this.dpr = dpr; // [MODIFIED] Q/E 스냅샷 캔버스에도 동일한 dpr 변환을 적용하기 위해 보관
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // [MODIFIED] Q/E 줌 트랜지션 스냅샷 캔버스도 메인 캔버스와 동일한 실 픽셀 크기로 유지
        this.depthSnapshotCanvas.width = this.canvas.width;
        this.depthSnapshotCanvas.height = this.canvas.height;

        if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.ANIMATING) {
            this.level.calculateLayout(this.width, this.height);
            // [MODIFIED] 사이드바 너비가 반응형으로 바뀔 때 실제 맵 비율을 새 표시 영역에 다시 맞춤
            this.sidebarUI.resize();
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

        }

        // [MODIFIED] Q/E 줌 트랜지션 진행도 갱신
        if (this.depthTransition) {
            this.depthTransition.t += dt;
            if (this.depthTransition.t >= this.depthTransition.duration) {
                this.depthTransition = null;
            }
        }

        // [MODIFIED] Tab 플립 트랜지션 진행도 갱신 -- 절반 지점에서 실제 뷰 축 교체 실행
        if (this.flipTransition) {
            const ft = this.flipTransition;
            ft.t += dt;
            if (!ft.applied && ft.t >= ft.duration / 2) {
                ft.change();
                ft.applied = true;
            }
            if (ft.t >= ft.duration) {
                this.flipTransition = null;
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

    // [MODIFIED] Tab은 암전 페이드 대신 카드 플립(scaleX 1->0->1)으로 전환.
    // 절반 지점(가장 얇아진 순간)에서 실제 뷰 축을 교체해, 뒷면이 뒤집히며 나타나는 것처럼 보이게 함.
    // hoverPoint(롱프레스로 마우스가 가리키던 칸, 캔버스 CSS px)가 있으면 그 칸의 좌표를 새 뷰의 고정
    // 슬라이스로 사용하고, 없으면(짧게 누름) 기존처럼 주인공 위치 기준.
    _toggleView(hoverPoint = null) {
        if (this.state !== GAME_STATE.PLAYING) return;
        if (this.depthTransition || this.flipTransition) return;

        this.flipTransition = {
            t: 0,
            duration: this.flipTransitionDuration,
            applied: false,
            change: () => {
                const nextAxis = this.level.viewAxis === 'z' ? 'x' : 'z';
                const index = this._resolveToggleSlice(nextAxis, hoverPoint);
                this.level.setView(nextAxis, index);
                this.level.calculateLayout(this.width, this.height);
            },
        };
    }

    // hoverPoint를 현재(전환 전) 뷰 기준 보드 셀로 변환해 grid 좌표를 구하고, 그중 새 축(nextAxis)에
    // 해당하는 좌표값을 돌려줌. hoverPoint가 없거나 보드 밖이면 주인공 위치로 폴백.
    _resolveToggleSlice(nextAxis, hoverPoint) {
        if (hoverPoint) {
            const level = this.level;
            if (level.tileSize) {
                const col = Math.floor((hoverPoint.x - level.offsetX) / level.tileSize);
                const row = Math.floor((hoverPoint.y - level.offsetY) / level.tileSize);
                const { cols, rows } = level.getViewDimensions();
                if (col >= 0 && row >= 0 && col < cols && row < rows) {
                    const g = level.viewToGrid(col, row);
                    return nextAxis === 'z' ? g.z : g.x;
                }
            }
        }
        return nextAxis === 'z' ? this.player.gridZ : this.player.gridX;
    }

    // Q/E는 방향성 줌+크로스페이드로 전환.
    // 진행(E, delta>0)이면 새 슬라이스는 크게 시작해 1.0으로 줄어들며 다가오고,
    // 기존 화면은 반대 방향인 축소(1.0->작게)로 사라짐. 후진(Q)은 그 반대.
    _shiftView(delta) {
        if (this.state !== GAME_STATE.PLAYING) return;
        if (this.depthTransition || this.flipTransition) return;
        // [MODIFIED] 경계라 실제로 슬라이스가 안 바뀌면 스냅샷/트랜지션 자체를 시작하지 않음(시각 효과 억제)
        if (!this.level.canShiftView(delta)) return;

        // [MODIFIED] 배경은 스냅샷에 넣지 않음 -- 보드(패널+타일+파티클+플레이어)만 투명 배경에 그려서
        // 나중에 스케일/페이드해도 배경이 같이 축소되거나 이중으로 겹쳐 보이지 않게 함.
        this.depthSnapshotCtx.clearRect(0, 0, this.depthSnapshotCanvas.width, this.depthSnapshotCanvas.height);
        this.depthSnapshotCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this._drawBoardSnapshot(this.depthSnapshotCtx);

        this.level.shiftView(delta);
        this.level.calculateLayout(this.width, this.height);

        this.depthTransition = {
            t: 0,
            duration: this.depthTransitionDuration,
            // [MODIFIED] 줌 방향 반전 요청 -- E(전진)에서 새 슬라이스가 작게 시작해 커지고, 기존은 확대되며 사라지게
            direction: delta >= 0 ? -1 : 1,
        };
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
            btn.disabled = !unlocked;
            // [MODIFIED] 레벨 번호와 이름만 있던 카드를 구역 코드·상태·진입 방향이 보이는 탐사 카드로 개선
            btn.innerHTML = unlocked
                ? `<span class="level-num">${String(lvl.id).padStart(2, '0')}</span>` +
                  `<span class="level-info"><span class="level-code">SECTOR ${String(lvl.id).padStart(2, '0')} // OPEN</span>` +
                  `<span class="level-name">${lvl.name}</span></span><span class="level-arrow">›</span>`
                : `<span class="level-num">—</span><span class="level-info"><span class="level-code">ACCESS DENIED</span>` +
                  `<span class="level-name">Locked sector</span></span>`;
            btn.setAttribute('aria-label', unlocked ? `Stage ${lvl.id}: ${lvl.name}` : `Stage ${lvl.id}: locked`);
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
        // [MODIFIED] 새 레벨의 X:Y:Z 크기와 시작·목표 좌표를 첫 프레임 전에도 즉시 표시
        this.sidebarUI.render(this.level, this.player, true);
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
    // [MODIFIED] 화면 대칭(미러) 설정이 켜져 있으면 스와이프 방향이 실제로 향하는 축 부호를 반전시켜서,
    // 렌더링이 반전된 화면과 조작 방향이 항상 일치하게 함(자석/얼음 등 하류 로직은 축만 보고 부호는 안 봐서 영향 없음).
    _moveDelta(direction) {
        const axis = this.level.viewAxis;
        const table = VIEW_DIR_3D[axis] || VIEW_DIR_3D.z;
        const base = table[direction];
        if (!base) return null;

        const mirror = this.level.mirror[axis];
        let { dx, dy, dz } = base;
        if (mirror.h) {
            if (axis === 'x') dz = -dz; else dx = -dx;
        }
        if (mirror.v) dy = -dy;
        return { dx, dy, dz };
    }

    _movePlayer(direction) {
        if (this.player.isMoving) return;
        if (this.depthTransition || this.flipTransition) return; // [MODIFIED] 뷰 트랜지션 중 이동 입력이 겹쳐 보이지 않도록 차단

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

    // ── Settings (view mirroring, sound) ──

    // [MODIFIED] 저장된 대칭/효과음 설정을 불러와 level.mirror·audio.enabled에 반영하고,
    // 사이드바 설정 카드의 체크박스 초기값/변경 이벤트를 연결
    _setupSettingsUI() {
        const settings = this._loadSettings();
        this.level.mirror.z.h = settings.mirrorZH;
        this.level.mirror.z.v = settings.mirrorZV;
        this.level.mirror.x.h = settings.mirrorXH;
        this.level.mirror.x.v = settings.mirrorXV;
        this.audio.enabled = settings.soundOn;

        const bind = (id, initial, apply) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = initial;
            el.addEventListener('change', () => {
                apply(el.checked);
                this._saveSettings();
            });
        };

        bind('setting-mirror-z-h', settings.mirrorZH, (v) => { this.level.mirror.z.h = v; });
        bind('setting-mirror-z-v', settings.mirrorZV, (v) => { this.level.mirror.z.v = v; });
        bind('setting-mirror-x-h', settings.mirrorXH, (v) => { this.level.mirror.x.h = v; });
        bind('setting-mirror-x-v', settings.mirrorXV, (v) => { this.level.mirror.x.v = v; });
        bind('setting-sound', settings.soundOn, (v) => { this.audio.enabled = v; });
    }

    _currentSettings() {
        return {
            mirrorZH: this.level.mirror.z.h,
            mirrorZV: this.level.mirror.z.v,
            mirrorXH: this.level.mirror.x.h,
            mirrorXV: this.level.mirror.x.v,
            soundOn: this.audio.enabled,
        };
    }

    _saveSettings() {
        try {
            localStorage.setItem('jelle_settings', JSON.stringify(this._currentSettings()));
        } catch (e) { /* ignore */ }
    }

    _loadSettings() {
        const defaults = { mirrorZH: false, mirrorZV: false, mirrorXH: false, mirrorXV: false, soundOn: true };
        try {
            const raw = localStorage.getItem('jelle_settings');
            if (!raw) return defaults;
            return { ...defaults, ...JSON.parse(raw) };
        } catch (e) {
            return defaults;
        }
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
                if (this.depthTransition) {
                    this._renderDepthTransition(ctx, w, h);
                } else if (this.flipTransition) {
                    this._renderFlipTransition(ctx, w, h);
                } else {
                    this._renderGame(ctx, w, h);
                }
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

    // [MODIFIED] Q/E 슬라이스 전환용 방향성 줌+크로스페이드 렌더.
    // 새 슬라이스(라이브 렌더)는 진행 방향에서 다가오듯 큰 배율에서 1.0으로,
    // 이전 슬라이스(스냅샷)는 그 반대 배율로 멀어지며 페이드아웃.
    _renderDepthTransition(ctx, w, h) {
        const trans = this.depthTransition;
        const p = Math.min(1, trans.t / trans.duration);
        const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
        const dir = trans.direction;
        const zoomAmount = 0.4;
        const cx = w / 2, cy = h / 2;

        const newStartScale = 1 + zoomAmount * dir;
        const newScale = newStartScale + (1 - newStartScale) * eased;
        const oldEndScale = 1 - zoomAmount * dir;
        const oldScale = 1 + (oldEndScale - 1) * eased;

        // [MODIFIED] 배경은 트랜지션과 무관하게 항상 고정으로 한 번만 그림 (맵 보드만 확대/축소 대상)
        this.level.renderBackground(ctx, w, h);

        // New (live) board underneath, zooming in from newStartScale to 1 while fading in.
        ctx.save();
        ctx.globalAlpha = eased;
        ctx.translate(cx, cy);
        ctx.scale(newScale, newScale);
        ctx.translate(-cx, -cy);
        this._renderBoardLayer(ctx, w, h);
        ctx.restore();

        // Old (snapshot) board on top, zooming toward oldEndScale while fading out.
        ctx.save();
        ctx.globalAlpha = 1 - eased;
        ctx.translate(cx, cy);
        ctx.scale(oldScale, oldScale);
        ctx.translate(-cx, -cy);
        ctx.drawImage(this.depthSnapshotCanvas, 0, 0, w, h);
        ctx.restore();

        this._updateHUD();
        this.sidebarUI.render(this.level, this.player);
        this._renderTutorial(ctx, w, h);
    }

    // [MODIFIED] Tab 축 전환용 카드 플립 렌더.
    // 전반부는 아직 안 바뀐(old) 뷰가 scaleX 1->0으로 얇아지고,
    // 절반 지점에서 _update가 실제 뷰를 교체한 뒤, 후반부는 새 뷰가 0->1로 펼쳐짐.
    // 가장 얇아지는 순간(옆면) 근처에서 살짝 어둡게 해 입체감을 더함.
    _renderFlipTransition(ctx, w, h) {
        const ft = this.flipTransition;
        const half = ft.duration / 2;
        const p = ft.t < half ? ft.t / half : (ft.t - half) / half;
        const rawScaleX = ft.t < half ? 1 - p : p;
        const scaleX = Math.max(0.02, rawScaleX); // keep transform non-degenerate
        const dimAlpha = (1 - scaleX) * 0.35;
        const cx = w / 2, cy = h / 2;

        // [MODIFIED] 배경은 플립과 무관하게 항상 고정으로 한 번만 그림 (맵 보드만 뒤집힘 대상)
        this.level.renderBackground(ctx, w, h);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scaleX, 1);
        ctx.translate(-cx, -cy);
        this._renderBoardLayer(ctx, w, h);
        ctx.restore();

        if (dimAlpha > 0.01) {
            ctx.fillStyle = `rgba(5,10,20,${dimAlpha})`;
            ctx.fillRect(0, 0, w, h);
        }

        this._updateHUD();
        this.sidebarUI.render(this.level, this.player);
        this._renderTutorial(ctx, w, h);
    }

    _renderTitle(ctx, w, h) {
        // [MODIFIED] 타이틀을 로고·실험체·시설 상태가 한 장면에 담기는 출시용 키비주얼로 재구성
        this._renderLabBackdrop(ctx, w, h, 1);
        ctx.globalAlpha = this.titleAlpha;

        const titleSize = Math.max(38, Math.min(72, w * 0.095));
        const centerX = w / 2;

        ctx.fillStyle = '#5E7792';
        ctx.font = '700 9px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BIO-RESPONSE UNIT // SUBJECT 01', centerX, h * 0.215);

        ctx.save();
        ctx.shadowColor = '#78FFD6';
        ctx.shadowBlur = 30;
        const titleGradient = ctx.createLinearGradient(centerX - titleSize * 2.2, 0, centerX + titleSize * 2.2, 0);
        titleGradient.addColorStop(0, '#C8FFF0');
        titleGradient.addColorStop(0.52, '#78FFD6');
        titleGradient.addColorStop(1, '#42C9FF');
        ctx.fillStyle = titleGradient;
        ctx.font = `800 ${titleSize}px "Orbitron", sans-serif`;
        ctx.fillText('JELL-E', centerX, h * 0.305);
        ctx.restore();

        ctx.fillStyle = '#8CA0B8';
        ctx.font = '600 12px "Space Grotesk", sans-serif';
        ctx.fillText('ESCAPE THE LAB', centerX, h * 0.375);

        this._renderTitleJelly(ctx, centerX, h * 0.565);

        const promptAlpha = 0.68 + Math.sin(this.time * 2.4) * 0.18;
        ctx.globalAlpha = this.titleAlpha * promptAlpha;
        const promptW = Math.min(250, w * 0.68);
        this._roundRect(ctx, centerX - promptW / 2, h * 0.785 - 22, promptW, 44, 22);
        ctx.fillStyle = 'rgba(14, 31, 48, 0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 255, 214, 0.36)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#D9FFF4';
        ctx.font = '700 10px "Orbitron", sans-serif';
        ctx.fillText('TAP  /  SWIPE TO INITIALIZE', centerX, h * 0.785);

        ctx.globalAlpha = 1;
    }

    _renderTitleJelly(ctx, x, y) {
        // [MODIFIED] 타이틀 마스코트를 게임 본체와 동일한 젤 재질·표정 언어로 통일
        const r = 52;

        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
        ctx.beginPath(); ctx.ellipse(0, r * 0.9, r * 1.08, r * 0.24, 0, 0, Math.PI * 2); ctx.fill();
        ctx.scale(1 + Math.sin(this.time * 3) * 0.035, 1 - Math.sin(this.time * 3) * 0.035);

        ctx.shadowColor = '#78FFD6';
        ctx.shadowBlur = 32;
        const body = ctx.createRadialGradient(-r * 0.3, -r * 0.42, r * 0.05, 0, r * 0.08, r * 1.2);
        body.addColorStop(0, '#FFFFFF');
        body.addColorStop(0.16, '#A7FFE7');
        body.addColorStop(0.66, '#58E7BC');
        body.addColorStop(1, '#17483E');
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.bezierCurveTo(r, -r * 0.78, r * 0.52, -r, 0, -r);
        ctx.bezierCurveTo(-r * 0.58, -r, -r, -r * 0.7, -r, 0);
        ctx.bezierCurveTo(-r, r * 0.76, -r * 0.56, r * 1.02, 0, r * 0.92);
        ctx.bezierCurveTo(r * 0.56, r * 1.02, r, r * 0.76, r, 0);
        ctx.closePath();
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(235, 255, 250, 0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.27, r * 0.16, -0.4, 0, Math.PI * 2);
        ctx.fill();

        const pupilOffset = Math.sin(this.time * 0.8) * 2;
        for (const side of [-1, 1]) {
            const ex = side * r * 0.32;
            ctx.fillStyle = '#071827';
            ctx.beginPath(); ctx.ellipse(ex, -r * 0.08, r * 0.205, r * 0.235, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#F8FFFF';
            ctx.beginPath(); ctx.ellipse(ex, -r * 0.1, r * 0.17, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#0A2432';
            ctx.beginPath(); ctx.arc(ex + pupilOffset, -r * 0.085, r * 0.085, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath(); ctx.arc(ex + pupilOffset - r * 0.025, -r * 0.12, r * 0.022, 0, Math.PI * 2); ctx.fill();
        }

        ctx.fillStyle = 'rgba(5, 28, 32, 0.58)';
        ctx.beginPath(); ctx.ellipse(0, r * 0.29, r * 0.12, r * 0.08, 0, 0, Math.PI); ctx.fill();

        ctx.restore();
    }

    _renderLevelSelectBg(ctx, w, h) {
        // [MODIFIED] 레벨 선택 배경도 타이틀과 같은 시설 공간을 공유해 화면 전환의 일관성을 유지
        this._renderLabBackdrop(ctx, w, h, 0.65);
    }

    _renderGame(ctx, w, h) {
        // [MODIFIED] 배경(그라디언트+격자)은 Q/E·Tab 트랜지션에서 항상 고정으로 그려야 해서 보드 렌더와 분리
        this.level.renderBackground(ctx, w, h);
        this._renderBoardLayer(ctx, w, h);
        // [MODIFIED] Tab 롱프레스로 전환을 준비 중일 때 마우스가 가리키는 칸을 하이라이트
        this._renderTabHoverHighlight(ctx);

        // HUD (DOM-based, updated separately from render)
        this._updateHUD();
        // [MODIFIED] 이동 애니메이션과 Tab/Q/E 시점 변경을 현재 프레임의 사이드바에 실시간 반영
        this.sidebarUI.render(this.level, this.player);

        this._renderTutorial(ctx, w, h);
    }

    // Tab을 길게 눌러 전환을 준비 중일 때(Input.viewTogglePreviewCallback), 마우스 아래 보드 칸에
    // 테두리 글로우를 그려서 "곧 전환됨"을 시각적으로 미리 보여줌. 하이라이트 자체는 축/슬라이스 선택에는
    // 관여하지 않음(전환 결과는 항상 기존과 동일하게 반대 축으로 토글).
    _renderTabHoverHighlight(ctx) {
        if (!this.tabHoverHighlight) return;
        const level = this.level;
        if (!level.tileSize) return;

        const { x, y } = this.tabHoverHighlight;
        const col = Math.floor((x - level.offsetX) / level.tileSize);
        const row = Math.floor((y - level.offsetY) / level.tileSize);
        const { cols, rows } = level.getViewDimensions();
        if (col < 0 || row < 0 || col >= cols || row >= rows) return;

        const px = level.offsetX + col * level.tileSize;
        const py = level.offsetY + row * level.tileSize;

        ctx.save();
        ctx.strokeStyle = '#78FFD6';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#78FFD6';
        ctx.shadowBlur = 12;
        ctx.strokeRect(px + 1.5, py + 1.5, level.tileSize - 3, level.tileSize - 3);
        ctx.restore();
    }

    // [MODIFIED] 맵 보드(패널+타일+파티클+플레이어)만 그리는 레이어.
    // Q/E 줌, Tab 플립 트랜지션이 배경은 그대로 두고 이 레이어만 스케일/페이드하기 위해 분리.
    _renderBoardLayer(ctx, w, h) {
        this.level.renderBoard(ctx);

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
    }

    // Board-only redraw with no new particle emission -- used solely to capture the
    // Q/E depth-transition snapshot, so the frozen "old" layer doesn't keep spawning particles.
    _drawBoardSnapshot(ctx) {
        this.level.renderBoard(ctx);
        this.particles.render(ctx);
        this.player.render(ctx, this.level);
    }

    _renderTutorial(ctx, w, h) {
        if (this.tutorialAlpha > 0.01) {
            ctx.globalAlpha = this.tutorialAlpha * 0.9;
            ctx.fillStyle = 'rgba(10,10,26,0.7)';

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
        // [MODIFIED] 상단 HUD가 MOVES 레이블을 별도로 가지므로 값만 갱신해 정보 중복을 제거
        this.el.moves.textContent = `${this.player.moveCount}`;
    }

    _handleTap(clientX, clientY) {
        if (this.state === GAME_STATE.TITLE) {
            this._startLevelSelect();
            return;
        }
    }

    _renderClearOverlay(ctx, w, h) {
        // [MODIFIED] 클리어 화면을 단순 텍스트 오버레이에서 결과 카드와 상태 링이 있는 완료 화면으로 개선
        const alpha = Math.min(1, this.clearTimer * 2);
        ctx.globalAlpha = alpha;

        ctx.fillStyle = 'rgba(3, 7, 15, 0.76)';
        ctx.fillRect(0, 0, w, h);

        const centerY = h * 0.45;
        const cardW = Math.min(430, w * 0.76);
        const cardH = 230;
        this._roundRect(ctx, w / 2 - cardW / 2, centerY - cardH / 2, cardW, cardH, 24);
        const card = ctx.createLinearGradient(0, centerY - cardH / 2, 0, centerY + cardH / 2);
        card.addColorStop(0, 'rgba(20, 39, 59, 0.96)');
        card.addColorStop(1, 'rgba(7, 16, 30, 0.97)');
        ctx.fillStyle = card;
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 255, 214, 0.24)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(120, 255, 214, 0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, centerY - 55, 27 + Math.sin(this.time * 3) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#78FFD6';
        ctx.font = '700 16px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', w / 2, centerY - 55);

        ctx.save();
        ctx.shadowColor = '#78FFD6';
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#DFFFF5';
        ctx.font = '800 27px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SECTOR CLEARED', w / 2, centerY - 5);
        ctx.restore();

        ctx.fillStyle = '#778AA3';
        ctx.font = '600 10px "Orbitron", sans-serif';
        ctx.fillText(`MOVEMENT LOG  //  ${String(this.player.moveCount).padStart(2, '0')} MOVES`, w / 2, centerY + 35);

        // Next prompt
        if (this.clearTimer > 1) {
            const promptAlpha = 0.5 + Math.sin(this.time * 3) * 0.3;
            ctx.globalAlpha = alpha * promptAlpha;
            ctx.fillStyle = '#B8C9DB';
            ctx.font = '700 9px "Orbitron", sans-serif';

            const hasNext = this.currentLevel + 1 < LEVELS_DATA.length;
            ctx.fillText(hasNext ? 'SWIPE TO ENTER NEXT SECTOR  →' : 'ALL SECTORS SECURE  //  SWIPE TO ARCHIVE', w / 2, centerY + 78);
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

    _renderLabBackdrop(ctx, w, h, intensity = 1) {
        // New rendering helper is kept at the end of the class per repository placement rules.
        const bg = ctx.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.76);
        bg.addColorStop(0, `rgba(16, 43, 59, ${intensity})`);
        bg.addColorStop(0.5, `rgba(7, 16, 31, ${intensity})`);
        bg.addColorStop(1, `rgba(3, 6, 14, ${intensity})`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.strokeStyle = `rgba(89, 142, 170, ${0.075 * intensity})`;
        ctx.lineWidth = 1;
        const grid = 48;
        const drift = (this.time * 4) % grid;
        for (let x = -grid + drift; x < w + grid; x += grid) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = -grid + drift; y < h + grid; y += grid) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        ctx.strokeStyle = `rgba(120, 255, 214, ${0.13 * intensity})`;
        ctx.lineWidth = 1;
        for (const side of [-1, 1]) {
            const edgeX = w / 2 + side * Math.min(w * 0.42, 420);
            ctx.beginPath();
            ctx.moveTo(edgeX, h * 0.16);
            ctx.lineTo(edgeX, h * 0.84);
            ctx.stroke();
            for (let i = 0; i < 5; i++) {
                const markerY = h * (0.24 + i * 0.13);
                ctx.fillStyle = i === 2 ? '#78FFD6' : 'rgba(112, 154, 183, 0.35)';
                ctx.fillRect(edgeX - side * 8, markerY, side * 8, 1);
            }
        }

        for (let i = 0; i < 22; i++) {
            const px = (Math.sin(i * 29.13 + this.time * 0.14) * 0.5 + 0.5) * w;
            const py = (Math.cos(i * 17.71 + this.time * 0.11) * 0.5 + 0.5) * h;
            const glow = 0.08 + Math.sin(this.time * 1.4 + i) * 0.035;
            ctx.fillStyle = `rgba(120, 255, 214, ${glow * intensity})`;
            ctx.beginPath(); ctx.arc(px, py, i % 4 === 0 ? 1.6 : 0.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
}

// ── Initialize ──
window.addEventListener('DOMContentLoaded', async () => {
    await loadAllLevels();
    window.game = new Game();
});
