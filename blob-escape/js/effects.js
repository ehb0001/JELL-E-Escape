// ── Effects System ──
// Particle effects + Procedural audio via Web Audio API

// ─────────────── PARTICLES ───────────────

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = 0; this.y = 0;
        this.vx = 0; this.vy = 0;
        this.life = 0; this.maxLife = 1;
        this.size = 3; this.startSize = 3;
        this.color = '#fff';
        this.alpha = 1;
        this.active = false;
        this.gravity = 0;
        this.friction = 0.98;
        this.shrink = true;
    }

    update(dt) {
        if (!this.active) return;
        this.life -= dt;
        if (this.life <= 0) { this.active = false; return; }

        this.vx *= this.friction;
        this.vy *= this.friction;
        this.vy += this.gravity * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const lifeRatio = this.life / this.maxLife;
        this.alpha = lifeRatio;
        if (this.shrink) this.size = this.startSize * lifeRatio;
    }

    render(ctx) {
        if (!this.active) return;
        ctx.save();
        ctx.globalAlpha = this.alpha * 0.8;
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = this.size * 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class ParticleSystem {
    constructor(poolSize = 300) {
        this.pool = [];
        for (let i = 0; i < poolSize; i++) {
            this.pool.push(new Particle());
        }
    }

    _getParticle() {
        for (const p of this.pool) {
            if (!p.active) return p;
        }
        return null;
    }

    emit(x, y, color, count = 10, config = {}) {
        for (let i = 0; i < count; i++) {
            const p = this._getParticle();
            if (!p) break;
            p.reset();
            p.active = true;
            p.x = x + (Math.random() - 0.5) * (config.spread || 10);
            p.y = y + (Math.random() - 0.5) * (config.spread || 10);
            const angle = Math.random() * Math.PI * 2;
            const speed = (config.speed || 80) * (0.5 + Math.random() * 0.5);
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.life = (config.life || 0.8) * (0.5 + Math.random() * 0.5);
            p.maxLife = p.life;
            p.size = (config.size || 4) * (0.5 + Math.random());
            p.startSize = p.size;
            p.color = color;
            p.gravity = config.gravity || 0;
            p.friction = config.friction || 0.96;
            p.shrink = config.shrink !== false;
        }
    }

    // Burst explosion for state change
    burstStateChange(x, y, color) {
        this.emit(x, y, color, 25, { speed: 150, life: 0.7, size: 5, spread: 5 });
    }

    // Trail particles behind moving player
    emitTrail(x, y, color) {
        this.emit(x, y, color, 2, { speed: 20, life: 0.4, size: 3, spread: 8, friction: 0.9 });
    }

    emitIceTrail(x, y) {
        this.emit(x, y, '#B2EBF2', 1, { speed: 5, life: 0.8, size: 4, spread: 4, friction: 0.8 });
    }

    // Door opening particles
    burstDoorOpen(x, y, color) {
        this.emit(x, y, color, 20, { speed: 120, life: 0.6, size: 4, spread: 8 });
    }

    // Portal swirl particles
    emitPortalSwirl(x, y, time) {
        const angle = time * 3;
        const radius = 15 + Math.sin(time * 5) * 5;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        this.emit(px, py, '#E040FB', 1, { speed: 10, life: 0.6, size: 3, spread: 3 });

        const px2 = x + Math.cos(angle + Math.PI) * radius;
        const py2 = y + Math.sin(angle + Math.PI) * radius;
        this.emit(px2, py2, '#EA80FC', 1, { speed: 10, life: 0.6, size: 2, spread: 3 });
    }

    // Level clear celebration
    burstCelebration(x, y) {
        const colors = ['#FFD54F', '#FF8A65', '#4FC3F7', '#69F0AE', '#E040FB', '#B2EBF2'];
        for (let i = 0; i < 6; i++) {
            setTimeout(() => {
                this.emit(
                    x + (Math.random() - 0.5) * 100,
                    y + (Math.random() - 0.5) * 100,
                    colors[i], 15,
                    { speed: 200, life: 1.2, size: 6, gravity: 80 }
                );
            }, i * 80);
        }
    }

    // Wall hit particles
    burstWallHit(x, y, wallType) {
        const colors = {
            [TILE.WALL]: '#5a5a7a',
            [TILE.METAL_WALL]: '#90A4AE',
            [TILE.RUBBER_WALL]: '#A1887F',
            [TILE.ELECTRIC_DOOR]: '#FFF9C4',
        };
        const color = colors[wallType] || '#5a5a7a';
        this.emit(x, y, color, 8, { speed: 60, life: 0.4, size: 3, spread: 6 });
    }

    // Electric sparks
    emitSparks(x, y) {
        for (let i = 0; i < 3; i++) {
            const p = this._getParticle();
            if (!p) break;
            p.reset();
            p.active = true;
            p.x = x + (Math.random() - 0.5) * 20;
            p.y = y + (Math.random() - 0.5) * 20;
            const angle = Math.random() * Math.PI * 2;
            p.vx = Math.cos(angle) * 200;
            p.vy = Math.sin(angle) * 200;
            p.life = 0.15 + Math.random() * 0.15;
            p.maxLife = p.life;
            p.size = 1.5 + Math.random() * 1.5;
            p.startSize = p.size;
            p.color = Math.random() > 0.5 ? '#FFF9C4' : '#FFEB3B';
            p.friction = 0.85;
            p.shrink = false;
        }
    }

    update(dt) {
        for (const p of this.pool) {
            p.update(dt);
        }
    }

    render(ctx) {
        for (const p of this.pool) {
            p.render(ctx);
        }
    }
}


// ─────────────── AUDIO ───────────────

class Audio {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.masterVolume = 0.3;
        this._initOnInteraction();
    }

    _initOnInteraction() {
        const initAudio = () => {
            if (!this.ctx) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        };
        document.addEventListener('touchstart', initAudio, { once: false });
        document.addEventListener('mousedown', initAudio, { once: false });
        document.addEventListener('keydown', initAudio, { once: false });
    }

    _createOsc(freq, type, duration, volume = 1) {
        if (!this.ctx || !this.enabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = this.masterVolume * volume;
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    _createNoise(duration, volume = 0.1) {
        if (!this.ctx || !this.enabled) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.5;
        }
        const source = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        source.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = 3000;
        gain.gain.value = this.masterVolume * volume;
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        source.start();
    }

    playMove() {
        this._createOsc(300, 'sine', 0.08, 0.3);
        setTimeout(() => this._createOsc(400, 'sine', 0.06, 0.2), 30);
    }

    playHitWall(wallType) {
        switch (wallType) {
            case TILE.METAL_WALL:
                this._createOsc(800, 'triangle', 0.15, 0.4);
                this._createOsc(1200, 'sine', 0.1, 0.2);
                break;
            case TILE.RUBBER_WALL:
                this._createOsc(200, 'triangle', 0.2, 0.4);
                setTimeout(() => this._createOsc(250, 'triangle', 0.15, 0.3), 50);
                break;
            case TILE.ELECTRIC_DOOR:
                this._createNoise(0.15, 0.2);
                this._createOsc(600, 'sawtooth', 0.1, 0.3);
                break;
            default:
                this._createOsc(150, 'square', 0.08, 0.2);
                break;
        }
    }

    playStateChange() {
        const t = this.ctx ? this.ctx.currentTime : 0;
        this._createOsc(400, 'sine', 0.3, 0.3);
        setTimeout(() => this._createOsc(600, 'sine', 0.25, 0.25), 60);
        setTimeout(() => this._createOsc(800, 'sine', 0.2, 0.2), 120);
    }

    playDoorOpen() {
        this._createOsc(300, 'sine', 0.15, 0.3);
        setTimeout(() => this._createOsc(500, 'sine', 0.2, 0.3), 80);
        setTimeout(() => this._createOsc(700, 'sine', 0.25, 0.2), 160);
    }

    playClear() {
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            setTimeout(() => {
                this._createOsc(freq, 'sine', 0.4, 0.35);
                this._createOsc(freq * 1.5, 'sine', 0.3, 0.15);
            }, i * 120);
        });
    }

    playPortalHum(time) {
        // Called periodically for ambient portal sound - very subtle
        if (Math.random() > 0.05) return; // Only occasionally
        this._createOsc(200 + Math.sin(time) * 50, 'sine', 0.3, 0.05);
    }

    playButtonClick() {
        this._createOsc(600, 'sine', 0.06, 0.25);
        this._createOsc(900, 'sine', 0.04, 0.15);
    }

    playRestart() {
        this._createOsc(400, 'sine', 0.1, 0.2);
        setTimeout(() => this._createOsc(300, 'sine', 0.15, 0.2), 80);
    }
}
