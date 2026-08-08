# 구현 프롬프트: 불 블록(FIRE) 추가 + 얼음(ICE) 킥 매커니즘 제거

이 문서는 VS Code AI 에이전트(Claude Code 등)에게 그대로 전달해서 코드를 수정시키기 위한 스펙입니다.
`/mnt/skills` 또는 저장소 루트의 `GUIDELINE.md`(협업 가이드라인)를 먼저 참고하고, 그 규칙(TILE id 예약, switch/객체 리터럴은 마지막 항목 뒤에 추가, 순서 의존성은 `[ORDER-DEPENDENT]` 주석으로 명시, 새 메커니즘은 헬퍼 메서드로 분리)을 따라 아래 작업을 수행해줘.

## 대상 파일
- `blob-escape/js/constants.js`
- `blob-escape/js/game.js`
- `blob-escape/js/level_new.js`
- (필요 시) `blob-escape/js/player.js` — 얼음 관련 시각 효과가 있다면 확인

---

## 작업 1. 얼음(ICE)의 "킥" 매커니즘 완전 제거

### 현재 동작 (제거 대상)
`game.js`에 다음이 구현되어 있음:
- `_movePlayer(direction)` 최상단: `if (this.iceKickWait) { this._resolveIceKick(direction); return; }`
- `_movePlayer` 내부: `const pendingIceKick = hitWallType !== null && startState === STATE.ICE;` 및 `doSecondaryMove` 안의 `else if (pendingIceKick) { this._enterIceKickWait(x, y, z, direction); }` 분기
- 메서드 `_enterIceKickWait(x, y, z, incomingDirection)`
- 메서드 `_resolveIceKick(direction)`

### 요구 동작
얼음 상태는 더 이상 벽 충돌 시 별도의 "대기 후 꺾기" 능력을 갖지 않는다. **얼음 상태에서 벽에 부딪히는 것은 NORMAL 상태와 완전히 동일하게 처리**되어야 한다(그냥 그 자리에서 멈추고, 기존 벽 충돌 이펙트/사운드 재생).

### 수정 지시
1. `_movePlayer` 최상단의 `iceKickWait` 체크 블록 삭제.
2. `pendingIceKick` 변수 선언과 `doSecondaryMove` 안의 `else if (pendingIceKick) {...}` 분기 삭제. 삭제 후에는 `if (bounceX !== x || ...) {...} else { finishMove(); }` 형태로 단순화되어야 함(고무 튕김 여부만 분기).
3. `_enterIceKickWait`, `_resolveIceKick` 메서드 전체 삭제.
4. `constants.js`의 `ICE_SLIP` 상수는 이 두 메서드 삭제 후 더 이상 어디서도 참조되지 않는지 저장소 전체에서 확인(`grep -r "ICE_SLIP"`)하고, 미사용이 확인되면 삭제. 확실하지 않으면 `GUIDELINE.md`의 "레거시 보존" 규칙에 따라 `[DEPRECATED-TENTATIVE]` 주석과 함께 남겨둘 것.
5. `player.js`에 `STATE.ICE` 전용 킥 대기 시각 효과(예: 대기 중 표시)가 있다면 함께 제거. 없다면 스킵.

---

## 작업 2. 불 블록(FIRE) 신규 타일 추가

### 확정된 규칙
- 젤리는 스와이프 시 막힐 때까지 한 방향으로 쭉 미끄러지는 이동 방식을 가진다.
- **이번 스와이프로 실제 도달하게 될 최종 지점까지의 경로(자석 상태라면 자석 정지 지점 반영된 축소 경로)** 안에 불 블록이 하나라도 있으면, **그 스와이프는 완전히 무효(0칸 이동)**가 된다. 접촉 여부와 무관하다 — 불 블록이 경로 중간 어디에 있든(1칸 앞이든 10칸 앞이든) 결과는 같다.
- 반대로, 원래 더 가까운 철 벽(자석 상태) 때문에 애초에 불 블록에 도달하지도 않는 상황이라면 불 블록은 아무 영향이 없다 — 평소처럼 자석 정지 지점까지 정상 이동한다.
- 고무 튕김, (제거된) 얼음 킥처럼 1차 슬라이드 이후의 파생 이동은 별도로 다시 스캔할 필요 없음 — 1차 슬라이드(자석 정지 반영) 경로만 검사 대상.
- 막혔을 때의 별도 피드백(전용 이펙트/사운드/화면 효과)은 이번 작업 범위 아님 — 지금은 그냥 아무 일도 안 일어나는 것(0칸 이동, 기존 사운드/파티클 없음)으로 구현.

