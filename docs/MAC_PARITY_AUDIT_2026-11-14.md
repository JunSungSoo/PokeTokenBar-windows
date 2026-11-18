최종 재비교·추가 보완·바탕화면 실행 ZIP 결과: [MAC_FINAL_RECHECK_2026-11-15.md](MAC_FINAL_RECHECK_2026-11-15.md).

후속 기능 구현과 최종 검증 결과는 [MISSING_FEATURES_2026-11-15.md](MISSING_FEATURES_2026-11-15.md)를 참조한다.

# 수정 및 검증 결과 — 2026-11-15

기준: ../PokeTokenBar의 origin/feature/battle, ad1bb7c9217028270ec28ebfb8d2dc05059a09da. 아래 원래 감사 기록의 차이를 현재 작업 트리에 반영했다. 실제 macOS 앱과 전 화면 픽셀 일치를 검증했다는 의미는 아니다.

| 항목 | 반영 내용 |
| --- | --- |
| A01 | Swift와 같은 SplitMix64 개체값 생성, seed 기반 성별·특성 슬롯, 숨겨진 특성, BW2 특성 보정. 기존 선택값 보존. |
| A02–A03 | 위험 임계값·리셋 전 소진 예측을 기분 경고에 연결. Claude 자동/최고 사용량/기본/지정 계정 추적, 계정별 오늘·월 토큰과 비용, 트레이 반영. |
| A04–A05 | 아르세우스 폼별 상세·심판 타입 투영, 보유 개체의 합법 특성 변경 및 저장. |
| A06 | Mac schema 2 호환 내보내기. 프로필·기도·수집 이력·아이템 왕복과 원본 세이브 보존 검증. Swift ISO8601 형식에 맞춘 날짜 출력. |
| A07–A08 | CPU 전투 창 닫기·종료 시 기권 확인, 취소 시 진행 보존. 교환·배틀 상호 진입 차단. |
| A09–A11 | 미수집 최종 진화 분기 우선, 수집 이력 보존, 기도 횟수 부화·가져오기 보존, 사탕 손실·이월 XP 미리보기. |
| A12 | 계정별 OS 암호화 세션 키, 조직 탐색·선택, OAuth 폴백, 플랜·인증 만료·요청 제한·오래된 한도 안내. 늦은 응답이 변경/삭제된 키를 복원하지 않도록 보호. |
| 추가 표시 | 전체 폼 격자·수집 수·번역, 메가진화 정보, LAN 폼 이미지·등록 순서·상대별 날짜 포함 기록, 상점 잔액 부족 버튼·이로치/전설 경고 문구. |

검증 기록:

- Windows 전체: 106개, 96 통과, 실패 0, 10 제외. 제외 항목은 Linux에서 실행하는 Swift 비교 6개와 아래 macOS 전용 4개다.
- Docker 원본 Swift 비교 포함 전체: 106개, 102 통과, 실패 0, 4 제외. 로그: output/mac-parity/swift-final.log.
- 동일 seed·메타데이터 544개 샘플의 개체값·성별·특성 일치. 기존 페이스·소진 예측, 기술·능력치·툴팁·해시 비교도 통과.
- 실제 Electron 일반 UI: 8개 언어, 360/490px 등 화면 경계, 전체 폼 격자, 메가 정보, 설정·상점·가방·도감 통과. 로그: output/mac-parity/runtime-ui-verified.log.
- 실제 Electron 배틀 UI: 준비·전투·보상·재개, 교환 상호 차단, CPU 닫기 취소 및 기권 저장 통과. 로그: output/mac-parity/battle-ui-verified.log.
- Mac 지원 범위인 1~5세대 649종 전부 등록 확인. redMaple 가격 100M·졸업 개체 사용·6개 IV 재설정·1개 소비 검증 유지.

남은 검증 제약: 원본 Mac 교환 호스트/게스트 2개와 대전 호스트/게스트 2개는 macOS SDK 및 빌드된 PokeTokenBar 모듈이 없어 실행할 수 없다. Windows/Node LAN 통합 테스트는 통과했다. 실제 계정 로그인으로 세션 키를 시험하지 않았으며 HTTP 응답 fixture로 만료·조직 재탐색·요청 제한을 검증했다.

이하 내용은 **수정 전 감사 기록**이다. 현재 미수정 목록으로 해석하지 않는다.

---

# Mac feature/battle 대비 Windows 불일치 점검

