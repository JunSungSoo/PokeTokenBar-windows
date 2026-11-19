# 초심자 모드 (2026-11-18)

## 요구사항
- 설정에 「초심자 모드」 체크박스 추가.
- 켜진 상태로 저장되면 토큰 사용량으로 얻는 경험치·상점 포인트가 10배, 상점 가격은 유지.

## 핵심 판단
- 토큰 → 보상 경로는 `CompanionStore.update` 한 곳뿐이다. 여기서 원장(ledger) 차이로 `delta`를 만들고 `advance()`가
  `progress`(경험치)와 `raised`(지갑 = raised − spentTokens + 챌린지 보너스)를 같은 `delta`로 올린다.
  → `delta` 계산 시점에 배율을 곱하면 경험치와 포인트가 함께 10배가 되고, 가격(`shopDifficulty`)은 건드리지 않는다.
- 원장에는 **실제 토큰 수**를 그대로 저장한다. 배율은 보상에만 적용하므로 모드를 켜고 끄더라도 중복 지급이나 소급 지급이 없다.
  모드는 「켜진 뒤 새로 들어온 토큰」부터 적용된다.
- 이상한사탕(`advance(..., fromUsage=false)`)과 챌린지 상금은 토큰 사용량이 아니므로 배율 대상이 아니다.
- 배율 값(10)은 `src/main/usage/ipc.ts`의 `beginnerUsageMultiplier` 상수로 두고, 스토어는 배율 숫자만 받는다.
  스토어가 설정 저장소에 의존하지 않게 해 테스트와 재사용성을 유지했다.
- 설정 저장은 기존 `data-setting` 체크박스 공통 처리(`settings.js`)를 그대로 쓴다. 이전 설정 파일에 키가 없으면 기본값 `false`.

## 변경 파일
- `src/shared/settings.ts`, `src/main/settings.ts`: `beginnerMode` 타입·기본값·검증
- `src/main/companion/store.ts`: `update(..., usageMultiplier = 1)`
- `src/main/usage/ipc.ts`: 설정값에 따라 배율 전달
- `src/renderer/settings.html`, `src/shared/windows-messages.ts`: 난이도 섹션 체크박스·안내문·다국어
- `tests/companion.test.mjs`: 배율 적용/미적용 및 가격 불변 테스트

## 알려진 영향
- 초심자 모드 중 `raised`에는 실제 토큰 수가 아니라 환산된 포인트가 쌓인다. 현재 `raised`를 실제 토큰으로 읽는 곳은 없지만, 실제 사용량 통계에 쓰려면 원장(ledger)을 기준으로 해야 한다.
- 모드를 끄더라도 이미 쌓인 경험치·포인트는 회수하지 않는다.