### ⚠️ 구현 시 반드시 지킬 것 — 흔히 하는 실수
**불 블록을 `isBlocking()`에 추가하지 말 것.** `isBlocking()`에 추가하면 기존 이동 루프가 "막히는 타일 앞에서 멈추는" 방식이라, 불 블록도 그냥 일반 벽처럼 그 앞까지는 이동해버리는 결과가 된다. 이건 요구사항(그 방향 자체가 통째로 무효)과 다르다.

대신 다음 2단계 구조로 구현한다:
1. **기존 이동 루프는 그대로 둔다.** 이 루프는 불 블록을 인식하지 못하고 그냥 통과해서, 원래 자석/벽 규칙만으로 계산된 "raw 도달 지점"을 구한다(자석 정지 반영 포함, 지금 로직 그대로).
2. 그 raw 도달 지점이 정해진 뒤, **별도의 새 헬퍼 메서드**로 시작 지점부터 그 도달 지점까지(도달 지점 포함) 구간을 순회하며 `TILE.FIRE`가 있는지 검사한다. 있으면:
   - 얼음 상태가 아니면: 이동 자체를 취소(사운드/파티클/moveCount 증가/아이템 소비 전부 발생시키지 않고 그냥 `return`).
   - 얼음 상태이면: 작업 3 참고.

### `constants.js` 수정
- `TILE`에 `FIRE: 6` 추가(마지막 항목 뒤, 기존 값과 겹치지 않게 — 6~9가 비어있는 걸 확인함).
- `CHAR_TO_TILE`에 `'F': TILE.FIRE` 추가.
- `TILE_COLORS`에 `[TILE.FIRE]` 항목 추가(정확한 색상/그라디언트는 팀 확인 후 결정 — 우선 다른 벽류와 구분되는 값으로 플레이스홀더 작성, 예: 톤은 주황/빨강 계열).
- `isBlocking()`은 수정하지 않는다(위 경고 참고). FIRE는 이 함수의 판단 대상이 아님.

### `level_new.js` (`Level` 클래스) 수정
- 필드 추가: `this.extinguishedFire = new Set();` (`consumedItems`, `openedDoors`와 동일한 위치/패턴으로 constructor에 추가).
- `load()` 안에서 `this.consumedItems = new Set();` 옆에 `this.extinguishedFire = new Set();` 초기화 추가.
- 메서드 추가(파일 끝, 또는 `openDoor`/`triggerRubberBounce` 근처에 같은 스타일로): 
  ```javascript
  extinguishFire(x, y, z = this.viewZ) {
      this.extinguishedFire.add(`${x},${y},${z}`);
  }
  ```
- `getTile(x, y, z)` 수정: `consumedItems` 체크와 같은 자리에 `extinguishedFire` 체크 추가 — 꺼진 불 블록은 `TILE.WALL`을 반환하도록 한다.
  ```javascript
  const key = `${x},${y},${z}`;
  if (this.extinguishedFire.has(key)) return TILE.WALL;
  if (this.consumedItems.has(key)) return TILE.FLOOR;
  return this.grid[z][y][x];
  ```
- `_renderTile()`의 `switch (tile)`에 `case TILE.FIRE:` 추가(기존 마지막 case 뒤, `default` 위). `_renderGradientTile` 패턴을 참고해서 시각적으로 열기/불꽃 느낌을 표현. 꺼진 이후에는 `getTile`이 `TILE.WALL`을 반환하므로 별도 "꺼진 불" 렌더 케이스는 필요 없다(자동으로 일반 벽으로 그려짐).

### `game.js` 수정
- `_movePlayer` 안, 기존 `while (true) {...}` 슬라이드/자석 루프가 끝나고 `x, y, z`(최종 raw 도달 지점)가 확정된 직후 지점에 아래 로직을 삽입 — **반드시 아이템 소비 스캔(`itemsConsumed`)이나 고무 튕김 계산보다 먼저**:
  ```javascript
  // [ORDER-DEPENDENT] 자석 정지 반영이 끝난 최종 x,y,z가 확정된 뒤에만 스캔해야 함.
  // 철 벽이 불 블록보다 가까우면 자석이 먼저 멈추므로 불 블록은 스캔 범위 밖이 됨.
  const firePos = this._scanForFire(startX, startY, startZ, x, y, z, dx, dy, dz);
  if (firePos) {
      if (startState === STATE.ICE) {
          this.level.extinguishFire(firePos.x, firePos.y, firePos.z);
          // 소화 즉시 얼음 상태 소모
          this.player.changeState(STATE.NORMAL, null, undefined, undefined);
          // 방금 꺼진 타일이 이제 WALL이므로, 같은 방향으로 이동 판정을 다시 계산한다.
          // (재귀 호출 또는 루프 재실행 — 아래 "재계산" 섹션 참고)
      } else {
          return; // 이동 전체 무효
      }
  }
  ```
