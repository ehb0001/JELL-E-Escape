class Tutorial {
    constructor() {
        this.overlay = document.getElementById('ui-overlay');
        this.container = null;
        this.onClose = null;
        this.cards = [];
        this.index = 0;
    }

    // [MODIFIED] 카드가 여러 개면 한 화면에 다 띄우지 않고 한 장씩 순차로 보여줌 -- 탭/클릭하면 다음
    // 카드로 넘어가고, 마지막 카드에서 탭하면 그제서야 닫힘(onClose 호출).
    show(cards, onClose) {
        this.cards = cards.filter(Boolean);
        this.index = 0;
        this.onClose = onClose;

        this.overlay.innerHTML = '';
        // [MODIFIED] 레벨 선택 화면이 남겼을 수 있는 배경-클릭-닫기 리스너(overlay.onclick)가 섞여
        // 실행되지 않도록 명시적으로 해제
        this.overlay.onclick = null;
        this.overlay.style.display = 'flex';
        this.overlay.style.pointerEvents = 'auto';
        // [MODIFIED] 튜토리얼 카드가 떠 있는 동안만 뒷배경 블러/불투명도를 낮춰서 카드 뒤 게임 화면이
        // 더 잘 비치게 함(레벨 선택 등 #ui-overlay를 공유하는 다른 화면에는 영향 없음)
        this.overlay.classList.add('ui-overlay-tutorial');
        this.overlay.addEventListener('click', this._handleCloseBound = this._handleAdvance.bind(this));

        this._renderCurrent();
    }

    _renderCurrent() {
        const item = this.cards[this.index];
        if (!item) {
            this.hide();
            return;
        }

        this.container = document.createElement('div');
        this.container.className = 'tutorial-overlay';

        const color = item.color || '#69F0AE';
        const card = document.createElement('div');
        card.className = 'tutorial-card';
        card.style.borderColor = `${color}4d`;

        const label = document.createElement('div');
        label.className = 'tutorial-label';
        label.textContent = item.title;
        label.style.color = color;
        label.style.textShadow = `0 0 12px ${color}66`;
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
        // [MODIFIED] 레벨 JSON의 body 텍스트에서 **강조** 구간을 <b>로 렌더링할 수 있도록 지원.
        // 이스케이프 후 마크업을 적용하므로 body에 실제 HTML 태그를 넣어도 그대로 문자로 표시됨.
        body.innerHTML = this._formatBody(item.body);
        card.appendChild(body);

        this.container.appendChild(card);

        const isLast = this.index >= this.cards.length - 1;
        const hint = document.createElement('div');
        hint.className = 'tutorial-hint';
        // [MODIFIED] Input.onAdvance 추가로 아무 키나 눌러도 넘어가므로 안내 문구에도 반영
        hint.textContent = isLast
            ? 'Press any key'
            : `Press any key (${this.index + 1}/${this.cards.length})`;
        this.container.appendChild(hint);

        this.overlay.innerHTML = '';
        this.overlay.appendChild(this.container);
    }

    _handleAdvance() {
        this.index += 1;
        if (this.index >= this.cards.length) {
            this._handleClose();
            return;
        }
        this._renderCurrent();
    }

    hide() {
        this.overlay.removeEventListener('click', this._handleCloseBound);
        this.onClose = null;
        this.overlay.style.display = 'none';
        this.overlay.classList.remove('ui-overlay-tutorial');
        this.overlay.innerHTML = '';
    }

    // [MODIFIED] "**굵게**" 구간을 <b>로, 줄바꿈(\n)을 <br>로 변환. 원본 텍스트는 먼저 이스케이프해서
    // body에 실제 HTML 태그가 들어와도 무해한 텍스트로만 취급됨.
    _formatBody(text) {
        const escaped = String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return escaped
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/\n/g, '<br>');
    }

    _handleClose() {
        const cb = this.onClose;
        this.hide();
        if (cb) cb();
    }
}
