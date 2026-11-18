# 설정 저장·버전 표시 및 Google Drive 업데이트

기준: Mac `origin/feature/battle` (`ad1bb7c9217028270ec28ebfb8d2dc05059a09da`)의 `SettingsView`, `UpdateChecker`, `DriveReleaseSource`.

## 반영 내용

- 앱 버전은 `package.json`의 `1.0.0`을 사용한다. 설정 본문만 스크롤되고 헤더와 하단의 **저장하기**, **v1.0.0**은 고정된다. 정보와 업데이트 영역에서도 설치 버전을 확인할 수 있다.
- 저장 버튼은 진행 중인 일반 설정 쓰기를 기다린 뒤 난이도 설정을 저장한다. 저장 중 중복 클릭을 막고 성공/실패 상태를 표시한다.
- Windows 배포 파일은 사용자가 제공한 `https://drive.google.com/file/d/1ykwLYTBaFVFfKR6NlDHXNcrk9p-lTQfY/view`로 고정했다. Mac ZIP 링크를 사용하지 않는다.
- Mac과 같이 인증 정보 없이 공개 HTML 제목에서 파일명 버전을 읽는다. `PokeTokenBar-Windows-1.0.0.zip`, `PokeTokenBar-Windows-1.0.0-x64.zip` 및 날짜가 붙은 x64 ZIP 이름을 지원한다. Mac용/ARM64/시험판/비정상 이름은 제외한다.
- 숫자로 된 세 버전 요소를 비교한다. `1.0.10 > 1.0.9`이며, 같은 버전·낮은 버전은 업데이트가 아니다.
- 자동 확인은 시작/창 열기/30분 주기이며 성공한 조회만 30분간 재사용한다. 중복 요청을 합치고 실패 후에는 재시도할 수 있다. 수동 확인은 캐시를 우회한다.
- 더 높은 버전이면 OS 알림(설정이 켜진 경우)과 메인/설정 창 상단 다운로드 버튼을 표시한다. 알림 클릭은 설정을 연다. 같은 버전의 OS 알림은 실행 중 중복 표시하지 않는다.
- 건너뛰기는 배너만 숨기며 설정에서 다운로드하거나 다시 표시할 수 있다. 다운로드 버튼은 고정된 Drive 페이지를 기본 브라우저로 연다. 맥과 같이 앱을 자동 설치하거나 실행 중 교체하지 않는다.
- 응답은 HTML/HTTP 200/고정 URL/최대 1 MiB/20초 제한으로 확인한다. 쿠키·인증 정보를 보내지 않는다. 메타데이터 실패 시 기존에 확인한 업데이트를 지우지 않는다.
- 기존 설치판 자동 교체 흐름 대신 Drive ZIP 다운로드 흐름으로 통일했다. CI도 이전 자동 설치 검사에서 Drive 버전 확인/알림/브라우저 열기 IPC 검사로 변경했다.

## 검증

- 지정한 실제 Drive 파일의 공개 응답: HTTP 200, `PokeTokenBar-Windows-1.0.0.zip - Google Drive`. 구현한 조회 코드도 `1.0.0`을 반환했다. 따라서 현재 설치 버전 `1.0.0`에는 업데이트 표시가 없어야 정상이다.
- 빌드, 타입 검사, 변경 형식 검사 통과.
- Windows 전체 127개: 117 통과, 실패 0, Swift/macOS 관련 10 제외. Docker 원본 Swift 비교 포함: 123 통과, 실패 0, macOS 네이티브 모듈 4개만 제외.
- 실제 sandbox preload/IPC: 같은·높은·낮은 버전, 숫자 비교, 알림 중복/비활성화, 건너뛰기/복구, 실패 재시도, 고정 다운로드 대상, 비인가 창 차단 통과. 브라우저/알림은 테스트 더블로 사용자에게 실제 표시하지 않았다.
- 실제 일반 UI: 저장 버튼 클릭 후 난이도 값 저장/복구, 8개 언어 × 360/490/650px에서 간격/가로 범위/하단 저장·버전 노출 검증 통과. 업데이트 배너와 설정 다운로드 버튼은 실제 IPC 더블까지 호출했고 자동 설치 IPC를 호출하지 않았다.
- 로그: `output/drive-updates-tests.log`, `drive-updates-swift-tests.log`, `drive-updates-ipc.log`, `drive-updates-ui.log`. 캡처: `output/drive-updates-ui/settings-general-650.png`, `settings-update-360.png` 등.

배포 시 앱 버전과 공개 파일 이름을 함께 올리고, 같은 Drive 파일의 새 버전 업로드 및 이름 변경으로 파일 ID를 유지한다. 공개 조회를 위해 [링크가 있는 모든 사용자 공유](https://support.google.com/drive/answer/2494822?hl=ko)를 사용한다. 파일 새 버전은 [Google Drive 버전 관리](https://support.google.com/drive/answer/2409045?hl=ko)에서 업로드할 수 있다. 이번 작업에서는 원격 파일을 업로드하거나 변경하지 않았다.

## 배포 준비 파일

바탕화면 `PokeTokenBar-Windows-1.0.0.zip`, 233,901,071 bytes. SHA-256: `2DD9A248D7B757A2497CA450DC32B74B9FB2238170B6C3B281E9999CFA5F30B7`.

ASAR 내 변경 코드와 전원 브리지 26개가 최종 빌드와 일치하며, ZIP 내부 전체 76개 파일 및 바탕화면 사본을 해시로 검증했다. 최종 EXE를 격리된 설정·세이브 경로로 실행하여 `Desktop ready`를 확인했다. 시작 검증에서는 실제 OS 업데이트 알림을 껐다. 검증 정보: `output/drive-updates-zip-verification.json`.