- 새 헬퍼 메서드 `_scanForFire(startX, startY, startZ, endX, endY, endZ, dx, dy, dz)`를 `_movePlayer` 근처(파일 내 새 메서드 추가 위치 규칙에 따라 클래스 하단 또는 관련 메서드 바로 아래)에 정의. 시작 지점 다음 칸부터 도달 지점까지(포함) 한 칸씩 순회하며 `this.level.getTile(nx, ny, nz) === TILE.FIRE`인 첫 좌표를 찾아 반환(없으면 `null`).

### 재계산(얼음이 불을 끈 경우)
불을 끈 뒤에는 그 좌표가 `TILE.WALL`이 되므로(위 `getTile` 수정으로 자동 반영), **기존 이동 판정 루프(자석 스냅 포함)를 처음부터 다시 실행**하면 자연스럽게 그 벽 앞에서 멈추는 결과를 얻는다. 별도로 거리를 손으로 계산해 자르지 말고, `_movePlayer`의 핵심 루프 부분을 별도 헬퍼로 뽑아서(`_resolveSlide(startX, startY, startZ, dx, dy, dz, state)` 같은 이름) 최초 계산과 소화 후 재계산 양쪽에서 재사용하는 구조를 권장한다. 이렇게 하면 "철 벽이 불 탄 자리보다 더 앞에 있는 경우" 같은 예외 케이스도 같은 코드로 자동 처리된다.

---

## 작업 3. 얼음 ↔ 불 블록 상호작용 요약 (참고용 재정리)

- 얼음 상태로 스와이프했는데 raw 경로 안에 불 블록이 있으면: 그 스와이프 안에서 **즉시** ① 가장 가까운 불 블록 1개를 소화(영구히 벽으로 전환) → ② 얼음 상태 소모(NORMAL로 전환) → ③ 같은 방향으로 이동을 다시 계산해서, 원래는 통째로 막혔던 방향으로 (불이 있던 자리 앞까지) 실제로 이동한다. 한 스와이프 안에서 전부 처리되며, 다음 턴을 따로 기다리지 않는다.
- 이후 그 좌표는 어떤 상태로 지나가든 그냥 일반 벽으로 취급된다.

---

## ⚠️ 팀 확인이 필요한 가정 (구현 전 재확인 권장)

아래 항목들은 지금까지의 논의를 바탕으로 한 합리적 추정이지 100% 명시적으로 재확인된 내용은 아닙니다. 에이전트가 구현을 시작하기 전에, 혹은 구현 직후 사람이 리뷰할 때 아래를 짚어보는 게 좋습니다.

1. **소화된 불 블록이 `WALL`로 변하는 것이 최종 결론인지** — 초반 논의에서는 "FLOOR로 바꿔서 착지 가능하게" 하자는 의견도 나왔었는데, 이후 불 블록의 실제 동작(접촉이 아니라 경로 전체를 막는 방식)이 확정되면서 "완전히 막혔던 방향이 뚫린다"는 효과를 내려면 WALL 전환이 맞다고 판단해서 이 문서에 반영했습니다. 다만 이게 마지막에 명시적으로 재확인된 문장은 아니라서, 최종 확정 짓고 진행하는 걸 권장합니다.
2. **한 경로에 불 블록이 여러 개 있을 경우** — 이 문서는 "가장 가까운 것 1개만 소화"로 가정했습니다(소화 후 재계산하면 그 지점에서 멈추므로 더 먼 불 블록은 애초에 스캔 범위 밖이 되어 자연히 해결됨). 별도 확인 불필요할 가능성이 높지만 명시해둡니다.
3. **막혔을 때의 피드백**은 이번 작업 범위에서 제외한다고 하셨으므로 구현하지 않았습니다. 추후 별도 요청 시 진행.
4. **불 블록의 시각 디자인(색상/아이콘/애니메이션)**은 기능 구현을 막지 않는 선에서 플레이스홀더로 처리했습니다. 팀 확인 후 `TILE_COLORS[TILE.FIRE]` 값을 다듬어야 합니다.
5. **레벨 데이터**: 현재 레벨(1~37)에는 불 블록이 없으므로 이 작업만으로는 실제 플레이에서 아무 변화가 없습니다. 테스트하려면 임시로 레벨 JSON 하나에 `'F'` 문자를 넣어서 확인이 필요합니다(이후 레벨은 AI로 재제작 예정이므로 기존 파일을 영구 수정할 필요는 없음).
