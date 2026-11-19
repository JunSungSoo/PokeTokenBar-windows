# Windows 앱 내 자동 업데이트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans. 체크박스(`- [ ]`)로 추적.

**Goal:** 업데이트 버튼 한 번으로 서명 검증된 NSIS 설치판으로 교체·재시작하고, 로그인 시 시작·데이터·바로가기·프로토콜을 그대로 승계한다.
**Architecture:** electron-updater(generic 피드 = GitHub `releases/latest/download/`)가 받고 설치하며, 앱이 `latest.yml` Ed25519 서명·updateInfo 일치·설치 파일 SHA-512 를 직접 검증한 뒤에만 `quitAndInstall` 한다. 릴리스 서명은 Node 스크립트로 어느 PC에서든 한다.
**Tech Stack:** Electron 45.2.3, electron-updater 6.8.11, electron-builder 26.18.0(NSIS), Node ≥22.12 `node:crypto` Ed25519, `gh` CLI.
**Spec:** `docs/superpowers/specs/2026-11-19-windows-auto-update-design.md`

## Global Constraints
- 저장소 고정 `JunSungSoo/PokeTokenBar-windows`. 설치 파일명 `PokeTokenBar-Windows-<version>-x64-Setup.exe`, 버전 `^\d+\.\d+\.\d+$`.
- yml ≤ 64KiB, sig ≤ 1KiB, 요청 타임아웃 20초, `credentials:'omit'`. 서명 = 원본 yml 바이트에 대한 Ed25519, base64. 공개 키 = raw 32바이트 base64.
- `autoDownload=false`, `autoInstallOnAppQuit=false`, `disableDifferentialDownload=true`.
- 문구는 모두 `src/shared/windows-messages.ts` 8개 언어. 개인 키·비밀번호는 저장소에 절대 넣지 않음(`.gitignore` 에 `*.pem`).
- **커밋하지 않음.** 사용자 지시가 있을 때만 커밋(전역 규칙). 각 Task 끝은 「테스트 통과 확인」으로 마친다.

## Review Focus
1. GitHub `latest/download` 는 CDN 으로 302 리다이렉트 → 리다이렉트 허용 + 최종 응답 크기 상한 (Task 2 테스트).
2. 릴리스는 공개됐는데 `.sig` 가 없음(서명 누락) → 업데이트 없음으로 처리, 오류 알림 반복 금지 (Task 2).
3. 다운로드 중 네트워크 끊김·디스크 부족 → `failed` 표시, 재시도 가능, `quitAndInstall` 미호출 (Task 3).
4. 버튼 연타·다운로드 중 자동 확인 → 설치 1회로 합침 (Task 3).
5. 다운로드 중 배틀·교환 시작 → 설치 직전 재확인으로 거부 (Task 3).

---
### Task 1: 서명 매니페스트 코어
**Files:** Create `src/main/update/manifest.ts`, `src/main/update/public-keys.ts`; Test `tests/update-manifest.test.mjs`(package.json `test` 목록에 추가)
**Produces:** `type SignedRelease={version:string;path:string;sha512:string}`; `parseUpdateManifest(yml:string):SignedRelease|undefined`(최상위 `version`/`path`/`sha512` 만 읽는 줄 파서, 파일명·버전 규칙 위반 시 undefined); `verifyManifest(bytes:Buffer,signatureBase64:string,keys:readonly string[]):boolean`(JWK OKP/Ed25519 로 KeyObject 생성); `updatePublicKeys:readonly string[]`; `placeholderKey='REPLACE_WITH_RELEASE_KEY'`.
- [ ] 테스트: 정상 서명 true / 1바이트 변조 false / 다른 키 false / 키 목록 중 두 번째 키 true / 잘못된 base64 false(throw 금지) / electron-builder 실제 형식 yml 파싱 / `path` 가 `../x.exe`·arm64·다른 접두사면 undefined.
- [ ] 실패 확인 → 구현 → `pnpm build && node --test tests/update-manifest.test.mjs` PASS.

