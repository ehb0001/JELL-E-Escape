// ── Input Handler ──
// Handles touch swipe and keyboard input for 4-directional movement

class Input {
    constructor(canvas) {
        this.canvas = canvas;
        this.swipeCallback = null;
        this.tapCallback = null;
        this.viewToggleCallback = null; // Tab: switch view axis
        this.viewShiftCallback = null;  // Q/E: shift current view slice by +1/-1
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchStartTime = 0;
        this.minSwipeDistance = 30;
        this.maxSwipeTime = 1000;
        this.enabled = true;

        // [MODIFIED] Tab 롱프레스 -- 짧게 누르면 기존처럼 즉시 전환(keyup 시점), 길게 누르고 있으면
        // 보드 위 마우스가 가리키는 칸에 하이라이트 테두리를 보여주다가 뗄 때 같은 축 전환이 실행됨.
        // 전환 결과(다음 축)는 항상 동일 -- 마우스 위치는 프리뷰 표시용일 뿐 슬라이스/축 선택에 관여하지 않음.
        this.viewTogglePreviewCallback = null; // (active, canvasX, canvasY) => void
        this.tabHoldThreshold = 280; // ms
        this.tabPressed = false;
        this.tabHoldActive = false;
        this.tabHoldTimer = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        // [MODIFIED] 버튼과 동일한 재시작 요청을 물리 키 위치 기준으로 전달하기 위한 전용 콜백
        this.restartCallback = null;

        this._bindEvents();
    }

    onSwipe(callback) {
        this.swipeCallback = callback;
    }

    onTap(callback) {
        this.tapCallback = callback;
    }

    onViewToggle(callback) {
        this.viewToggleCallback = callback;
    }

    onViewShift(callback) {
        this.viewShiftCallback = callback;
    }

    onViewTogglePreview(callback) {
        this.viewTogglePreviewCallback = callback;
    }

    enable() { this.enabled = true; }
    disable() { this.enabled = false; }

    _bindEvents() {
        // Touch
        this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });

        // Mouse (for desktop testing)
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        // [MODIFIED] Tab 롱프레스 중 보드 하이라이트가 마우스를 따라가도록 위치 추적
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));

        // Keyboard
        document.addEventListener('keydown', (e) => this._onKeyDown(e));
        document.addEventListener('keyup', (e) => this._onKeyUp(e));
        // Tab을 누른 채로 브라우저 밖으로 포커스가 나가는 경우(alt-tab 등) 눌림 상태가 끼는 것 방지
        window.addEventListener('blur', () => this._cancelTabHold());
    }

    _onTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
    }

    _onTouchEnd(e) {
        if (!this.enabled) return;
        const touch = e.changedTouches[0];
        this._processSwipe(touch.clientX, touch.clientY);
    }

    _onMouseDown(e) {
        this.touchStartX = e.clientX;
        this.touchStartY = e.clientY;
        this.touchStartTime = Date.now();
    }

    _onMouseUp(e) {
        if (!this.enabled) return;
        this._processSwipe(e.clientX, e.clientY);
    }

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.lastMouseX = e.clientX - rect.left;
        this.lastMouseY = e.clientY - rect.top;
        if (this.tabHoldActive && this.viewTogglePreviewCallback) {
            this.viewTogglePreviewCallback(true, this.lastMouseX, this.lastMouseY);
        }
    }

    _processSwipe(endX, endY) {
        const dx = endX - this.touchStartX;
        const dy = endY - this.touchStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const elapsed = Date.now() - this.touchStartTime;

        if (distance < this.minSwipeDistance) {
            // It's a tap
            if (this.tapCallback && elapsed < this.maxSwipeTime) {
                this.tapCallback(endX, endY);
            }
            return;
        }

        if (elapsed > this.maxSwipeTime) return;

        let direction;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? 'right' : 'left';
        } else {
            direction = dy > 0 ? 'down' : 'up';
        }

        if (this.swipeCallback) {
            this.swipeCallback(direction);
        }
    }

    _onKeyDown(e) {
        if (!this.enabled) return;

        const keyMap = {
            'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
            'w': 'up', 'W': 'up',
            's': 'down', 'S': 'down',
            'a': 'left', 'A': 'left',
            'd': 'right', 'D': 'right',
        };

        const direction = keyMap[e.key];
        if (direction && this.swipeCallback) {
            e.preventDefault();
            this.swipeCallback(direction);
            return;
        }

        // [MODIFIED] 한글 IME에서도 같은 물리 키가 동작하도록 e.key 대신 KeyboardEvent.code를 사용
        if (e.code === 'KeyR') {
            if (this.restartCallback) {
                e.preventDefault();
                this.restartCallback();
            }
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            // [MODIFIED] OS 키 반복 이벤트는 무시하고 실제 첫 keydown에서만 홀드 타이머 시작.
            // 실제 전환은 여기서 바로 쏘지 않고 keyup에서 실행(짧게 누르든 길게 누르든 뗄 때 전환).
            if (e.repeat || this.tabPressed) return;
            this.tabPressed = true;
            this.tabHoldActive = false;
            clearTimeout(this.tabHoldTimer);
            this.tabHoldTimer = setTimeout(() => {
                this.tabHoldActive = true;
                if (this.viewTogglePreviewCallback) {
                    this.viewTogglePreviewCallback(true, this.lastMouseX, this.lastMouseY);
                }
            }, this.tabHoldThreshold);
            return;
        }

        if (e.key === 'q' || e.key === 'Q') {
            if (this.viewShiftCallback) {
                e.preventDefault();
                this.viewShiftCallback(-1);
            }
            return;
        }

        if (e.key === 'e' || e.key === 'E') {
            if (this.viewShiftCallback) {
                e.preventDefault();
                this.viewShiftCallback(1);
            }
            return;
        }
    }

    _onKeyUp(e) {
        if (e.key !== 'Tab') return;
        if (!this.tabPressed) return;

        this.tabPressed = false;
        clearTimeout(this.tabHoldTimer);
        const wasHoldPreview = this.tabHoldActive;
        this.tabHoldActive = false;
        if (wasHoldPreview && this.viewTogglePreviewCallback) {
            this.viewTogglePreviewCallback(false, 0, 0);
        }

        if (!this.enabled) return;
        // [MODIFIED] 롱프레스였다면 뗄 때 마지막 마우스 위치를 새 뷰의 고정 슬라이스 결정에 쓰도록 같이 전달.
        // 짧게 눌렀다면 null -> 기존처럼 주인공 위치 기준.
        if (this.viewToggleCallback) {
            this.viewToggleCallback(wasHoldPreview ? { x: this.lastMouseX, y: this.lastMouseY } : null);
        }
    }

    // Tab을 누른 채로 창 포커스가 나가면(alt-tab 등) 전환은 쏘지 않고 눌림/프리뷰 상태만 정리
    _cancelTabHold() {
        if (!this.tabPressed) return;
        this.tabPressed = false;
        clearTimeout(this.tabHoldTimer);
        const wasHoldPreview = this.tabHoldActive;
        this.tabHoldActive = false;
        if (wasHoldPreview && this.viewTogglePreviewCallback) {
            this.viewTogglePreviewCallback(false, 0, 0);
        }
    }

    onRestart(callback) {
        // New callback registration is kept at the end of the class per repository placement rules.
        this.restartCallback = callback;
    }
}
