# Windows 앱 내 자동 업데이트 설계 (2026-11-19)

## 의도
Mac(`../PokeTokenBar` `d76fc94`)처럼 Windows 앱이 새 버전을 스스로 받아 검증·설치·재시작한다.
현재는 Drive 공유 파일 제목으로 버전만 확인하고 브라우저로 ZIP 페이지를 연다(`src/main/windows.ts`, `drive-updates.ts`).

## 사용자가 정의한 "자동 업데이트"
- 새 버전이 있으면 **업데이트 버튼이 노출**되고, 사용자가 누르면 **자동으로 교체**된다(백그라운드 무단 설치 없음).
- 교체 후 신규 버전은 이전과 **모든 것이 동일**해야 한다: 로그인 시 시작, 세이브·설정 등 현재 사용자 데이터,
  바로가기·작업 표시줄 고정, `poketokenbar:` 프로토콜, 펫 표시 상태.

## 목표 / 비목표 / 실패 조건
- 목표: 설치판 사용자는 알림 → 「업데이트」 버튼 한 번으로 새 버전 실행. 서명되지 않은 파일은 절대 설치하지 않음.
- 목표: 어느 PC(Mac·Windows)에서든 같은 스크립트로 릴리스 서명·공개.
- 비목표: Authenticode 코드 서명(SmartScreen 경고 수용), 압축 폴더판의 자기 교체, Mac 저장소·코드 변경.
- 실패 조건: 세이브 유실, 배틀·챌린지·교환 도중 재시작, Mac 릴리스와 섞여 어느 한쪽 업데이트가 깨짐, 키가 저장소에 들어감.

## 결정된 사항 (사용자)
| 항목 | 결정 |
|---|---|
| 방식 | electron-updater 6.8.11 + NSIS(per-user, oneClick) + GitHub Releases |
| 저장소 | `JunSungSoo/PokeTokenBar-windows` 고정 (Mac 저장소 `JunSungSoo/PokeTokenBar` 와 분리) |
| 서명 키 | Windows 전용 새 Ed25519 키, 비밀번호 암호화 PKCS#8 PEM, Node 스크립트, 어느 PC에서든 서명 |
| 키 보관 | 비밀번호 관리자 없음 → 암호화 파일은 2곳 이상(클라우드+USB), 비밀번호는 종이, 저장소·채팅 금지 |
| CI | 빌드 후 **초안(draft)** 릴리스만 업로드. 공개는 서명 스크립트가 함 |
| 인증서 | 없이 시작 |
| 전환 | 마지막 Drive ZIP 에 `Setup.exe` 를 넣어 배포(A안). 기존 앱 코드 변경 없음 |

## 접근 방식 (검토한 대안)
- **A. electron-updater + NSIS (채택)**: 실행 중 exe 교체·재시작을 설치기가 처리. 배포가 설치판으로 바뀜.
- B. Mac 방식 이식(ZIP 교체): Windows 는 실행 중 exe 를 덮어쓸 수 없어 외부 교체 스크립트가 필요, 압축 해제 위치가 사용자마다 달라 실패 경로가 많음. 기각.
- 전환 B(압축 폴더판에 GitHub 확인 추가): 별도 흐름 구현·검증 비용. 사용자가 A 선택.

## 설계
### 1. 신뢰 흐름
1. 피드는 generic provider `https://github.com/JunSungSoo/PokeTokenBar-windows/releases/latest/download/`.
   API 미사용(호출 제한 없음). 초안·프리릴리스는 `latest` 에 잡히지 않는다.
2. 앱이 같은 경로의 `latest.yml` 과 `latest.yml.sig` 를 직접 받아, 앱에 내장된 **공개 키 목록** 중 하나로 Ed25519 검증한다.
   크기 상한(yml 64KiB, sig 1KiB), 타임아웃 20초, 쿠키·인증 없음.
3. 서명된 yml 에서 `version`(MAJOR.MINOR.PATCH), `path`(`PokeTokenBar-Windows-<version>-x64-Setup.exe` 만 허용), `sha512` 를 읽는다.
   현재보다 높은 버전만 제안한다.
4. electron-updater 의 `checkForUpdates()` 결과(updateInfo)의 version·path·sha512 가 서명 값과 같을 때만 다운로드를 허용한다.
   다르면(사이에 릴리스가 바뀜 등) 중단하고 다음 확인 때 다시 시도.
5. `update-downloaded` 의 `downloadedFile` 을 직접 SHA-512 해시해 서명 값과 비교한 뒤에만 `quitAndInstall(true, true)` 를 호출한다.
6. `autoDownload=false`, `autoInstallOnAppQuit=false`, `disableDifferentialDownload=true`(blockmap 은 서명 범위 밖이므로 쓰지 않음).
   `electron-builder.config.cjs` 의 `forceCodeSigning`·`verifyUpdateCodeSignature` 는 끈다(게시자 이름이 없으면 electron-updater 는 Authenticode 검사를 건너뜀).

### 2. 앱 동작 (Mac 과 동등)
- 확인: 시작·창 열기·30분 주기·수동. 기존 Drive 확인의 캐시·중복 합치기·알림 1회·건너뛰기 규칙을 유지하고 출처만 GitHub 로 바꾼다.
- 설치(버튼): 배틀·챌린지·교환 중이면 거부(`battle.isBusy()`, `trade.blocksUpdate()`) → 다운로드·검증 → **차단 조건 재확인**
  → 진행 중 저장 대기(`finishWrites`, `forHandoff` 경로 재사용) → `quitAndInstall`.
