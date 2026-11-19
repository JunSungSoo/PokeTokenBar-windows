# Windows 자동 업데이트 (GitHub Releases, 2026-11-19)

Drive 방식(`DRIVE_UPDATES_2026-11-16.md`)을 대체한다. 설계 근거는 `docs/superpowers/specs/2026-11-19-windows-auto-update-design.md`.

## 1. 흐름 (설치판)
1. 앱이 시작·창 열기·30분 주기·수동 확인 때 `https://github.com/JunSungSoo/PokeTokenBar-windows/releases/latest/download/` 의 `latest.yml` 과 `latest.yml.sig` 를 받는다. GitHub API 는 쓰지 않는다.
2. 앱에 내장된 공개 키 목록(`src/main/update/public-keys.ts`) 중 하나로 Ed25519 서명을 검증한다. 서명이 틀리면 수동 확인에서는 오류로 표시하고 자동 확인에서는 로그만 남긴다. `.sig` 가 없을 때(404)만 조용히 「업데이트 없음」으로 처리한다.
3. 서명된 yml 의 버전이 현재보다 높으면 알림과 **업데이트 버튼**을 보여 준다. 사용자가 누르기 전에는 아무것도 설치하지 않는다.
4. 버튼을 누르면 배틀·챌린지·교환 중인지 먼저 확인한다. 진행 중이면 거부한다.
5. 다운로드 후 electron-updater 의 정보(버전·파일명·sha512)가 서명 값과 같은지, 받은 파일의 SHA-512 가 서명 값과 같은지 확인한다. 하나라도 다르면 설치하지 않는다.
6. 차단 조건을 한 번 더 확인하고, 진행 중인 저장이 끝나기를 기다린 뒤 교체·재시작한다.

실패하면 배너와 설정에 이유를 보여 주고 「다운로드 페이지 열기」(GitHub 릴리스 페이지)를 준다.

### 설치가 중간에 실패했을 때
- 저장을 마친 뒤 설치 프로그램 실행이 실패하거나, 15초가 지나도 앱이 종료되지 않으면 앱이 **현재 버전으로 스스로 다시 실행**된다. 사용량 기록과 펫 상태는 저장된 상태 그대로 이어진다.
- 앱이 종료됐는데 다시 켜지지 않으면, 릴리스 페이지(`https://github.com/JunSungSoo/PokeTokenBar-windows/releases/latest`)에서 최신 `PokeTokenBar-Windows-X.Y.Z-x64-Setup.exe` 를 받아 직접 실행한다. 데이터(`%APPDATA%\PokeTokenBar Windows`)는 그대로 유지된다.

### 교체 후 그대로 유지되는 것
- 데이터: `userData` 가 `%APPDATA%\PokeTokenBar Windows` 로 고정이라 설치 위치와 무관하다.
- 로그인 시 시작·바로가기·작업 표시줄 고정·`poketokenbar:` 프로토콜: 시작 시 `migrateLaunchAssociations` 가 옛 exe 를 가리키는 항목을 현재 exe 로 옮긴다.
- 실행 중 인스턴스·펫 상태: `InstanceHandoff` 가 이전 프로세스의 저장 완료를 기다린 뒤 넘겨받는다.
- 설치판끼리 업데이트하면 같은 경로에 덮어쓰므로 위 항목이 그대로 남는다. 설치 직후 앱이 자동 실행된다(`runAfterFinish`).

## 2. 키 생성 (최초 1회)
1. 본인 PC 에서 `pnpm release:key init` 을 실행한다.
2. 화면에 한 번만 나오는 **무작위 비밀번호**를 종이에 적는다.
3. 출력된 공개 키를 `src/main/update/public-keys.ts` 의 `updatePublicKeys` 에 넣고 빌드한다. `pnpm release:key verify` 로 확인한 뒤 **커밋한다**. 버전 올리기와 태그는 이 커밋 위에서 만든다. 공개 키를 다시 보려면 `pnpm release:key public`.
4. 암호화된 키 파일(기본 `~/.poketokenbar/windows-update-signing.pem`)을 **2곳 이상** 백업한다. 예: 비공개 클라우드 + USB.

규칙:
- 비밀번호는 종이에만 둔다. 저장소·채팅·메모 앱에 쓰지 않는다. `*.pem` 은 `.gitignore` 대상이다.
- 키 파일이나 비밀번호를 잃으면 이미 설치된 앱은 더 이상 업데이트할 수 없다. 새 키는 설치판을 다시 배포해야 한다.
- 진짜 공개 키를 커밋하기 전에 태그를 만들면 CI 의 `package:win`(QA 제외)이 실패하고 서명도 거부된다.
- `init` 은 키 파일이 이미 있으면 덮어쓰지 않고 거부한다.

