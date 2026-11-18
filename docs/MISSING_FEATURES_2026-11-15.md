최종 재비교·추가 보완·바탕화면 실행 ZIP 결과: [MAC_FINAL_RECHECK_2026-11-15.md](MAC_FINAL_RECHECK_2026-11-15.md).

# 미구현 기능 구현 결과 — 2026-11-15

기준: Mac origin/feature/battle / ad1bb7c9217028270ec28ebfb8d2dc05059a09da. 감사에서 확인한 M01–M12를 Windows 작업 트리에 구현했다. 이전 사용자 지정과 싱글 우선 범위는 유지했다.

| ID | 구현 내용 | 주된 검증 |
| --- | --- | --- |
| M01 | 손상 원본을 고유 .corrupt 파일로 보존하고 최신 유효 스냅샷으로 복구. 깨진 최신 스냅샷 건너뛰기, 동시 복구 보호, 복구 후 가져오기, 12시간 백업·최신 유효 10개 유지. 미래 버전 파일은 그대로 보존하고 거부. | 손상 파일·동시 읽기·복원·보관 개수 회귀 테스트. 재현 스크립트 결과 recovered/restored/originalPreserved=true. |
| M02 | 저장이 성공한 부화·이로치·각 진화 단계·졸업·메타몽 이벤트와 도감 완성 OS 알림. 알림 설정 반영, 완료 배지 통지 이력 보존, 재조회·가져오기 중복 방지, 언어별 종 이름. | 큰 사용량 한 번의 모든 성장 이벤트, 재시작/가져오기 중복 회귀. 실제 사용량 IPC에서 부화 알림·알림 끄기·재조회 확인. |
| M03 | .claude-* / .claude_* 자동 발견, 기본 홈 로그인 이름 읽기, 중복 루트 병합, 발견 계정 로그까지 집계. OAuth 자격 파일 없는 로그인 폴더도 등록 가능. | 임시 홈 두 패턴 발견·수동 중복 제거·기본 계정 정체성·집계 회귀. |
| M04 | 복수 경로·쉼표/개행·와일드카드·파일 수 미리보기, 다중 폴더 선택 및 기존 단일 경로 호환. | 미리보기와 실제 집계 파일 일치, 중복 경로 집계 방지, 실제 IPC 저장 후 재조회. |
| M05 | 절전/디스플레이/잠금 복귀·네트워크 재연결 갱신, 화면 꺼짐 시 백그라운드 작업 억제, Windows Battery Saver에 따른 애니메이션/이동 절감. 네이티브 이벤트 브리지는 숨김 실행 및 부모 종료 시 정리. | Windows 브리지 실제 시작 시 saver/display 이벤트 수신. UI의 절전 반응. 강제 절전·네트워크 단절은 수행하지 않음. |
| M06 | GIF 실패 시 정적 이미지 유지, 2초부터 최대 30초 간격 재시도, 성공/뷰 제거 시 타이머 정리. | 실제 Electron 프로토콜에서 일시 503 → 정적 폴백 → GIF 재생 복구. |
| M07 | 호버 사용량 안내, 쓰다듬기 하트, 한도/육성 말풍선 우선순위, 에이전트 말풍선과 공존, 펫 위치 저장·복원 및 화면 범위 보정. | 호버·하트·한도 말풍선·에이전트/절전 반응 UI 검사. 멀티모니터 재배치의 실제 사용 시험은 수행하지 않음. |
| M08 | 홈 업데이트 배너, 특정 버전 건너뛰기, 설정에서 다시 표시, 다운로드 상태 전달 및 영속 설정. | 실제 렌더러의 배너 숨김·다시 표시·설정 저장. 실제 릴리스 다운로드/설치는 수행하지 않음. |
| M09 | 회전 로그, 비정상 종료 마커, renderer/child-process 오류 기록, 문제 보고 메일 초안, 로그 열기, GitHub/웹사이트/후원 버튼. 메일은 직접 보내지 않음. | 임시 프로세스의 비정상 종료 감지·정상 종료 마커 제거·로그 회전, UI 지원 버튼 전달. |
| M10 | 도감 휠 페이지 이동, 종 카드 챔피언 배지, 모든 지원 언어·악센트 무시 검색. | 실제 UI 20종 페이지 이동·챔피언 표시·다른 언어 이름 검색, 기존 8개 언어/너비 검사. |
| M11 | 트레이의 즉시 새로고침·도감 열기·뒷모습 토글. | IPC/메뉴 실행 경로 대조 및 전체 빌드. 실제 트레이 수동 클릭은 수행하지 않음. |
| M12 | 연결 전 idle/ended 배틀 탭에서 두 슬롯 프리셋 편집. | 연결 없는 실제 UI에서 편집 창 열기·닫기, 기존 배틀 준비·전투·기권 검증. |