### Task 2: GitHub 피드 조회
**Files:** Create `src/shared/github-release.ts`, `src/main/update/github-feed.ts`; Test `tests/github-feed.test.mjs`
**Consumes:** Task 1. **Produces:** `windowsReleaseRepository`, `windowsReleaseBase='https://github.com/JunSungSoo/PokeTokenBar-windows/releases/latest/download/'`, `windowsReleasePage`; `class GitHubUpdateFeed{constructor(request=fetch,clock=Date.now,base=windowsReleaseBase,keys=updatePublicKeys); check(minInterval=1_800_000):Promise<SignedRelease|null>}` — null = 릴리스 없음(404) 또는 `.sig` 없음. 캐시·중복 합치기는 `DriveReleaseSource` 와 동일 규칙.
- [ ] 테스트(가짜 fetch): 정상 / 302 후 200 허용 / 크기 초과 reject / 서명 불일치 reject / yml 404·sig 404 → null / 동시 호출 1회 요청 / 30분 내 캐시 / minInterval 0 우회.
- [ ] 구현 → PASS.

### Task 3: 설치 조정기
**Files:** Create `src/main/update/installer.ts`; Test `tests/update-installer.test.mjs`
**Consumes:** `SignedRelease`. **Produces:** `class UpdateInstaller{constructor(deps:{updater:Pick<AppUpdater,'checkForUpdates'|'downloadUpdate'|'quitAndInstall'>;blocked:()=>boolean;prepare:()=>Promise<void>;hashFile:(path:string)=>Promise<string>}); install(release:SignedRelease):Promise<void>}`. 순서: blocked → `checkForUpdates` updateInfo(version·path·sha512) 일치 → `downloadUpdate()`[0] 해시 일치 → blocked 재확인 → `prepare()` → `quitAndInstall(true,true)`. 오류 문구: `'배틀·챌린지·교환 중에는 업데이트할 수 없습니다.'`, `'업데이트 파일을 검증하지 못했습니다.'`.
- [ ] 테스트: 정상 순서 / 시작 시 blocked 거부·다운로드 안 함 / updateInfo 불일치 거부 / 해시 불일치 시 quitAndInstall 미호출 / 다운로드 reject 전파 후 재시도 가능 / 다운로드 후 blocked 거부 / 동시 install 2회 → 다운로드 1회.
- [ ] 구현 → PASS.

### Task 4: 앱 통합 (IPC·상태·UI)
**Files:** Modify `src/main/windows.ts`(Drive 경로 교체), `src/shared/windows.ts`, `src/main/usage/ipc.ts:469`(반환에 `updateBlocked:()=>boolean` 추가, `activity()` 재사용), `src/main/index.ts:241`, `src/main/usage-preload.cts`, `src/renderer/windows.js`, `src/renderer/update-banner.js`, `src/shared/windows-messages.ts`; Delete `src/main/drive-updates.ts`, `tests/drive-updates.test.mjs`, `scripts/drive-update-ipc-smoke.mjs`(고아가 되는 `drive-release.ts` 의 Drive 전용 함수 제거, `newerVersion`·`releaseVersion` 은 유지); Create `scripts/github-update-ipc-smoke.mjs`
- `UpdateStatus.state` 에 `'downloading'|'failed'`, `error?:string` 추가. `registerWindowsIPC` 의 `updateOptions` 를 `{feed?:GitHubUpdateFeed;installer?:UpdateInstaller;openPage?:(url)=>Promise<void>;automatic?:boolean}` 로 교체.
- `windows:update-install`: 설치판(`autoUpdater.isUpdaterActive()` && !portableBuild)이면 installer, 아니면 `windowsReleasePage` 열기. `prepare` = `finishUsage.forHandoff()` + `preferences.finishWrites()`.
- 버튼 문구: `업데이트`, `업데이트 받는 중…`, `업데이트하지 못했습니다. 다운로드 페이지 열기`. 건너뛰기·알림 1회 규칙 유지.
- [ ] smoke: 가짜 feed/installer 로 확인→버튼→install 호출, blocked 시 오류 표시, 비인가 창 차단. `pnpm typecheck && pnpm test` 통과(기존 실패 4건 외 신규 실패 0).

