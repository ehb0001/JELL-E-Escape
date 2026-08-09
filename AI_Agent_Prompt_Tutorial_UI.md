# 구현 프롬프트: 튜토리얼 설명 패널 UI

`blob-escape` 프로젝트에 튜토리얼 설명 패널 UI를 구현하는 작업이다. 이 문서는 화면에 어떻게 보여줄지(비주얼/컴포넌트)만 다룬다 — 튜토리얼 맵 자체의 내용/검증은 별도 문서(`AI_Agent_Prompt_Tutorial_Solver.md`)를 참고할 것.

## 디자인 원칙

**새로운 디자인 언어를 만들지 말고, `blob-escape/css/style.css`에 이미 있는 스타일을 재사용한다.** 구체적으로:

- 패널 카드: `.level-btn`과 동일한 톤 — `border-radius: 12px`, `background: rgba(37, 37, 64, 0.6)`, `border: 1px solid` (색상만 아이템/블록 종류에 따라 다르게)
- 라벨 텍스트("FIRE BLOCK" 같은 상단 소제목): `.level-select-title`과 동일한 톤 — `font-weight: 700`, `text-shadow`로 글로우, `letter-spacing: 3px`, `text-transform: uppercase`
- 폰트: 이미 `style.css` 최상단에 `@import`로 Orbitron이 로드되어 있으니 별도 로드 불필요, 그대로 `font-family: 'Orbitron', sans-serif` 사용
- 배경: `#0a0a1a` (기존 `html, body` 배경과 동일)

**색상은 새로 정의하지 말고 아이템/상태 종류에 맞는 기존 색상을 그대로 가져다 쓴다.**
- 이동(아이템 없음) 튜토리얼: `#69F0AE` (NORMAL, 기존 `.level-select-title`과 동일 색)
- 자석 + 철벽: `#4FC3F7` (`STATE_INFO[STATE.MAGNET].color`)
- 불 블록: `#FF8A65` (신규 지정 — `TILE_COLORS[TILE.FIRE]`와 통일시킬 것)
- 얼음: `#B2EBF2` (`STATE_INFO[STATE.ICE].color`)
- 전기 문 / 전기 아이템: `#FFD54F` (`STATE_INFO[STATE.ELECTRIC].color`)

## 컴포넌트 구조

새 클래스 `Tutorial`을 만든다 (파일 위치는 `blob-escape/js/tutorial.js` 신규 생성 후 `index.html`의 `<script>` 목록에 다른 스크립트들보다 뒤, `game.js`보다는 앞에 추가).

각 튜토리얼 항목은 다음 구조의 데이터로 정의한다:
```javascript
{
    id: 'fire_block',
    label: 'Fire block',
    color: '#FF8A65',
    body: '이동 경로에 불 블록이 있으면 그 방향으로 이동할 수 없습니다.\n우회로를 찾아 출구로 이동하세요.',
    icons: null // 또는 콤보 아이템일 경우 아래 icons 참고
}
```
콤보(아이템+블록 상호작용) 항목은 `icons` 필드에 3개 아이콘(원인 → 원인 → 결과)을 넣어서, 첨부 이미지처럼 원형 아이콘 3개 + 화살표로 표시한다:
```javascript
icons: [
    { emoji: '🔥', color: '#FF8A65' },
    { emoji: '❄️', color: '#B2EBF2' },
    { emoji: null, color: '#4a4a6a' } // 결과: 빈 원 (일반 블록이 됨을 표현)
]
```

## 렌더링 방식

기존 `#ui-overlay`(현재 레벨 선택 화면에 쓰이는 것과 같은 DOM 오버레이)를 재사용한다. 새 `<div class="tutorial-overlay">`를 그 안에 만들고, 위 데이터 구조를 순서대로 카드로 렌더링한다. 카드 HTML 구조:

```html
<div class="tutorial-label" style="color: {color}; text-shadow: 0 0 12px {color}66;">{label}</div>
<div class="tutorial-card" style="border-color: {color}4d;">
  <!-- icons가 있으면 -->
  <div class="tutorial-icons">...</div>
  <p class="tutorial-body">{body}</p>
</div>
```

`.tutorial-label`, `.tutorial-card`, `.tutorial-icons`, `.tutorial-body` 클래스는 `style.css`에 새로 추가하되, 위 "디자인 원칙"에 명시한 값(12px 라운드, rgba(37,37,64,0.6) 배경 등)을 그대로 따른다. 색상은 인라인 스타일로 넘기는 방식(위 예시처럼)으로 처리해서 클래스 자체는 색상 중립적으로 만든다.

## 트리거 / 흐름

- 레벨 JSON에 `"tutorial": ["fire_block"]`처럼 필드를 추가해서, 해당 스테이지 진입 시 어떤 튜토리얼 항목을 보여줄지 지정한다. 배열이므로 한 스테이지에 여러 항목(예: 6번 스테이지라면 전기 문+전기 아이템 콤보 하나)을 넣을 수 있다.
- `Game`이 레벨을 로드할 때(`_loadLevel` 등 기존 레벨 진입 로직) `levelData.tutorial`이 존재하면 `Tutorial.show(levelData.tutorial)`를 호출하고 `GAME_STATE.PLAYING`으로 전환하지 않고 대기.
- 패널은 탭/스와이프 아무 입력이나 받으면 닫히고 그때 `GAME_STATE.PLAYING`으로 전환 + 기존 이동 입력이 활성화되도록 한다. (지금 `Input` 클래스의 `onTap`/`onSwipe`를 그대로 활용)

## 아이콘/미니 데모 관련 참고

지금 단계에서는 정적 이모지 아이콘(🔥❄️) + 화살표로 표현하는 버전(V1)으로 구현한다. 실제 게임 렌더링 엔진으로 젤리가 움직이는 걸 보여주는 애니메이션 데모(캔버스에 축소된 미니 그리드를 그려서 실제 이동을 재생하는 방식)는 V1이 별로면 넘어갈 스트레치 목표로 남겨두고, 지금은 구현하지 않는다.

## 각 튜토리얼 항목 텍스트 (초안)

아래 중 "불 블록"/"얼음" 항목만 실제로 확정된 문구이고, 나머지는 같은 톤으로 맞춘 초안이니 진행 전에 문구를 확인받을 것.

1. **이동** (`movement`, 색 `#69F0AE`) — "방향키 또는 스와이프로 이동하세요. 막힐 때까지 미끄러지듯 이동합니다." *(초안)*
2. **자석 + 철벽** (`magnet_metal`, 색 `#4FC3F7`) — "자석 아이템을 먹으면 철 벽 주변을 지날 때 그 자리에 달라붙습니다." *(초안)*
3. **불 블록** (`fire_block`, 색 `#FF8A65`) — "이동 경로에 불 블록이 있으면 그 방향으로 이동할 수 없습니다.\n우회로를 찾아 출구로 이동하세요." *(확정)*
4. **불 블록 + 얼음** (`fire_ice_combo`, 색 `#B2EBF2`) — "얼음 아이템을 먹을 경우 불 블록을 식혀 일반 블록으로 되돌릴 수 있습니다." *(확정)*
5. **전기 문** (`electric_door`, 색 `#FFD54F`) — "전기 문은 전기 상태가 아니면 통과할 수 없습니다.\n우회로를 찾아 출구로 이동하세요." *(초안)*
6. **전기 문 + 전기 아이템** (`electric_combo`, 색 `#FFD54F`) — "전기 아이템을 먹으면 전기 문을 통과할 수 있습니다." *(초안)*