## 빌드·테스트 결과

- pnpm build 및 Windows 전체 테스트: **114개 중 104 통과, 실패 0, 10 제외**. 제외 10개는 Docker에서 별도로 실행한 Swift 비교 6개와 아래 macOS 전용 4개다. 로그: output/mac-parity/features-complete-tests.log.
- 원본 Swift 비교 포함 Docker 전체: **114개 중 110 통과, 실패 0, 4 제외**. 로그: output/mac-parity/features-complete-swift.log.
- 실제 일반 UI: 통과. 로그: output/mac-parity/features-ui-extra.log. 지원 8개 언어와 좁은 화면 경계, 설정·상점·도감·펫·업데이트·프리셋·이미지 복구를 포함한다.
- 실제 사용량 IPC/알림: 통과. 실행: pnpm exec electron scripts/state-ipc-smoke.mjs. 알림 표시는 캡처하여 사용자에게 보내지 않았으며 실제 홈/자격 정보/세이브를 읽지 않았다. 로그: output/mac-parity/state-ipc-third.log.
- 실제 배틀 UI: 통과. 로그: output/mac-parity/features-battle-ui.log.
- Windows QA 패키징: electron-builder --dir --win --x64 통과. 산출물: output/package-feature-qa/win-unpacked/. 전원 브리지 PS1은 app.asar.unpacked에 포함되며 원본 SHA-256과 일치한다. 서명·설치·배포는 하지 않았다. 로그: output/mac-parity/features-package.log.

실제 macOS SDK 및 빌드된 PokeTokenBar 모듈이 필요한 교환/대전 호스트·게스트 **4개 통합 테스트**는 이 Windows 환경에서 실행할 수 없다. 이는 미구현으로 확인된 기능과 구분한다. 위 결과는 전체 macOS 화면의 픽셀 일치나 실계정 인증/실제 업데이트 설치를 검증했다는 의미는 아니다.

근본 원인은 수학/모델/배틀 순수 함수 중심의 기존 비교가 시스템 알림·실패 복구·자동 발견·데스크톱 이벤트의 호출 경로까지 보장하지 못한 데 있다. 새 tests/missing-features.test.mjs와 실제 IPC/UI 검증에 해당 트리거를 추가했다. 전원 브리지가 ASAR 내부에만 들어가면 설치 앱에서 실행되지 않는 문제도 패키지 검사에서 차단했다.

이하 내용은 **구현 전 감사 기록**이다.

---

# Mac feature/battle 대비 남은 미구현 기능

확인일: 2026-11-15. 기준은 ../PokeTokenBar의 origin/feature/battle, 커밋 ad1bb7c9217028270ec28ebfb8d2dc05059a09da다. Mac의 체크아웃된 main을 기준으로 삼지 않았다. Windows는 현재 작업 트리의 실행 경로를 확인했다.

이 문서는 기능 감사 결과다. 제품 코드는 수정하지 않았다. 원본 앱의 모든 화면을 실행해 검증한 목록은 아니며, 기능의 존재·호출 경로를 소스로 대조했다. M01과 M03은 임시 파일 재현도 수행했다. 과거 테스트 통과와 확인된 차이 수정이 전체 제품 기능의 동등성을 의미하지는 않는다.

## 우선 확인할 기능 공백

