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

        // Keyboard
        document.addEventListener('keydown', (e) => this._onKeyDown(e));
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

        if (e.key === 'Tab') {
            if (this.viewToggleCallback) {
                e.preventDefault();
                this.viewToggleCallback();
            }
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
}