기준일: 2026-11-14. Mac은 `../PokeTokenBar`의 **`origin/feature/battle` / `ad1bb7c9217028270ec28ebfb8d2dc05059a09da`**를 `git show`로 읽었다. 체크아웃된 `main`과 혼동하지 않았다. Windows는 현재 작업 트리와 빌드 산출물을 비교했다.

이번 결과는 소스 대조와 임시 세이브 재현에 근거한다. 실제 macOS 앱 화면을 실행한 전 화면 검증은 아니다. 기존 89개 테스트 통과는 해당 샘플의 일치이며, 아래 미검증 기능까지 일치한다는 뜻은 아니다.

## 먼저 수정할 동작 차이

| ID | 우선순위 | Mac 동작 | Windows의 확인된 차이 / 영향 |
| --- | --- | --- | --- |
| A01 | P1 | `PokemonProfile.enrich`가 메타데이터와 seed로 성별·특성 슬롯을 채운다. 숨겨진 특성도 1/128 확률로 선택한다. | `enrichMoves`는 기술만 채운다. **Windows에서 새로 부화한 이상해씨가 메타데이터 조회 후에도 성별·특성이 비어 있는 것을 재현했다.** 맥에서 가져온 기존 프로필의 값은 보존되므로 모든 개체의 값이 비어 있다는 의미는 아니다. 배틀은 값이 없으면 첫 일반 특성으로 폴백한다. |
| A02 | P1 | 전체 한도 경고·기분은 위험 임계값(기본 95%) 또는 리셋 전 소진 예측을 반영한다. Claude는 추적 계정을 사용한다. | `usage/ipc.ts`의 기분 판정은 모든 계정의 사용률을 경고 임계값(기본 80%)과 비교하며 **예측을 사용하지 않는다.** 예측이 없는 85%는 Mac 경고=false / Windows=true. 50%이지만 리셋 전 소진 예측이 있는 샘플은 Mac=true / Windows=false다. 화면의 페이스·예측 계산식 자체가 틀리다는 뜻은 아니다. |
| A03 | P1 | Claude 추적 계정을 자동/최고 사용량/특정 계정으로 선택하고, 선택한 계정의 오늘·월 사용량/비용도 표시한다. | 설정에는 계정 폴더 목록만 있고 추적 계정 모드가 없다. 공식 한도 탭은 전환되지만 로컬 사용량은 제공자 전체 합계이며 계정별 오늘·월 합계가 없다. 트레이도 모든 계정 창의 최댓값을 사용한다. |
| A04 | P1 | 아르세우스는 폼에 맞춰 상세 타입과 심판의 메뉴·툴팁 타입을 투영한다. 종 캐시는 유지한다. | 상세 API/캐시는 종 번호 기준이며 폼 인자가 없다. **불꽃 폼을 선택할 수 있는데 상세 타입과 심판 타입은 Normal인 샘플을 재현했다.** 렌더러의 “정보는 기본 폼 기준” 안내가 이 동작 차이를 대신한다. 배틀 엔진의 폼 처리와는 별개다. |
| A05 | P1 | 보유 개체의 가능한 특성 목록에서 특성을 선택하고 `setPokemonAbility`로 저장한다. | 상세에는 특성 텍스트·설명만 있고 변경 컨트롤/API/IPC가 없다. A01의 초기 특성 생성 누락과 별개의 편집 기능 누락이다. |
| A06 | P1 | `poketokenbar.save`, schema 2로 호환 세이브를 내보낸다. | Mac v2 가져오기는 있지만 내보내기는 `poketokenbar.windows.backup`, version 1만 제공한다. **Windows 백업 파일을 Mac v2 가져오기에 바로 사용할 수 없다.** |
| A07 | P1 | 진행 중 CPU 전투의 창 닫기/앱 종료는 기권 확인을 거친다. | `BattleWindows`의 닫기 확인은 `kind === 'lan'`일 때만 실행된다. CPU 창은 닫을 수 있고 저장된 진행을 나중에 재개하는 경로다. 맥의 기권 확인·종료 규칙과 다르다. |
| A08 | P1 | CPU/LAN 배틀 중 교환 진입을 막고, 교환 중 배틀 탐색도 비활성화한다. | 교환·배틀 IPC는 각각 등록되며 공통 활동 게이트가 없다. CPU 별도 창이 열린 상태에서도 메인 창의 교환 버튼은 배틀 상태를 검사하지 않는다. **상호 진입 차단 누락은 소스로 확인했으나 동시 실행에 따른 저장 손상은 재현하지 않았다.** |
| A09 | P2 | 진화 분기에서 아직 수집하지 못한 최종체가 있는 경로를 우선 선택한다. | 진화 계획을 만들 때 각 자식에서 단순 균등 무작위 선택한다. 이미 수집한 최종 진화형을 고려하는 분기 우선 규칙이 없다. 예: 이브이 일부 진화형만 미수집인 경우 선택 풀이 달라진다. |
| A10 | P2 | 알의 기도 횟수를 부화한 개체에 옮기고 상세에도 표시한다. | 부화 시 `eggPrayers`를 삭제하지만 개체 필드로 옮기지 않는다. **기도 3회인 알을 부화시킨 뒤 알과 개체 양쪽에서 기록이 사라진 것을 재현했다.** Mac 가져오기에서도 개체의 prayers를 매핑하지 않는다. |
| A11 | P2 | 사탕 사용 전에 졸업·버려지는 XP·진화 후 이월 XP를 수치로 미리 보여준다. | `+100M XP · 진화/졸업/성장 진행`만 보여주며 손실/이월량을 표시하지 않는다. 졸업으로 남는 XP가 버려질 때 소비 전에 규모를 알 수 없다. |
| A12 | P1/P2 | Claude 세션 키·조직 선택을 지원하고 계정/플랜·인증 만료·오래된 한도 정보를 구분한다. | OAuth 자격 파일 읽기와 계정 폴더 추가가 중심이다. 세션 키·조직 입력 기능은 없으며, 계정 이름은 폴더명 기반이고 플랜/만료 종류/오래된 정보 배지가 없다. 실패 응답은 창 목록을 비우고 일반 “조회 실패”로 바뀐다. 인증 방식 누락은 P1, 상세 안내 차이는 P2다. |