### Task 5: 빌드 설정·CI
**Files:** Modify `electron-builder.config.cjs`, `.github/workflows/windows-release.yml`, `.github/workflows/windows-x64.yml`, `scripts/windows-update-smoke.mjs`, `.gitignore`
- config: `forceCodeSigning:false`, `verifyUpdateCodeSignature`·`signtoolOptions`·CSC 요구 제거, `nsis.runAfterFinish:true`, 비QA `publish:{provider:'generic',url:windowsReleaseBase}`. 비QA 에서 `public-keys.ts` 에 `placeholderKey` 가 남아 있으면 throw.
- QA 빌드만 `extraMetadata.updateQA={feed:'http://127.0.0.1:4173/',publicKey}` 주입, 앱은 이 값이 있을 때만 키·피드를 대체.
- release.yml: Authenticode 단계·CSC env 제거, `gh release create --draft` 로 Setup.exe + latest.yml 만 업로드.
- windows-update-smoke: 테스트 키로 yml 서명 → 설치판 1.0.n 설치 → 버튼 → 1.0.n+1 로 교체·재시작 → 세이브 해시·로그인 등록 경로·바로가기 대상·프로토콜이 새 exe 를 가리키는지 확인. 압축 폴더판→Setup.exe 전환 시나리오 동일 검증. x64 CI 에 단계 추가.

### Task 6: 서명·키 스크립트
**Files:** Create `scripts/release/signing.mjs`(순수 함수), `scripts/release/key.mjs`, `scripts/release/sign.mjs`; Test `tests/release-signing.test.mjs`; Modify `package.json`(`release:key`, `release:sign`)
- `signing.mjs`: `generateKey(passphrase)→{pem,publicKey}`(PKCS#8, `aes-256-cbc`), `loadKey(pem,passphrase)`, `sign(bytes,key)`, `randomPassphrase()`(16바이트 → base32).
- `key.mjs init|public|verify`: 기본 경로 `~/.poketokenbar/windows-update-signing.pem`(`PTB_SIGNING_KEY` 로 변경), 이미 있으면 거부, init 은 비밀번호를 한 번만 출력하고 보관 안내.
- `sign.mjs <version>`: 저장소 확인 → 초안 존재·같은 버전 공개본 없음 → 초안 자산 다운로드 → exe SHA-512 = yml → 비밀번호(TTY 숨김, 비TTY 는 stdin) → 공개 키 ∈ `updatePublicKeys` → 서명·재검증 → `.sig` 업로드 → `gh release edit --draft=false`. `PTB_DRY_RUN=1` 은 업로드·공개 생략.
- [ ] 테스트: 서명·검증 왕복 / 틀린 비밀번호 reject / 파일명·버전 규칙 / 앱 키 불일치 거부. PASS.

### Task 7: 실제 키 주입 (사용자 단계)
- [ ] 사용자가 자기 PC에서 `pnpm release:key init` 실행 → 비밀번호는 종이, 암호화 파일은 2곳 백업 → 출력된 공개 키를 전달.
- [ ] `public-keys.ts` 의 `placeholderKey` 교체, `POKE_UPDATE_REPOSITORY` 없이 비QA config 로드가 통과하는지 확인.

### Task 8: 문서
- [ ] `docs/WINDOWS_GITHUB_UPDATES.md`: 흐름, 키 생성·백업·다른 PC 사용, 배포 순서(태그 → CI 초안 → `release:sign` → 공개), 전환(Setup.exe ZIP 을 Drive 마지막 배포), 한계.
- [ ] `docs/DRIVE_UPDATES_2026-11-16.md` 상단에 대체 안내 1줄, `code-report/2026-11-19-windows-auto-update.md` 핵심 근거.
- [ ] `superpowers:requesting-code-review` 1회 → Critical/Important 수정 → `pnpm typecheck && pnpm test` 최종 확인.