- 실패 시 상태 `failed` 와 이유를 배너·설정에 표시하고 「다운로드 페이지 열기」(GitHub 릴리스 페이지)를 대안으로 준다.
- 압축 폴더판·개발 실행(`autoUpdater.isUpdaterActive()` false 또는 `portableBuild`): 확인·알림만 하고 버튼은 릴리스 페이지를 연다.
- `UpdateStatus.state` 에 `downloading`·`failed` 추가, `delivery` 는 설치판이면 `installer`.

### 3. 배포
- CI(`windows-release.yml`): 태그 = package.json 버전 확인 → 테스트 → 인증서 없이 `package:win` → `gh release create --draft` 로
  `Setup.exe`, `latest.yml` 업로드(blockmap 제외). Authenticode 검사 단계 제거.
- 서명(`pnpm release:sign <version>`, Node 만 필요, `gh` 로그인 필요):
  저장소가 `JunSungSoo/PokeTokenBar-windows` 인지 → 초안 존재·같은 버전 공개 릴리스 없음 → 초안의 yml·exe 다운로드
  → exe SHA-512 = yml 값 → 비밀번호 입력(화면 미표시)으로 키 복호화 → 공개 키가 앱 내장 목록에 있는지 → 서명·재검증
  → `latest.yml.sig` 업로드 → 초안 공개. `PTB_DRY_RUN=1` 이면 업로드·공개 없이 검증·서명만.
- 키 관리(`pnpm release:key init|public|verify`): `init` 은 키와 무작위 비밀번호(약 128비트)를 만들고 이미 있으면 거부.
  기본 위치 `~/.poketokenbar/windows-update-signing.pem`(저장소 밖), `PTB_SIGNING_KEY` 로 변경 가능. `.gitignore` 에 `*.pem` 추가.
- [설계자 판단] 첫 공개 키: 구현 중 사용자가 자기 PC에서 `pnpm release:key init` 을 실행하고(비밀번호는 사용자만 앎) 출력된 공개 키를 코드에 넣는 단계를 계획에 둔다.
  자리표시자 키가 남은 채로는 `package:win`(QA 제외)과 `release:sign` 이 실패하도록 막는다.
- 키 교체 대비: 앱은 공개 키 **목록**을 받는다. 교체 시 새·옛 키를 모두 넣은 버전을 옛 키로 서명해 한 번 배포.

### 4. 전환 (A안)
- GitHub 업데이트가 들어간 첫 버전 X.Y.Z 를 GitHub 에 공개한 뒤, 같은 Setup.exe 를 `PokeTokenBar-Windows-X.Y.Z.zip` 으로 묶어 Drive 파일 새 버전으로 올린다.
- 기존 앱은 Drive 에서 새 버전을 감지 → 사용자가 ZIP 을 받아 Setup.exe 실행 → 설치판이 `InstanceHandoff` 로 실행 중인 압축 폴더판을 넘겨받는다.
- 세이브는 `%APPDATA%\PokeTokenBar Windows` 고정이라 유지된다. 압축 폴더는 사용자가 지운다(안내 문구).
- 실행 환경 승계 근거:
  - 데이터: `userData` 가 `%APPDATA%\PokeTokenBar Windows` 로 고정(`src/main/index.ts:20`) → 설치 위치와 무관.
  - 로그인 시 시작·바로가기·고정·프로토콜: 시작 시 `migrateLaunchAssociations`(`src/main/index.ts:257`)가 더 낮은 버전 exe 를 가리키는 항목을 현재 exe 로 옮긴다.
  - 실행 중 인스턴스·펫 상태: `InstanceHandoff` 가 이전 프로세스의 저장 완료를 기다린 뒤 넘겨받는다(1.0.0 펫 설정 복원 포함).
  - 앱 내 업데이트(설치판→설치판)는 같은 설치 경로에 덮어쓰므로 위 항목이 그대로 유지된다. 두 경로 모두 검증 대상.
- ZIP 배포 종료: 전환 버전(Setup.exe 를 담은 ZIP)을 Drive 에 올린 것을 마지막으로 Drive·ZIP 배포는 중단한다.
  CI·서명 스크립트는 Setup.exe 와 `latest.yml` 만 다룬다. 압축 폴더판의 버튼은 GitHub 릴리스 페이지를 연다.
- [설계자 판단] `nsis.runAfterFinish` 를 `true` 로 바꾼다. oneClick 설치 직후 앱이 켜져야 넘겨받기가 일어나고,
  로그인 자동 실행·`poketokenbar:` 등록이 새 exe 로 옮겨진다. `windows-update-smoke.mjs` 도 함께 수정.

## 제약
- Node ≥22.12, electron 45.2.3, electron-updater 6.8.11, NSIS per-user(UAC 없음).
- 모든 문구는 `windows-messages.ts` 8개 언어.

## 빌더 재량
- 모듈 분리(서명 검증·피드 조회·설치 조정), 테스트 더블 구조, UI 배너·설정 문구 배치.
- 테스트: 서명 검증(정상·변조·다른 키·크기 초과), 버전 비교, updateInfo 불일치 거부, 해시 불일치 시 설치 미호출, 차단 조건 재확인.
- CI 의 Drive IPC 스모크는 GitHub 업데이트 IPC 스모크로 교체.

## 한계 (수용)
- 매니페스트에 만료가 없어 예전 서명 yml 로 중간 버전 고정이 가능(다운그레이드는 불가) — Mac 과 동일.
- 첫 설치 시 SmartScreen 경고.
- 압축 폴더판은 자동 교체하지 않는다(전환 버전 이후 배포 중단).