| ID | 우선순위 / 상태 | Mac 기능 | Windows 현재 상태와 근거 |
| --- | --- | --- | --- |
| M01 | P1 / 복구 누락, 백업 부분 구현 | 손상 세이브를 별도 보존하고 최신 유효 스냅샷에서 자동 복구. 자동 스냅샷 12시간 간격·최신 10개 유지. | store.ts의 load(:276)는 JSON/검증 오류를 그대로 던진다. replaceImport(:630)도 기존 파일을 먼저 파싱해 손상 파일이 있으면 복원이 실패한다. 정상 스냅샷 1개가 있는 상태에서 시작·복원 모두 SyntaxError를 재현했다. 원본 바이트는 보존된다. 자동 백업은 usage/ipc.ts:227의 날짜 검사와 24시간 간격이며 createSnapshot(:589)에 오래된 파일 정리가 없다. |
| M02 | P1 / 육성 OS 알림 누락 | 부화·이로치 부화·진화·졸업·메타몽 공개·도감 완성 알림. | usage/ipc.ts:83의 notifyCompanion은 창/펫 IPC만 보낸다. OS Notification 호출은 한도 사탕 지급(:275), 한도 경고(:293), 업데이트(windows.ts:97)에 있다. 부화·진화 화면 효과는 구현돼 있지만 해당 OS 알림과 도감 완성 통지 이력은 없다. |
| M03 | P1 / 계정 발견 부분 구현 | 홈의 .claude-* / .claude_* 로그인 폴더 자동 발견, 기본 계정의 ~/.claude.json 정체성 읽기. | claude-accounts.ts는 기본 경로·환경변수·수동 추가 목록만 사용한다. 임시 홈의 .claude-team 로그인은 자동 발견=false, 수동 추가=true로 재현했다. savedIdentity도 root/.claude.json만 읽어 기본 로그인 정보의 홈 바로 아래 파일 경로를 보완하지 않는다. settings.ts:106의 계정 추가는 .credentials.json의 OAuth 객체를 요구해 폴더 등록 역시 Mac의 로그인/세션 키 경로 전체를 대체하지 못한다. |
| M04 | P2 / 로그 경로 부분 구현 | 제공자별 복수 추가 경로, 쉼표/개행 입력, 와일드카드 확장, 일치 파일 수 미리보기. | usage/ipc.ts:34는 제공자별 문자열 하나만 읽는다. :407의 폴더 선택은 한 디렉터리만 저장한다. settings.js:155도 한 경로/선택/해제만 제공한다. 기본 경로·Claude 추가 계정 폴더가 여러 개인 것과 이 기능은 다르다. |
| M05 | P2 / 시스템 상태 연동 누락 | 네트워크 재연결·절전 복귀 시 즉시 갱신, 화면 꺼짐 시 폴링 중지·복귀 시 재개, 저전력 상태에 맞춘 애니메이션 조절. | usage/ipc.ts:303–317의 시작/주기 타이머 중심이다. powerMonitor나 online/reconnect 이벤트 연결이 없다. Reduce Motion과 수동 애니메이션 품질은 구현돼 있다. |
| M06 | P2 / 스프라이트 재시도 누락 | GIF 로드 실패 후 정적 폴백을 유지하며 2초부터 최대 30초로 재시도. | sprite-player.js:10은 실패 시 PNG로 src를 바꾸고 :56에서 플레이어를 제거한다. 렌더/설정 변경으로 새로 시도할 수는 있으나 원래 GIF를 자동 재시도하는 일정은 없다. |
| M07 | P2 / 펫 부분 구현 | 호버 사용량/최근 사건 안내, 쓰다듬기 하트, 한도 경고 우선 말풍선, 육성 이벤트 말풍선, 위치 영속 저장. | pet.js:8은 종 이름 title과 기도/에이전트 말풍선 중심이다. controller.ts:111의 말풍선 크기도 에이전트 waiting/done 기준이다. 위치는 controller의 메모리 home 값이며 재시작 복원 설정이 없다. 클릭·기도·드래그·에이전트 반응·대표 폼은 이미 구현돼 있다. |
| M08 | P2 / 업데이트 부분 구현 | 홈 배너, 이 버전 건너뛰기, 건너뛴 버전 다시 표시. | windows.ts에 자동 확인/OS 알림 및 수동 확인→다운로드→설치가 있다. shared/windows.ts의 상태에는 current/available/downloaded만 있으며 skip/showSkippedAgain API와 영속 설정·홈 배너가 없다. |
| M09 | P2 / 지원·진단 기능 누락 | 문제 보고 메일 초안, 앱 로그 바로 열기, 로그 회전·비정상 종료 기록, GitHub/웹사이트/후원 링크. | settings.html:132의 정보는 이름/버전이다. 저장 폴더 열기는 있지만 앱 로그 열기/문제 보고/연락 링크가 없다. main의 console.error는 Mac의 AppLog/CrashReporter와 같은 영속 진단 기능이 아니다. |
| M10 | P2 / 컬렉션 보조 기능 부분 구현 | 휠/트랙패드로 도감 페이지 이동, 종 카드 챔피언 배지, 모든 저장 언어와 악센트를 무시한 검색. | companion.js:677은 이전/다음 버튼 중심이며 wheel 처리가 없다. 챔피언 배지는 상세(:483)·포획 기록(:633)에만 있다. 검색(:543)은 현재 표시 이름과 기본 이름을 소문자로 비교하며 모든 언어/악센트 정규화를 하지 않는다. |
| M11 | P2 / 트레이 바로가기 부분 구현 | 새로고침, 도감 바로 열기, 뒷모습 토글. | index.ts:184의 트레이 메뉴는 요약·앱 열기·펫·설정·종료다. 해당 기능 자체가 모두 없는 뜻은 아니며 트레이 진입점이 빠져 있다. |
| M12 | P2 / 프리셋 진입점 부분 구현 | 상대를 찾기 전 idle/ended 로비에서 프리셋 편집. | battle.js:17의 프리셋은 연결 후 등록 영역 안에 있다. CPU 준비 화면과 두 슬롯 저장/불러오기는 구현돼 있으므로 프리셋 전체 미구현으로 분류하지 않는다. |

