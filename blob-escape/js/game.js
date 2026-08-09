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
            levelSelectBtn: document.getElementById('title-bar-levelselect'),
        };
        // [MODIFIED] 버튼과 R 키가 같은 재시작 조건을 공유하도록 요청 핸들러로 통일
        this.el.restartBtn.addEventListener('click', () => this._handleRestartRequest());
        // [MODIFIED] 스테이지명과 새 전용 버튼이 같은 레벨 선택 진입 로직을 공유하도록 통일
        document.getElementById('title-bar-stage').addEventListener('click', () => this._openLevelSelect());
        this.el.levelSelectBtn.addEventListener('click', () => this._openLevelSelect());

        // Systems
        this.level = new Level();
        this.player = new Player();
        this.particles = new ParticleSystem(300);
        this.audio = new Audio();
        this.input = new Input(this.canvas);
        // [MODIFIED] 게임의 뷰·플레이어 상태를 우측 방향도와 미니맵에 동기화하기 위한 전용 UI 시스템
        this.sidebarUI = new SidebarMapUI();
        this.lastHUDKey = '';

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
        // [MODIFIED] Q/E 연속 입력 텀을 줄여달라는 요청으로 트랜지션 길이 단축(0.32 -> 0.25)
        this.depthTransitionDuration = 0.25;

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
            this.tabHoverHighlight = (active && this._viewToggleAllowed()) ? { x, y } : null;
        });
        // [MODIFIED] 한글/영문 입력 상태와 무관한 물리 R 키 재시작 요청을 게임 상태 핸들러에 연결
        this.input.onRestart(() => this._handleRestartRequest());
        // [MODIFIED] Esc로 레벨 선택 화면 닫기 -- 레벨 선택 상태가 아니면 _closeLevelSelect가 자체 가드로 무시함
        this.input.onCancel(() => this._closeLevelSelect());

        this.tutorialUI = new Tutorial();
        this._tutorialPending = false;

        // Start loop
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._loop(t));
    }

    // ── Resize ──

    _resize() {
        // [MODIFIED] Cap backing-store density so 3x/4x displays do not multiply blur cost excessively.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
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
        if (this._tutorialPending) {
            this._closeTutorial();
            return;
        }

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

        }
    }

    // ── View (axis) switching ──

    // [MODIFIED] 레벨 루트의 `viewToggleEnabled`로 Tab/Q/E 시점 전환 자체를 막을 수 있음(튜토리얼 등
    // 특정 시점만 강제하고 싶은 레벨용). 키가 없으면 기본값 true(전환 가능)로 동작.
    _viewToggleAllowed() {
        const data = this.level.levelData;
        return !data || data.viewToggleEnabled !== false;
    }

    // [MODIFIED] 시점 전환이 막힌 레벨에서는 시점 방향도/탑뷰 미니맵 카드의 제목을 포함한 콘텐츠 전체를
    // 렌더링하지 않고 안내 문구로 대체하며, 카드 자체도 회색조로 톤 다운함(레벨 로드 시 1회만 갱신).
    _updateViewSidebarAvailability() {
        const disabled = !this._viewToggleAllowed();
        this.viewSidebarDisabled = disabled;

        const viewCard = document.querySelector('.view-card');
        const viewContent = document.getElementById('view-card-content');
        const viewMsg = document.getElementById('view-card-disabled-msg');
        viewCard?.classList.toggle('disabled-card', disabled);
        if (viewContent) viewContent.hidden = disabled;
        if (viewMsg) viewMsg.hidden = !disabled;

        const minimapCard = document.querySelector('.minimap-card');
        const minimapContent = document.getElementById('minimap-card-content');
        const minimapMsg = document.getElementById('minimap-card-disabled-msg');
        minimapCard?.classList.toggle('disabled-card', disabled);
        if (minimapContent) minimapContent.hidden = disabled;
        if (minimapMsg) minimapMsg.hidden = !disabled;
    }

    // [MODIFIED] Tab은 암전 페이드 대신 카드 플립(scaleX 1->0->1)으로 전환.
    // 절반 지점(가장 얇아진 순간)에서 실제 뷰 축을 교체해, 뒷면이 뒤집히며 나타나는 것처럼 보이게 함.
    // hoverPoint(롱프레스로 마우스가 가리키던 칸, 캔버스 CSS px)가 있으면 그 칸의 좌표를 새 뷰의 고정
    // 슬라이스로 사용하고, 없으면(짧게 누름) 기존처럼 주인공 위치 기준.
    _toggleView(hoverPoint = null) {
        if (this.state !== GAME_STATE.PLAYING) return;
        if (this.depthTransition || this.flipTransition) return;
        if (!this._viewToggleAllowed()) return;

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
        if (!this._viewToggleAllowed()) return;
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
        // [MODIFIED] 타이틀에서 들어왔음을 기록 -- 닫을 때(배경 클릭/Esc/X) 타이틀로 돌아가야 함
        this.levelSelectReturnState = GAME_STATE.TITLE;
        this.state = GAME_STATE.LEVEL_SELECT;
        this.audio.playButtonClick();
        this._setupLevelSelectUI();
        document.body.classList.remove('at-title');
        this._resize();
    }

    // [MODIFIED] 배경 클릭/Esc/X 아이콘으로 레벨 선택을 닫을 때, 열기 전 상태(타이틀/인게임/클리어 화면)로 복귀.
    _closeLevelSelect() {
        if (this.state !== GAME_STATE.LEVEL_SELECT) return;
        const overlay = document.getElementById('ui-overlay');

        if (this.levelSelectReturnState === GAME_STATE.TITLE) {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
            this.state = GAME_STATE.TITLE;
            document.body.classList.add('at-title');
            this._resize();
        } else if (this.levelSelectReturnState === GAME_STATE.LEVEL_CLEAR) {
            // 클리어 카드가 원래 이 오버레이를 쓰고 있었으므로 다시 그려서 복원
            this.state = GAME_STATE.LEVEL_CLEAR;
            this._showClearScreen();
        } else {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
            this.state = this.levelSelectReturnState || GAME_STATE.PLAYING;
        }
    }

    _setupLevelSelectUI() {
        const overlay = document.getElementById('ui-overlay');
        overlay.innerHTML = '';
        overlay.style.display = 'flex';

        const container = document.createElement('div');
        container.className = 'level-select-container';

        // [MODIFIED] 배경(오버레이) 클릭 시 닫기 -- 카드 자체를 클릭한 경우는 버블링으로 여기까지
        // 오지 않도록 container에서 stopPropagation
        overlay.addEventListener('click', () => this._closeLevelSelect());
        container.addEventListener('click', (e) => e.stopPropagation());

        const header = document.createElement('div');
        header.className = 'level-select-header';

        const title = document.createElement('h2');
        title.textContent = 'Select Stage';
        title.className = 'level-select-title';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'level-select-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => this._closeLevelSelect());
        header.appendChild(closeBtn);

        container.appendChild(header);

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
        // [MODIFIED] viewToggleEnabled: false인 레벨은 시점 전환 자체가 막혀 있어 시점 방향도/탑뷰
        // 미니맵이 보여줄 정보가 없음 -- 캔버스를 그리는 대신 카드 콘텐츠 자체를 안내 문구로 교체
        this._updateViewSidebarAvailability();
        this._updateEchoMarkers();
        this.state = GAME_STATE.PLAYING;
        this.transitionAlpha = 1;
        this.transitionTarget = 0;

        this.tutorialAlpha = 0;
        this.tutorialMsg = '';

        // [MODIFIED] 대사창(tutorialDialog)은 제거하고 카드 튜토리얼(tutorial.cards)만 사용.
        // hint는 튜토리얼 전용이 아니라 어떤 레벨에서든 쓸 수 있는 일반 힌트라 별도로 유지.
        const data = this.level.levelData;
        const hasTutorialCards = data.tutorial && Array.isArray(data.tutorial.cards) && data.tutorial.cards.length > 0;
        if (hasTutorialCards) {
            this.input.disable();
            requestAnimationFrame(() => this._showTutorial(data.tutorial.cards));
        }

        // [MODIFIED] 버그 수정: 카드 튜토리얼이 있는 레벨은 카드가 떠 있는 동안 힌트의 6초 타이머가
        // 같이 흘러가버려서, 사용자가 카드를 오래 보고 있으면 닫자마자(또는 그 전에) 힌트가 사라졌음.
        // 카드가 있으면 타이머는 카드를 닫을 때(_closeTutorial)만 시작하고, 없으면 즉시 시작함.
        this.tutorialMsg = data.hint || '';
        if (this.tutorialMsg && !hasTutorialCards) {
            setTimeout(() => { this.tutorialMsg = ''; }, 6000);
        }
    }

    _nextLevel() {
        if (this.currentLevel + 1 < LEVELS_DATA.length) {
            this._loadLevel(this.currentLevel + 1);
        } else {
            // All levels complete!
            this._openLevelSelect();
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

        const startX = this.player.gridX;
        const startY = this.player.gridY;
        const startZ = this.player.gridZ;
        const startState = this.player.state;

        const initialSlide = this._resolveSlide(startX, startY, startZ, dx, dy, dz);
        let x = initialSlide.x;
        let y = initialSlide.y;
        let z = initialSlide.z;
        let hitWallType = initialSlide.hitWallType;
        let hitWallX = initialSlide.hitWallX;
        let hitWallY = initialSlide.hitWallY;
        let hitWallZ = initialSlide.hitWallZ;
        let moved = initialSlide.moved;
        let portalHit = initialSlide.portalHit;

        if (!moved) {
            if (hitWallType !== TILE.RUBBER_WALL) return;
            moved = true;
        }

        // [MODIFIED] 버그 수정: 포탈은 이제 일반 통과 지형이라 _resolveSlide가 벽/철벽까지 슬라이딩한
        // raw 도착점(x,y,z)을 반환함 -- 그 raw 지점까지 불을 검사해야 "포탈 너머 불"도 걸러짐(포탈을
        // 특수 케이스로 취급해 검사 범위를 거기서 끊지 않음). 통과하면 마지막에 포탈 위치로 도착점 보정.
        const firePos = this._scanForFire(startX, startY, startZ, x, y, z, dx, dy, dz);
        if (firePos) {
            if (startState !== STATE.ICE) {
                return;
            }

            // [MODIFIED] itemsConsumed와 같은 패턴: 슬라이딩 재계산(_resolveSlide)이 "불이 꺼져서 지나갈
            // 수 있는 NORMAL 상태" 기준으로 막힘 판정을 해야 하므로, 로직용으로만 잠깐 소화 상태/플레이어
            // 상태를 반영했다가 재계산 직후 원래대로 되돌림. 실제로 화면에 반영되는 소화(extinguishFire)와
            // changeState(색 전환 이펙트 포함) 호출은 doSecondaryMove에서 플레이어가 그 칸에 도달한
            // 시점에 한 번만 실행 -- 불 블록이 사라지는 것도 이동 시작이 아니라 도착 시점에 보이게 함.
            this.level.extinguishFire(firePos.x, firePos.y, firePos.z);
            this.player.state = STATE.NORMAL;

            const recalculated = this._resolveSlide(startX, startY, startZ, dx, dy, dz);
            x = recalculated.x;
            y = recalculated.y;
            z = recalculated.z;
            hitWallType = recalculated.hitWallType;
            hitWallX = recalculated.hitWallX;
            hitWallY = recalculated.hitWallY;
            hitWallZ = recalculated.hitWallZ;
            moved = recalculated.moved;
            portalHit = recalculated.portalHit;

            this.player.state = startState;
            this.level.unextinguishFire(firePos.x, firePos.y, firePos.z);
        }

        if (!moved) return;

        // [MODIFIED] 불 검사를 통과한 뒤에만 최종 도착점을 포탈 위치로 보정 -- 골(포탈)을 별도 특수
        // 지형으로 취급하지 않고, 일반 슬라이딩 결과에 마지막으로 얹는 후처리로 일반화함.
        if (portalHit) {
            x = portalHit.x; y = portalHit.y; z = portalHit.z;
        }

        // Items picked up mid-move only take visual/state effect this turn;
        // their gameplay effect (magnet snap, electric passage) starts next turn.
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

        if (hitWallType === TILE.RUBBER_WALL) {
            const backDx = -dx, backDy = -dy, backDz = -dz;
            const bx = x + backDx;
            const by = y + backDy;
            const bz = z + backDz;
            const tileBehind = this.level.getTile(bx, by, bz);
            if (!isBlocking(tileBehind, startState)) {
                bounceX = bx; bounceY = by; bounceZ = bz;
            } else {
                bounceX = x; bounceY = y; bounceZ = z;
            }
        }

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
             // [MODIFIED] itemsConsumed와 동일한 패턴: 플레이어가 실제로 그 칸(불이 있던 자리)에 도달한
             // 시점에 실제 소화(extinguishFire)와 changeState를 한 번에 실행해서, 불 블록이 사라지는 것도
             // 파티클/사운드/색 전환 플래시도 전부 이동 시작이 아니라 도착 시점에 함께 나타나게 함.
             if (firePos) {
                 this.level.extinguishFire(firePos.x, firePos.y, firePos.z);
                 const pos = this._gridToPixel(firePos.x, firePos.y, firePos.z);
                 if (pos) {
                     this.particles.burstStateChange(pos.x, pos.y, STATE_INFO[STATE.ICE].color);
                     this.audio.playStateChange();
                 }
                 this.player.changeState(STATE.NORMAL, null, pos && pos.x, pos && pos.y);
             }

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
             } else {
                 finishMove();
             }
        };

        this.player.startMove(direction, x, y, z, doSecondaryMove);
        if (!this.player.isMoving) {
            doSecondaryMove();
        }
    }

    _resolveSlide(startX, startY, startZ, dx, dy, dz) {
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

        // [MODIFIED] 포탈은 더 이상 슬라이딩을 그 자리에서 확정 종료시키는 특수 지형이 아님 -- 다른
        // 통과 가능 지형(바닥/아이템)과 동일하게 취급해 슬라이딩이 벽/철벽까지 계속 진행되도록 하고,
        // 경로 중 처음 만난 포탈 좌표만 기록해뒀다가 루프 종료 후 최종 도착점을 그 좌표로 보정함.
        // 이렇게 해야 "포탈 너머에 불이 있으면 그 스와이프 자체가 막혀야 한다"가 일반 슬라이딩/화재
        // 판정 로직 안에서 자연스럽게 성립함(포탈을 특수 케이스로 따로 취급하지 않음).
        let portalHit = null;

        while (true) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            const tile = this.level.getTile(nx, ny, nz);

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

            if (tile === TILE.PORTAL && !portalHit) {
                portalHit = { x, y, z };
            }

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

        // [MODIFIED] 여기서는 raw 도착점(x,y,z)을 그대로 반환 -- 불 검사(_scanForFire)가 이 raw 지점까지
        // 스캔해야 "포탈 너머 불"도 놓치지 않음. 포탈 위치 보정은 불 검사를 통과한 뒤 _movePlayer에서 적용.
        return { x, y, z, hitWallType, hitWallX, hitWallY, hitWallZ, moved, portalHit };
    }

    _scanForFire(startX, startY, startZ, endX, endY, endZ, dx, dy, dz) {
        let x = startX;
        let y = startY;
        let z = startZ;

        while (x !== endX || y !== endY || z !== endZ) {
            x += dx;
            y += dy;
            z += dz;
            const tile = this.level.getTile(x, y, z);
            if (tile === TILE.FIRE) {
                return { x, y, z };
            }
        }

        return null;
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
        this._updateEchoMarkers();
    }

    // [MODIFIED] 플레이어/골의 X-Y 위치를 다른 층에서도 대략 짐작할 수 있도록, 이동이 완전히 끝나
    // 자리를 잡았을 때만(애니메이션 중엔 갱신 안 함) 정지 좌표로 에코 마커를 갱신.
    _updateEchoMarkers() {
        this.level.setEchoMarkers([
            { x: this.player.gridX, y: this.player.gridY, z: this.player.gridZ, color: STATE_INFO[this.player.state].color },
            { x: this.level.portalPos.x, y: this.level.portalPos.y, z: this.level.portalPos.z, color: TILE_COLORS[TILE.PORTAL].stroke },
        ]);
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
        // [MODIFIED] 스와이프 자동 진행 대신 선택 가능한 DOM 완료 화면을 즉시 표시
        this._showClearScreen();
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
        return Number.MAX_SAFE_INTEGER;
    }

    // ── Settings (view mirroring, sound) ──

    // [MODIFIED] Z-Y 뷰는 좌우반전이 기본 상태(코드에 고정)라, 토글 UI는 항상 꺼진 채로 보여주고
    // "그 기본 위에 한 번 더 반전할지"만 나타냄. 실제 반전 여부 = 기본값 XOR 토글값.
    static MIRROR_X_H_BASE = true;

    // [MODIFIED] 저장된 대칭/효과음 설정을 불러와 level.mirror·audio.enabled에 반영하고,
    // 사이드바 설정 카드의 체크박스 초기값/변경 이벤트를 연결
    _setupSettingsUI() {
        const settings = this._loadSettings();
        this.level.mirror.z.h = settings.mirrorZH;
        this.level.mirror.z.v = settings.mirrorZV;
        this.level.mirror.x.h = settings.mirrorXHToggle !== Game.MIRROR_X_H_BASE;
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
        bind('setting-mirror-x-h', settings.mirrorXHToggle, (v) => { this.level.mirror.x.h = v !== Game.MIRROR_X_H_BASE; });
        bind('setting-mirror-x-v', settings.mirrorXV, (v) => { this.level.mirror.x.v = v; });
        bind('setting-sound', settings.soundOn, (v) => { this.audio.enabled = v; });
    }

    _currentSettings() {
        return {
            mirrorZH: this.level.mirror.z.h,
            mirrorZV: this.level.mirror.z.v,
            mirrorXHToggle: this.level.mirror.x.h !== Game.MIRROR_X_H_BASE,
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
        const defaults = { mirrorZH: false, mirrorZV: false, mirrorXHToggle: false, mirrorXV: false, soundOn: true };
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
        if (!this.viewSidebarDisabled) this.sidebarUI.render(this.level, this.player);
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
        if (!this.viewSidebarDisabled) this.sidebarUI.render(this.level, this.player);
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
        if (!this.viewSidebarDisabled) this.sidebarUI.render(this.level, this.player);

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
        // [MODIFIED] item 브랜치의 튜토리얼 카드(Tutorial UI)가 떠 있는 동안(_tutorialPending)에는
        // 힌트 말풍선을 같이 그리지 않도록 조건 추가(원본은 tutorialAlpha만 봄)
        if (!this._tutorialPending && this.tutorialAlpha > 0.01 && this.tutorialMsg) {
            ctx.globalAlpha = this.tutorialAlpha * 0.9;
            ctx.fillStyle = 'rgba(10,10,26,0.75)';

            ctx.font = '13px "Orbitron", sans-serif';
            const textW = ctx.measureText(this.tutorialMsg).width + 48;
            const tx = (w - textW) / 2;
            const ty = this.height - 90;

            this._roundRect(ctx, tx, ty, textW, 44, 20);
            ctx.fill();

            ctx.fillStyle = '#eee';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.tutorialMsg, w / 2, ty + 22);
            ctx.globalAlpha = 1;
        }
    }

    _updateHUD() {
        const stateInfo = STATE_INFO[this.player.state];
        const hudKey = [
            this.level.levelData.id,
            this.level.levelData.name,
            this.player.state,
            this.player.moveCount,
        ].join('|');
        if (hudKey === this.lastHUDKey) return;
        this.lastHUDKey = hudKey;

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

        if (this._tutorialPending) {
            this._closeTutorial();
            return;
        }
    }

    _showTutorial(cards) {
        this._tutorialPending = true;
        this.input.disable();
        this.tutorialAlpha = 0;
        this.tutorialMsg = '';
        this.tutorialUI.show(cards, () => this._closeTutorial());
    }

    _closeTutorial() {
        this._tutorialPending = false;
        this.input.enable();
        this.state = GAME_STATE.PLAYING;
        this.tutorialMsg = this.level.levelData.hint || '';
        if (this.tutorialMsg) {
            setTimeout(() => { this.tutorialMsg = ''; }, 6000);
        }
    }

    _renderClearOverlay(ctx, w, h) {
        // [MODIFIED] 완료 정보와 조작은 DOM 카드가 담당하므로 캔버스에는 게임 화면을 고정하는 딤만 유지
        const alpha = Math.min(1, this.clearTimer * 2);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(3, 7, 15, 0.52)';
        ctx.fillRect(0, 0, w, h);
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

    _openLevelSelect() {
        // New navigation helper is kept at the end of the class per repository placement rules.
        // [MODIFIED] 플레이 중 상단 컨트롤과 클리어 카드가 동일한 레벨 선택 진입 경로를 공유
        if (this.state !== GAME_STATE.PLAYING && this.state !== GAME_STATE.LEVEL_CLEAR) return;
        // [MODIFIED] 닫을 때(배경 클릭/Esc/X) 이 상태로 복귀하기 위해 기록
        this.levelSelectReturnState = this.state;
        this.state = GAME_STATE.LEVEL_SELECT;
        this.audio.playButtonClick();
        this._setupLevelSelectUI();
    }

    _handleRestartRequest() {
        // New input helper is kept at the end of the class per repository placement rules.
        // [MODIFIED] 재시작 버튼과 물리 R 키가 애니메이션 중을 포함한 기존 허용 조건을 공유
        if (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.ANIMATING) {
            this._restartLevel();
        }
    }

    _showClearScreen() {
        // New DOM UI helper is kept at the end of the class per repository placement rules.
        // [MODIFIED] 다음 행동을 명시적으로 고를 수 있도록 캔버스 완료 카드를 접근 가능한 DOM 카드로 교체
        const overlay = document.getElementById('ui-overlay');
        overlay.innerHTML = '';
        overlay.style.display = 'flex';
        overlay.style.pointerEvents = 'auto';

        const card = document.createElement('section');
        card.className = 'clear-screen';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'clear-screen-title');

        const icon = document.createElement('div');
        icon.className = 'clear-screen-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '✓';
        card.appendChild(icon);

        const kicker = document.createElement('div');
        kicker.className = 'clear-screen-kicker';
        kicker.textContent = `MISSION COMPLETE // SECTOR ${String(this.level.levelData.id).padStart(2, '0')}`;
        card.appendChild(kicker);

        const title = document.createElement('h2');
        title.id = 'clear-screen-title';
        title.className = 'clear-screen-title';
        title.textContent = 'SECTOR CLEARED';
        card.appendChild(title);

        const log = document.createElement('p');
        log.className = 'clear-screen-log';
        log.textContent = `MOVEMENT LOG  //  ${String(this.player.moveCount).padStart(2, '0')} MOVES`;
        card.appendChild(log);

        const actions = document.createElement('div');
        actions.className = 'clear-screen-actions';

        const createActionButton = (label, className, handler) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `level-btn unlocked clear-action-btn ${className}`;
            button.textContent = label;
            button.addEventListener('click', handler);
            return button;
        };

        actions.appendChild(createActionButton('스테이지 선택', 'clear-action-secondary', () => {
            this._openLevelSelect();
        }));
        actions.appendChild(createActionButton('재도전', 'clear-action-secondary', () => {
            overlay.style.display = 'none';
            this._restartLevel();
        }));

        if (this.currentLevel + 1 < LEVELS_DATA.length) {
            actions.appendChild(createActionButton('다음 레벨', 'clear-action-primary', () => {
                overlay.style.display = 'none';
                this._nextLevel();
            }));
        }

        card.appendChild(actions);
        overlay.appendChild(card);
    }
}

// ── Initialize ──
window.addEventListener('DOMContentLoaded', async () => {
    await loadAllLevels();
    window.game = new Game();
});
