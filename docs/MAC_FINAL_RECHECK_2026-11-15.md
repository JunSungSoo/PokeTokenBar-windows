# Mac feature/battle 최종 재비교 및 실행 ZIP

기준: origin/feature/battle, ad1bb7c9217028270ec28ebfb8d2dc05059a09da. 현재 Windows 작업 트리와 소스/실제 호출 경로를 대조했다. 이전에 합의한 플랫폼 표현·사용자 지정·싱글 우선 범위는 유지했다.

## 추가 발견 및 보완

| 항목 | 발견한 동작 차이 | 보완과 검증 |
| --- | --- | --- |
| 조직 목록 새로고침 | Windows가 목록 조회 때 첫 사용 조직을 다시 저장해 수동 선택을 덮어씀. Mac UsageStore.refreshSessionOrganizations는 선택을 유지한다. | 목록 조회를 읽기/캐시 갱신으로 분리. 첫 조직과 다른 조직을 수동 선택 후 새로고침·사용량 조회하는 회귀 테스트. 수정 전 실패/수정 후 통과. |
| 세션 만료 분류 | 조직별 usage의 403과 전체 organizations의 403을 모두 일반 오류로 처리. Mac은 후자를 세션 키 무효로 분류한다. | 전체 목록 403은 sessionKeyExpired로 분류하고 조직별 403 재탐색은 유지. 수정 전 실패/수정 후 통과. |
| 한도 경고의 펫 연결 | OS 알림 루프에는 있었지만 실제 pet:notice 호출이 없었음. UI 주입 테스트만으로 연결 누락을 잡지 못함. | 실제 공식 한도 fetch → 중복 방지 → OS 알림/priority 3 펫 말풍선 호출을 연결하고 실제 IPC 경로로 검증. 표시 언어로 알림 본문도 생성. |
| 경고 이력 식별자 | 같은 표시 이름의 계정 및 같은 라벨의 복수 창이 한 이력 키를 공유. Mac은 계정/창별 키를 사용한다. | accountID 및 같은 라벨의 등장 순서를 사용. 두 계정×중복 창 4개의 경고가 각각 발생하고 재조회 때 중복되지 않는 회귀 테스트. 수정 전 1개/수정 후 4개. |

위 항목 보완 후 검증 범위에서 추가 미구현·동작 오류는 확인되지 않았다. 이는 모든 Mac 화면의 픽셀 일치나 미실행 통합 테스트까지 보장한다는 의미는 아니다.

## 검증

- pnpm build, pnpm typecheck, git diff --check 통과.
- Windows 전체: 117개, 107 통과, 실패 0, 10 제외. 이 중 Swift 비교 6개는 Docker에서 별도 실행.
- 원본 Swift 비교 포함: 117개, 113 통과, 실패 0, macOS 모듈이 필요한 교환/대전 4개만 제외.
- 실제 일반 UI 및 실제 사용량/공식 한도 IPC 검증 통과. 알림은 캡처했고 실제 사용자 계정·세이브를 사용하지 않았다.
- ZIP용 패키지의 실제 EXE를 PTB_STATE_DIR/임시 홈/비어 있는 제공자 설정으로 실행해 Desktop ready 확인. 사용자 프로토콜 등록·실사용 데이터 접근을 피하고 검증 프로세스만 종료했다.
- 패키지 내 주요 코드 6개 및 ASAR 밖 전원 브리지 1개가 최종 빌드/원본과 해시 일치.
- ZIP 안의 76개 파일을 원본과 SHA-256 비교하고 바탕화면 사본의 ZIP 해시도 확인.

로그: output/mac-parity/zip-recheck-tests.log, zip-recheck-swift.log, zip-recheck-ui.log, recheck-state-ipc.log, portable-build-retry.log.

## 실행 파일

바탕화면: C:\Users\SungSoo\Desktop\PokeTokenBar-Windows-1.0.0-x64-20261115.zip
크기: 301932642 bytes
SHA-256: B10C5F4C33686B8BB03E2672231436E2CA9C203E97A3F316E764B39D7A3C9AC1

압축을 모두 해제하고 PokeTokenBar-Windows/PokeTokenBar.exe를 실행한 뒤 트레이 아이콘을 클릭한다. 실행 안내는 ZIP 내부의 먼저 읽어주세요.txt에 포함했다.

이 파일은 코드 서명 없는 로컬 실행용 ZIP이다. 정식 설치판의 자동 업데이트 서버/서명 설정을 QA 서버로 잘못 연결하지 않도록 ZIP 빌드는 수동 ZIP 교체 안내를 제공한다. 정식 설치판의 업데이트 기능은 유지했다. 설치·릴리스 게시·Git push는 수행하지 않았다.
