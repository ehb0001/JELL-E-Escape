# JELL-E: Escape the Lab 

바닐라 JS + Canvas 2D로 만든 모바일 퍼즐 게임. 젤리 캐릭터를 스와이프로 밀어서 그리드를 이동하며, 특정 벽에 부딪히면 파워(상태)를 얻어 다른 장애물을 넘고 포탈에 도달하면 스테이지 클리어.

- 실행: `blob-escape/index.html`을 정적 서버로 서빙 (레벨 데이터를 fetch로 로드하므로 `file://` 직접 열기는 불가 — `python3 -m http.server` 등 사용)
- 소스: `blob-escape/js/` (game.js, level_new.js, player.js, input.js, effects.js, constants.js)
- 레벨 데이터: `blob-escape/levels/level_*.json` + `manifest.json`

## 아이템

| 아이템 | 부여 상태 | 트리거 조건 | 결과 동작 | 턴 소비 |
|---|---|---|---|---|
| 🧲 자석 | MAGNET | 이동 중 옆 칸에 금속벽이 스치면 | 그 자리에서 즉시 정지 + 충돌 이펙트 | 정상 이동의 일부 |
| ❄️ 얼음 | ICE | 이동 중 벽에 정면 충돌하면 | 조용히 멈춘 뒤 입력 대기 → 좌/우 한 칸 꺾임(또는 충돌) | 꺾기 자체는 턴 미소비 |
| ⚡ 전기 | ELECTRIC | 전기문에 도달하면 | 문을 통과, 상태 NORMAL로 리셋 | 정상 이동의 일부 |

지형 오브젝트로 고무벽(`R`)도 있음 — 상태 무관하게 부딪히면 뒤로 최대 2칸 튕겨나감.

## 변경 이력

### 1. 맵 데이터 구조 분리 (하드코딩 → JSON 파일)

**이전:** `js/level_new.js`에 `LEVELS_DATA` 배열로 30개 레벨이 하드코딩되어 있었음.

**이후:**
- `levels/level_01.json` ~ `level_30.json` — 레벨 하나당 파일 하나
  - 필드는 기존과 동일: `{ id, name, subtitle, map }`
  - `map`은 문자열 리스트(`["...", "..."]`) 형태 유지 (확장 대비)
- `levels/manifest.json` — 로드할 레벨 파일명 목록
- `js/level_new.js` — `loadAllLevels()` 함수 추가. manifest를 fetch한 뒤 각 레벨 JSON을 fetch해서 `LEVELS_DATA` 배열을 채움 (id 기준 정렬)
- `js/game.js` — `DOMContentLoaded` 핸들러가 `await loadAllLevels()` 후 `new Game()` 생성하도록 변경 (비동기 초기화)

**주의:** `file://`로 열면 fetch가 CORS로 막히므로 반드시 로컬 서버(`python3 -m http.server` 등)로 실행해야 함.

**레벨 추가 방법:** 새 `level_XX.json` 생성 + `manifest.json`에 파일명 추가. 자동 디렉토리 스캔은 지원하지 않음(정적 파일 서버 구조상 불가) — manifest 수동 관리로 결정.

### 2. 자석(Magnet) 아이템 동작 변경

**아이템:** `m` → `STATE.MAGNET`

| 구분 | 내용 |
|---|---|
| 원래 동작 | 이동 방향의 반대편에 금속벽(`METAL_WALL`)이 있으면, 그 벽 앞 3칸 지점까지 자동으로 당겨져 이동 (`_movePlayer`의 사전 스캔 로직) |
| 바뀐 동작 | 이동 중 지나가는 각 칸의 옆(진행 방향 기준 좌/우, perpendicular)에 금속벽이 있으면 그 칸에서 즉시 정지. 정지 시 기존 금속벽 충돌 이펙트(파티클 `burstWallHit`, 사운드 `playHitWall`, 화면흔들림)를 그대로 재사용 |

**구현 위치:** `js/game.js` `_movePlayer()` 이동 루프 내부. 기존 "반대편 벽까지 당겨짐" 사전 스캔 로직(`magnetStopX/Y`)을 제거하고, 이동 루프 안에서 매 칸 진입 시 좌우 인접 타일을 검사하는 방식으로 교체.

### 3. 얼음(Ice) 아이템 동작 변경

**아이템:** `i` → `STATE.ICE`

| 구분 | 내용 |
|---|---|
| 원래 동작 | 벽에 부딪히면 오른쪽 우선(막히면 왼쪽)으로 자동 90도 꺾여서, 다시 막힐 때까지 그 방향으로 쭉 미끄러짐 |
| 바뀐 동작 | 벽에 부딪히면 **이펙트 없이** 조용히 멈추고 입력 대기 상태(`iceKickWait`)로 전환. 다음 스와이프 입력이: <br>• 진행 방향/반대 방향이면 → 무시, 계속 대기 <br>• 좌/우(수직) 방향이면 → 그 방향으로 **한 칸만** 이동 시도 <br>　- 막혀 있으면 벽 충돌 이펙트만 재생하고 제자리, 대기 해제(턴 종료) <br>　- 뚫려 있으면 한 칸 이동 + 이동 이펙트, 그 칸에 아이템이 있으면 일반 이동처럼 소비하고 상태 전환, 전기문이면 통과 처리 |

**핵심 변경점:**
- 자동 슬라이드 제거 → 유저 입력 기반 "한 칸 꺾기"로 변경
- 꺾기 이동은 **턴을 소비하지 않음** (별도 move count 증가 없음)
- 얼음 아이템 자체의 소비 시점은 기존과 동일(밟는 순간 소비), 이번에 추가된 건 꺾인 칸에 있는 *다른* 아이템의 소비 처리

**구현 위치:** `js/game.js`
- `_movePlayer()`: 진입부에 `iceKickWait` 체크 추가(대기 중이면 `_resolveIceKick`으로 분기). 기존 자동 슬라이드 로직(`tryRightDir`/`tryLeftDir` 반복 루프) 제거, 대신 `pendingIceKick` 플래그만 세팅
- `_enterIceKickWait(x, y, incomingDirection)`: 벽 충돌 후 대기 상태 진입, 플레이어 위치 확정 및 입력 재활성화
- `_resolveIceKick(direction)`: 대기 중 입력 처리. 진행/반대 방향 무시(수직 방향인지 `isPerpendicular`로 판정), 유효 방향이면 한 칸 이동 시도 및 충돌/아이템/전기문 처리

### 4. 전기(Electric) 아이템

변경 없음. 전기문(`ELECTRIC_DOOR`) 통과 시 문이 열리고 상태가 `NORMAL`로 리셋되는 기존 동작 유지.

## 미검증 사항

- 위 변경들은 코드 정합성(문법 체크, 로직 리뷰) 위주로 검증했고, 실제 브라우저에서의 플레이 테스트는 아직 진행하지 않음
- 특히 얼음 꺾기의 애니메이션/입력 타이밍, 자석 정지 시 이펙트 위치가 자연스러운지는 실기 확인 필요
