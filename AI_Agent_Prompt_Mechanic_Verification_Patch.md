# 구현 프롬프트: solver 우회 검증 로직 추가 (assertRequiresMechanic)

## 배경

`tools/solver.js`와 튜토리얼 레벨 1~6번은 이미 완성되어 있는 상태입니다(`AI_Agent_Prompt_Tutorial_Solver.md`, `AI_Agent_Prompt_Tutorial_UI.md` 기준으로 이미 반영됨). 그런데 실제로 플레이해보니, 고무벽처럼 **아이템이 아닌 고정 기믹이 들어간 스테이지**에서 그 기믹을 아예 안 쓰고도 클리어되는 우회로가 있는 경우가 발견됐습니다.

원인은 지금 solver에 있는 검증 함수들이 전부 "풀 수 있는가"와 "특정 아이템을 없애면 못 푸는가"만 확인하기 때문입니다. `assertRequiresItem`은 먹는 아이템(자석/얼음/전기)에만 적용되는 함수라서, 고무벽처럼 맵에 고정으로 박혀있는 타일은 애초에 이 함수의 검사 대상이 아니었습니다. 그래서 고무벽을 안 쓰고도 풀리는 우회로가 있어도 걸러지지 않았습니다.

**아래 작업을 처음부터 다시 만드는 게 아니라, 기존 코드에 국소적으로 추가/수정하는 방식으로 진행해주세요.**

## 작업 지시 (AI 에이전트에게 그대로 전달)

지금까지 만든 `tools/solver.js`와 튜토리얼 레벨 1~6번은 이미 완성되어 있는 상태다. 처음부터 다시 만들지 말고, 아래 변경사항만 반영해줘.

1. `tools/solver.js`에 함수 하나만 새로 추가한다: `assertRequiresMechanic(level, tileType, neutralTileType)`. 기존 함수들(`assertBlockedDirectly`, `assertRequiresItem`, `assertSolvedWithinMoves`)은 이미 있으니 건드리지 마.

   동작: 맵을 복제해서 `tileType`(예: `TILE.RUBBER_WALL`)을 전부 `neutralTileType`(예: `TILE.WALL`)로 바꾼 뒤, 같은 BFS 도달 가능성 검사를 다시 돌린다. 바꾼 맵에서도 여전히 포탈에 도달 가능하면 검증 실패로 보고한다(그 기믹을 안 써도 풀리는 우회로가 있다는 뜻이므로).

2. 이 함수를 추가한 뒤, **이미 만들어둔 레벨을 전부 다시 검증**해줘. 각 스테이지의 고정 기믹에 맞게 호출하면 돼:
   - 자석+철벽 스테이지: `assertRequiresMechanic(level, TILE.METAL_WALL, TILE.WALL)`
   - 전기문+전기 스테이지: `assertRequiresMechanic(level, TILE.ELECTRIC_DOOR, TILE.WALL)`
   - 고무벽이 들어간 스테이지가 있다면: `assertRequiresMechanic(level, TILE.RUBBER_WALL, TILE.WALL)` (이 스테이지 자체가 유지되고 있는지부터 먼저 확인할 것 — 없어졌을 수도 있음)

3. 이 새 검증에서 실패하는(=기믹 없이도 풀리는) 레벨이 있으면, **그 레벨 맵만** 수정해서 통과시켜. 이미 통과한 레벨을 처음부터 새로 만들지 말고, 우회로가 생기는 부분만 국소적으로 고쳐줘.

4. 작업 끝나면 어떤 레벨이 새 검증에서 실패했었는지, 어떻게 고쳤는지 요약해서 알려줘.

## 참고

- `assertRequiresItem`도 결국 `assertRequiresMechanic`의 특수 케이스(아이템 타일을 `FLOOR`로 치환하는 것)로 볼 수 있으니, 여유가 되면 내부적으로 통합해도 됩니다.
- 관련 문서: `AI_Agent_Prompt_Tutorial_Solver.md`(원본 solver 스펙), `AI_Agent_Prompt_Tutorial_UI.md`(튜토리얼 설명 패널 UI 스펙)
