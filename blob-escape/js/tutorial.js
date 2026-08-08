class Tutorial {
    constructor() {
        this.overlay = document.getElementById('ui-overlay');
        this.container = null;
        this.onClose = null;
    }

    static ITEMS = {
        movement: {
            id: 'movement',
            label: 'Movement',
            color: '#69F0AE',
            body: '방향키 또는 스와이프로 이동하세요.\n막힐 때까지 미끄러지듯 이동합니다.',
            icons: null,
        },
        rubber_bounce: {
            id: 'rubber_bounce',
            label: 'Rubber bounce',
            color: '#6D4C41',
            body: '고무 벽에 부딪히면 뒤로 튕겨져 나옵니다.\n올바른 방향으로 튕겨져 나오도록 이동하세요.',
            icons: null,
        },
        magnet_metal: {
            id: 'magnet_metal',
            label: 'Magnet + Metal',
            color: '#4FC3F7',
            body: '자석 아이템을 먹으면 철 벽을 지나갈 때 멈출 수 있습니다.\n철 벽을 이용해 목적지로 이동하세요.',
            icons: null,
        },
        fire_block: {
            id: 'fire_block',
            label: 'Fire Block',
            color: '#FF8A65',
            body: '이동 경로에 불 블록이 있으면 그 방향으로 이동할 수 없습니다.\n우회로를 찾아 출구로 이동하세요.',
            icons: null,
        },
        fire_ice_combo: {
            id: 'fire_ice_combo',
            label: 'Fire + Ice',
            color: '#B2EBF2',
            body: '얼음 아이템을 먹으면 불 블록을 식혀 일반 블록으로 바꿀 수 있습니다.',
            icons: [
                { emoji: '🔥', color: '#FF8A65' },
                { emoji: '❄️', color: '#B2EBF2' },
                { emoji: null, color: '#4a4a6a' },
            ],
        },
        electric_door: {
            id: 'electric_door',
            label: 'Electric Door',
            color: '#FFD54F',
            body: '전기 문은 전기 상태가 아니면 통과할 수 없습니다.\n우회로를 찾아 출구로 이동하세요.',
            icons: null,
        },
        electric_combo: {
            id: 'electric_combo',
            label: 'Electric Combo',
            color: '#FFD54F',
            body: '전기 아이템을 먹으면 전기 문을 통과할 수 있습니다.',
            icons: [
                { emoji: '⚡', color: '#FFD54F' },
                { emoji: '🚪', color: '#FFD54F' },
                { emoji: null, color: '#4a4a6a' },
            ],
        },
    };

    show(ids, onClose) {
        this.overlay.innerHTML = '';
        this.overlay.style.display = 'flex';
        this.overlay.style.pointerEvents = 'auto';

        this.container = document.createElement('div');
        this.container.className = 'tutorial-overlay';

        ids.forEach((id) => {
            const item = Tutorial.ITEMS[id];
            if (!item) return;
            const card = document.createElement('div');
            card.className = 'tutorial-card';
            card.style.borderColor = `${item.color}4d`;

            const label = document.createElement('div');
            label.className = 'tutorial-label';
            label.textContent = item.label;
            label.style.color = item.color;
            label.style.textShadow = `0 0 12px ${item.color}66`;
            card.appendChild(label);

            if (item.icons && item.icons.length > 0) {
                const icons = document.createElement('div');
                icons.className = 'tutorial-icons';
                item.icons.forEach((entry, index) => {
                    const icon = document.createElement('div');
                    icon.className = 'tutorial-icon';
                    icon.style.color = entry.color;
                    icon.textContent = entry.emoji || '';
                    icon.style.borderColor = entry.color + '44';
                    icons.appendChild(icon);
                    if (index < item.icons.length - 1) {
                        const arrow = document.createElement('div');
                        arrow.className = 'tutorial-icon-arrow';
                        arrow.textContent = '→';
                        icons.appendChild(arrow);
                    }
                });
                card.appendChild(icons);
            }

            const body = document.createElement('p');
            body.className = 'tutorial-body';
            body.textContent = item.body;
            card.appendChild(body);

            this.container.appendChild(card);
        });

        const hint = document.createElement('div');
        hint.className = 'tutorial-hint';
        hint.textContent = 'Tap or swipe anywhere to continue';
        this.container.appendChild(hint);

        this.overlay.appendChild(this.container);
        this.overlay.addEventListener('click', this._handleCloseBound = this._handleClose.bind(this));
        this.onClose = onClose;
    }

    hide() {
        this.overlay.removeEventListener('click', this._handleCloseBound);
        this.onClose = null;
        this.overlay.style.display = 'none';
        this.overlay.innerHTML = '';
    }

    _handleClose() {
        const cb = this.onClose;
        this.hide();
        if (cb) cb();
    }
}
