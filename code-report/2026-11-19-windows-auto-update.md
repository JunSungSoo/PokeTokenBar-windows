# Windows 자동 업데이트 (GitHub Releases) 개발 근거

## 방식: electron-updater + NSIS (ZIP 교체 기각)
- Mac 방식(ZIP 교체)은 Windows 에서 실행 중 exe 를 덮어쓸 수 없어 외부 교체 스크립트가 필요하다. 압축 해제 위치도 사용자마다 달라 실패 경로가 많다.
- NSIS per-user 설치기는 실행 중 exe 교체와 재시작을 처리한다. UAC 가 없다.
- 대가로 배포 형태가 설치판으로 바뀐다. 압축 폴더판은 자동 교체하지 않는다.

## 신뢰: Authenticode 대신 앱 내 Ed25519
- 코드 서명 인증서가 없다. 게시자 이름이 없으면 electron-updater 는 Authenticode 검사를 건너뛰므로 그 검사에 기댈 수 없다.
- 그래서 `latest.yml` 에 Ed25519 분리 서명(`latest.yml.sig`)을 붙이고, 앱에 공개 키 목록을 내장해 검증한다.
- updateInfo(version·path·sha512)가 서명 값과 같을 때만 다운로드하고, 받은 파일의 SHA-512 를 직접 계산해 서명 값과 비교한 뒤에만 설치한다. 릴리스가 중간에 바뀌거나 파일이 변조돼도 설치되지 않는다.
- 비용은 SmartScreen 경고뿐이다. 수용했다.

## electron-updater 설정
- `autoDownload=false`, `autoInstallOnAppQuit=false`: 사용자가 버튼을 누르기 전에는 설치하지 않는다. 종료 시 무단 설치도 없다.
- `disableDifferentialDownload=true`: blockmap 은 서명 범위 밖이다. 차등 다운로드를 쓰면 검증되지 않은 바이트가 섞인다.
- `forceCodeSigning`·`verifyUpdateCodeSignature` 는 끈다.
- `nsis.runAfterFinish=true`: 설치 직후 앱이 떠야 InstanceHandoff 와 연결 이전이 일어난다.

## 배포: CI 는 초안, 서명은 로컬
- CI 는 빌드 후 초안 릴리스만 만든다. 개인키는 CI 비밀 값에 두지 않는다.
- 서명은 maintainer PC 에서 `release:sign` 으로 한다. 초안의 exe 해시 확인, 키 복호화, 공개 키 목록 포함 검사, 서명 재검증 후 `.sig` 업로드와 공개를 한다. `PTB_DRY_RUN=1` 로 사전 점검한다.
- 키는 비밀번호로 암호화한 PKCS#8 PEM 이다. 비밀번호 관리자가 없는 maintainer 를 위해 무작위 비밀번호는 종이에, 파일은 2곳 이상 백업한다. 어느 PC 에서든 파일만 복사하면 서명할 수 있다.
- 공개 키 목록 구조라서 키 교체는 새·옛 키를 모두 넣은 버전을 옛 키로 한 번 서명하면 된다.

## Mac 과 분리
- 저장소(`PokeTokenBar-windows`)와 키를 따로 쓴다. 같은 저장소면 `releases/latest` 가 플랫폼마다 달라져 한쪽 업데이트가 깨지고, 키 하나가 두 앱의 위험이 된다.

## 교체 후 동일성
- 새 코드 없이 기존 장치를 재사용한다.
- 데이터는 `%APPDATA%\PokeTokenBar Windows` 고정이라 설치 위치와 무관하다.
- 로그인 시 시작·바로가기·고정·`poketokenbar:` 는 시작 시 `migrateLaunchAssociations` 가 현재 exe 로 옮긴다.
- 실행 중 인스턴스·펫 상태는 `InstanceHandoff` 가 저장 완료를 기다린 뒤 넘겨받는다.
- 설치 직전에는 배틀·챌린지·교환 차단 조건을 다시 확인하고 `finishWrites` 로 저장을 기다린다.

## 전환
- 첫 GitHub 버전의 Setup.exe 를 `PokeTokenBar-Windows-X.Y.Z.zip` 으로 묶어 Drive 에 마지막으로 올린다. 기존 앱 코드를 바꾸지 않고 전환한다. 이후 Drive·ZIP 배포는 중단한다.

## 부수 수정
- `.gitignore` 의 `release` 를 `/release/` 로 고정했다. 이전 패턴은 `scripts/release/` 까지 무시해 서명 스크립트가 추적되지 않았다.
- `*.pem` 을 추가해 키 파일이 저장소에 들어가지 않게 했다.

## 한계
- SmartScreen 경고, 매니페스트 만료 없음(다운그레이드는 불가), 압축 폴더판 자동 교체 없음.