## 3. 다른 PC 에서 서명
1. 암호화된 키 파일을 그 PC 로 복사한다. 기본 경로에 두거나 `PTB_SIGNING_KEY` 환경 변수로 경로를 지정한다.
2. 저장소를 받고 `pnpm install`, `gh auth login` 을 끝낸다.
3. 배포할 **태그 커밋**을 체크아웃한다(`git fetch --tags` 후 `git checkout vX.Y.Z`). 서명 스크립트는 `HEAD` 가 `vX.Y.Z` 태그 커밋과 같지 않거나 `src/main/update/public-keys.ts` 에 커밋되지 않은 변경이 있으면 서명을 거부한다. 배포된 빌드와 같은 공개 키 목록으로만 검사하기 위해서다.
4. Windows 에서는 PowerShell 또는 Windows Terminal 에서 실행한다. 비밀번호를 숨겨서 입력할 수 없는 터미널(Git Bash/mintty, IDE 콘솔 등)에서는 스크립트가 실행을 거부한다.
   - 비밀번호를 파이프로 넘겨야 하는 경우에만 `PTB_PASSPHRASE_STDIN=1` 을 설정한다. 이때 입력은 표준 입력의 첫 줄을 읽으며 화면에 보일 수 있으니 주의한다.
5. `pnpm release:sign X.Y.Z` 를 실행하고 종이의 비밀번호를 입력한다.

## 4. 배포 순서
첫 릴리스 전에 2절을 끝내고 공개 키를 커밋한다.

1. `package.json` 의 `version` 을 올리고 커밋한다.
2. `vX.Y.Z` 태그를 만들어 push 한다.
3. GitHub Actions 에서 `windows-release` 워크플로를 수동 실행한다. "Use workflow from" 에서 `vX.Y.Z` 태그를 고른다. 결과는 **초안(draft)** 릴리스다(`Setup.exe`, `latest.yml`).
4. 서명 PC 에서 `PTB_DRY_RUN=1 pnpm release:sign X.Y.Z` 로 먼저 점검한다. 업로드·공개 없이 검증과 서명만 한다.
   - bash(한 번만 적용): `PTB_DRY_RUN=1 pnpm release:sign X.Y.Z`
   - PowerShell: `$env:PTB_DRY_RUN = '1'; pnpm release:sign X.Y.Z` 실행 후 반드시 `Remove-Item Env:PTB_DRY_RUN` 으로 지운다. 세션에 남아 있으면 5단계도 점검만 하고 공개하지 않는다. 새 터미널을 열어도 된다.
5. 통과하면 `pnpm release:sign X.Y.Z` 를 실행한다. `latest.yml.sig` 를 올리고 초안을 공개한다.
6. 공개 전에는 사용자 앱이 이 버전을 보지 못한다. `latest.yml.sig` 가 없으면 설치되지 않는다.

## 5. 키 교체
1. 새 키를 만들고 새 공개 키를 얻는다(`pnpm release:key init`, 다른 `PTB_SIGNING_KEY` 경로 사용).
2. `updatePublicKeys` 에 **새 키와 옛 키를 모두** 넣은 버전을 만든다.
3. 그 버전을 **옛 키로** 서명해 한 번 배포한다. 이때 `PTB_SIGNING_KEY` 가 옛 키 파일을 가리켜야 한다. 예: `$env:PTB_SIGNING_KEY = 'C:\...\old.pem'`. 사용자가 이 버전을 받으면 새 키도 신뢰한다.
4. 이후 버전부터 `PTB_SIGNING_KEY` 를 새 키 파일로 바꿔 서명한다. 옛 키는 충분히 퍼진 뒤 목록에서 뺀다.

## 6. Drive 에서의 전환 (한 번)
1. GitHub 업데이트가 들어간 첫 버전 X.Y.Z 를 위 순서로 GitHub 에 공개한다.
2. 그 `PokeTokenBar-Windows-X.Y.Z-x64-Setup.exe` 를 `PokeTokenBar-Windows-X.Y.Z.zip` 으로 묶어 기존 Drive 파일의 새 버전으로 올린다. 공유 링크 ID 는 유지한다.
3. 기존 앱이 Drive 에서 새 버전을 알려 주면 사용자가 ZIP 을 받아 Setup.exe 를 실행한다. 설치판이 실행 중인 압축 폴더판을 넘겨받는다. 세이브는 유지된다.
4. 이 ZIP 이 마지막 Drive 배포다. 이후 Drive·ZIP 배포는 하지 않는다. 사용자는 옛 압축 폴더를 직접 지운다.

## 7. Mac 저장소와 분리
Mac 은 `JunSungSoo/PokeTokenBar`, Windows 는 `JunSungSoo/PokeTokenBar-windows` 를 쓴다. 키도 따로 둔다.
같은 저장소에 섞으면 `releases/latest` 가 가리키는 릴리스가 플랫폼마다 달라져 한쪽 업데이트가 깨진다. 같은 키를 쓰면 한쪽 유출이 양쪽 앱의 위험이 된다.

## 8. 한계
- 코드 서명 인증서가 없어 첫 설치 때 SmartScreen 경고가 뜬다. 업데이트 무결성은 앱 내 서명·해시 검증으로 지킨다.
- 매니페스트에 만료가 없다. 예전 서명 yml 로 중간 버전에 묶어 둘 수는 있으나 다운그레이드는 되지 않는다.
- 압축 폴더판(portable)은 자동 교체하지 않는다. 확인·알림만 하고 버튼은 릴리스 페이지를 연다.