## 관련 소스 근거

Mac 경로는 모두 위 커밋의 파일이다. 감사용 사본은 `output/mac-parity/audit-reference/`에 보관했다.

| ID | Windows | Mac |
| --- | --- | --- |
| A01 | `src/main/companion/store.ts:134` (`enrichMoves`), `:321` (새 프로필), `src/main/battle/team.ts:50` | `Core/PokemonProfile.swift:161`, `:165`, `:175` |
| A02 | `src/main/usage/ipc.ts:219` | `Core/UsageStore.swift:727`, `:742` |
| A03 | `src/shared/settings.ts:3`, `src/renderer/usage.js:33`, `src/main/index.ts:53` | `Core/UsageStore.swift:1397`, `UI/SettingsView.swift:929`, `UI/PopoverView.swift:998` |
| A04 | `src/main/companion/pokemon-details.ts:83`, `:95`, `src/renderer/pokemon-details.js:61` | `Core/PokemonProfile.swift:21`, `Core/Battle/BattleTextCatalog.swift:71` |
| A05 | `src/renderer/pokemon-details.js:69`, `src/shared/usage.ts` (변경 API 없음) | `Core/CompanionStore.swift:2357`, `UI/CompanionView.swift:1965` |
| A06 | `src/main/settings.ts:125`, `:138` | `Core/SaveTransfer.swift:11`, `:13`, `:108` |
| A07 | `src/main/battle/windows.ts:18`, `src/main/battle/ipc.ts:50` | `UI/ChallengeWindowController.swift:122`, `:132` |
| A08 | `src/main/usage/ipc.ts:54`, `src/main/trade/ipc.ts:28`, `src/renderer/trade.js:11` | `UI/PopoverView.swift:193`, `UI/BattleLobbyView.swift:38` |
| A09 | `src/main/companion/store.ts:306` | `Core/CompanionStore.swift:1066` |
| A10 | `src/main/companion/store.ts:337`, `src/main/companion/mac-save.ts:60` | `Core/CompanionStore.swift:1805`, `:1830`, `UI/CompanionView.swift:1953` |
| A11 | `src/renderer/companion.js:399` | `UI/BagView.swift:82`, `Core/CompanionStore.swift:1199` |
| A12 | `src/main/usage/limits.ts:159`, `:317`, `src/renderer/usage.js:53` | `UI/SettingsView.swift:618`, `Core/SessionKeyLimitsProvider.swift`, `UI/PopoverView.swift:982` |

## 추가로 남은 표시·탐색 차이