## Mac 소스 근거

아래 경로는 모두 위 커밋의 Sources/PokeTokenBar 아래다. 읽기용 사본은 output/mac-parity/feature-inventory에 저장했다.

| ID | Mac 파일과 위치 |
| --- | --- |
| M01 | Core/CompanionStore.swift:2520, Core/SaveSnapshots.swift:17, :18, :167, :182 |
| M02 | Core/CompanionStore.swift:518, :1059, :1146, :1569, :1841, :1897 |
| M03 | Core/ClaudeAccountRoots.swift:49, :81, UI/SettingsView.swift:946 |
| M04 | Core/CustomScanRoots.swift:26, UI/SettingsView.swift:858, :1053 |
| M05 | Core/UsageStore.swift:996, :1015, :1047, :1088; UI/FloatingPetPanel.swift:381 |
| M06 | UI/SpriteLoader.swift:224–253 |
| M07 | UI/FloatingPetPanel.swift:105, :186, :615, :632, :695, :840 |
| M08 | Core/UpdateChecker.swift:117, :125; UI/PopoverView.swift:152; UI/SettingsView.swift:513 |
| M09 | Core/SupportMail.swift:6; Core/AppLog.swift; Core/CrashReporter.swift:30; UI/SettingsView.swift:174, :974, :1077 |
| M10 | UI/CompanionView.swift:1378, :2159; Core/CompanionStore.swift:614 |
| M11 | UI/StatusItemMenu.swift:28 |
| M12 | UI/ChallengeWindowController.swift:200–228 |

## 이번 목록에서 제외한 항목

- 개체 seed/IV·성별·특성, 특성 편집, 추적 계정·오늘/월 집계, 공식 한도 페이스/소진 예측, Arceus/Judgment 타입, 기도 보존, 미수집 진화 분기, 사탕 XP 미리보기, Mac v2 내보내기, CPU 기권 확인, 교환·배틀 게이트, 전체 폼 격자, 메가 정보, LAN 폼 이미지·순서·기록은 현재 구현에 있다.
- redMaple은 구현돼 있다. 지원 범위 1~5세대 649종도 모두 등록돼 있다.
- 더블 배틀은 Mac에 있고 Windows UI에서는 비활성이다. 기존 사용자 요청이 싱글 우선/더블 후속 범위였으므로 우발적 누락과 별도로 남은 범위로 분류한다.
- Apple Multipeer 교환 자동 탐색은 Windows에서 수동 TCP 연결로 대응한다. Windows LAN 배틀의 UDP 탐색까지 없는 것으로 분류하면 안 된다.
- 메뉴바와 Windows 트레이의 상시 텍스트/포켓몬 스프라이트 표현, Keychain/OS 암호화, Finder/탐색기, 별도 설정 창, 사용자 지정 성장 바·능력치 표·LEAD 위치는 플랫폼 또는 기존 사용자 지정 차이다.
- Mac 원본 모듈과의 교환/대전 통합 테스트 4개는 미실행 상태이지 기능 누락이 확인된 항목이 아니다.

## 재현 및 범위

실행: node output/mac-parity/missing-feature-audit.mjs
결과: output/mac-parity/missing-feature-samples.json

실제 사용자 세이브나 자격 정보를 읽거나 변경하지 않는다. 임시 홈/로그인/세이브를 만들고 삭제한다. 정상 스냅샷이 있는 손상 세이브의 읽기·복원 실패와 Claude 추가 계정 자동 발견 누락을 재현했다. 나머지 항목은 위 소스의 UI/API/호출 경로 비교 결과다. 이번 감사에서 제품 코드가 바뀌지 않았으므로 전체 빌드·테스트를 다시 돌리지 않았고, 앞선 102개 통과 결과를 이 공백들에 대한 검증으로 사용하지 않았다.

수정 우선순위는 M01 복구 → M02 육성 알림 → M03 계정 발견 → M04/M05/M06 수집·복귀 안정성 → 나머지 UI·지원 기능이다.