| 영역 | 차이 | 근거 |
| --- | --- | --- |
| 폼 선택 | Mac은 미보유 폼을 포함한 전체 격자와 수집 수를 보여준다. Windows는 보유 폼 선택 중심이고 일반 폼 이름을 영문 식별자에서 변환한다. | Mac `UI/CompanionView.swift:1820`, Windows `src/renderer/companion.js:419` 및 폼 select 구성 |
| 메가진화 정보 | Mac의 메가진화 설명 버튼·별도 정보 화면이 Windows 개체 상세에는 없다. 배틀에서 메가진화가 동작하는 것과 별개다. | Mac `UI/CompanionView.swift:1810`, Windows `src/renderer/pokemon-details.js` |
| LAN 로비 이미지 | Windows 메인 로비 이미지는 `speciesID.png`로 만들어 폼별 spriteID를 반영하지 않는다. 별도 배틀 창의 폼 처리와 구분한다. | Windows `src/renderer/battle.js:4`, Mac `UI/BattleLobbyView.swift`의 폼을 전달하는 SpriteView |

이 밖에 상점 잔액 부족 버튼, 경고 문구, 로비 순서 조절/기록 표시, 카드 간격 등 기존 문서에 남아 있던 표시 차이가 있다. 이번 점검은 위 동작 차이를 우선했고 전 화면의 픽셀 일치를 판정하지 않았다.

## 현재 일치하는 부분과 오래된 보고서 정정

- `redMaple`: 존재·가격 100M·졸업 개체만 사용·개체값 6개 재설정·1개 소비 규칙이 일치한다. `main`에 없다는 이유로 차이로 분류하면 안 된다.
- 포켓몬 등록: Mac 지원 범위 1~5세대 649종이 모두 등록되어 있다. A01/A04는 종 등록과 별개의 프로필/표시 문제다.
- 모델 단가표: Mac 33개 / Windows 33개, 값 차이 0개를 소스 파싱으로 확인했다. 모든 로그 형식·집계 경로의 동등성을 뜻하지는 않는다.
- 페이스·소진 예측 순수 계산: 기존 동일 샘플 비교는 통과했다. A02는 그 결과를 전체 경고·기분에 연결하는 경로의 차이다.
- 원본 배틀 엔진 번들·플레이어·트레이너 3,357개 파일, 기본 기술/능력치 계산, 기술 선택·교체, 종 독립 8개 언어 툴팁, 배틀 결정 해시는 직전 Swift 통합 검증에서 통과했다.
- 과거 보고서의 **R05 “LAN 전투 남은 시간 표시 없음”은 현재 해소됨**: `src/renderer/battle-window.js:40`, `:121`에 카운트다운이 있다.
- 과거 H01~H04의 홈 합계·토큰/모델 내역·주/월/연 회고·히트맵과 H05의 기준선·예측 연결도 현재 반영되어 있다. 과거 문서를 그대로 현재 결함 목록으로 사용하지 않았다.

## 플랫폼·사용자 지정 및 검증 공백

- 시스템 트레이/메뉴바, Keychain/Windows 자격 파일, 시작 앱, Finder/탐색기, 글꼴·이모지·네이티브 창 차이는 플랫폼 대응이다.
- Mac의 Apple Multipeer 자동 탐색과 Windows의 수동 TCP/배틀 UDP 탐색은 구현 방식이 다르다. 이것만으로 프로토콜이 깨졌다고 판정하지 않았다.
- 기존 문서에 사용자 지정으로 기록된 9.8px 성장 바, 현재 능력치만 표시하는 표, 별도 설정 창, 싱글 우선/LEAD 배지는 일반 결함 목록에서 제외했다.
- macOS 원본 교환 2개·대전 2개 통합 테스트는 실제 Mac 모듈이 없어 아직 실행하지 못했다. 이는 **미검증**이며 “불일치 확인”이 아니다.
- 대형 로그 성능과 모든 제공자의 실제 로그인/인증 만료 복구는 이번에 실계정으로 시험하지 않았다.

## 재현 자료와 권장 순서

`node output/mac-parity/audit-samples.mjs`로 실제 사용자 세이브 대신 임시 폴더에서 부화·메타데이터 보강·기도 기록·아르세우스 기본 타입을 검사했다. 결과는 `output/mac-parity/audit-samples.json`에 저장했다. 경고 샘플은 각 소스의 조건을 대조한 계산으로, 전체 Electron 이벤트 흐름을 재현한 것은 아니다.

권장 수정 순서는 **A01 프로필 보강 → A02/A03 한도·추적 계정 → A04/A05 폼·특성 → A06 호환 내보내기 → A07/A08 배틀·교환 진입/종료 보호**다. 이후 분기 선택·기도 이력·사탕 미리보기·상세 안내를 맞추는 편이 사용자 데이터와 동작의 차이를 먼저 줄인다.
