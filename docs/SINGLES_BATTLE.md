# 싱글배틀 구현과 검증

CPU 챌린지와 LAN 대인전을 기존 Node 엔진에 연결했다. 배틀 창은 별도로 열리며,
맥의 싱글 배치와 원본 연출 자산을 사용한다. 이번 UI는 싱글만 제공한다.
더블 엔진·자료·모드별 저장 구분과 슬롯별 명령 구조는 유지한다.

## 원본 비교 기준

처음 사용한 원본은 macOS 3.1.2의 deaf07e다. 최종 비교는 로컬 원본 186697a에서
수행했으며, 광각렌즈와 명중 카테고리도 반영했다. Windows 앱의 빌드에는 원본
체크아웃이 필요하지 않다.

- `BattleEngine`: 엔진, CPU 정책, 27명 상대와 장착 도구 자료를 그대로 사용한다.
- `BattleView`, `BattleMoveDetails`, `BattleSpriteSizing/Geometry`: 660px 싱글 창,
  높이 351px 필드, 282px 스테이지, HP 카드, 2×2 기술, 선택 상세, 교체·메가진화,
  턴 로그와 스프라이트의 크기·기준점을 비교했다.
- `BattleAuxiliaryWindows`, `BattleOwnStats`, `BattleFieldStatus`: 별도 필드·현재
  능력 랭크 창을 연결했다. 실제 랭크 7종과 특성·도구·활성 효과를 표시한다.
- `PokeRoguePlayer`, `ChallengeTrainerView`: 원본 플레이어 두 레이어, 트레이너,
  출전·기술·상태·날씨·방어·메가 연출, 배경과 음악 자료를 사용한다.
- `ChallengeRun/Shop/CashRewards`: 출전 순서와 장착 도구, HP/PP/상태 이월,
  회복·PP·교체·3전 버프·50포인트 보상, 7종 상점과 가격 인상 규칙을 연결했다.
  포인트 표기와 상품명·설명은 맥의 언어 자료를 사용한다.
- `BattleCoordinator`: 공개 6마리/실제 3마리, 호스트 선택, 명령 commit/reveal,
  Swift JSON 직렬화에 맞춘 해시, 기권·재연결·시간 제한과 전적을 비교했다.

원본 플레이어·트레이너 트리와 엔진 파일의 바이트 일치는 자동 테스트로 검사한다.
폰트와 시스템 창·버튼은 각 운영체제의 렌더링을 사용한다.

## 저장과 연결

CPU의 `challenge-singles-v1.json`에는 시작 시드와 명령 이력, 고정된 팀,
출전 준비, 회복 자원, 보상 단계, 포인트·구매 횟수·버프를 저장한다. 손상된
체크포인트는 덮어쓰지 않는다. 현금·이로치 지급은 `companion-v1.json`의 별도
원장과 연결한다. 개체 저장 후 챌린지 저장 전에 중단되더라도 같은 대상에게
재시도하며 중복 지급하지 않는다. 우승한 개체의 챔피언 날짜도 보관하며, 이로치 보상은 배틀 등록 가능 여부와 관계없이 졸업 개체를 선택할 수 있다.

LAN은 Windows끼리의 로컬 탐색과 IPv4:포트 수동 TCP를 제공한다. Mac의 Apple
Multipeer 탐색과 Windows 탐색은 별개이므로, Mac–Windows 연결은 원본 Mac의
수동 연결을 사용한다. 연결이 끊겨도 진행 중인 호스트 엔진을 30초간 유지한다.
그 안에 연결 코드를 다시 교환해 재연결할 수 있다. LAN은 프로세스 종료 후
진행 재개를 제공하지 않으며 전적만 `battle-history-v1.json`에 저장한다.

## 수행한 검증

- 타입 검사·빌드 통과, 전체 자동 테스트 80개 통과·실패 0·건너뜀 0.
- CPU 준비·턴 재생·보상 1회 적용·상점 가격 증가·자원 이월·재시작 복원·손상
  저장 보존, 챔피언 지급 중단 후 동일 대상 재시도와 중복 방지를 검사했다.
- 실제 TCP 두 상대의 공개 정보·3마리 선발·양쪽 확정·지난 턴 거부·기권·전적과
  진행 중 재연결, 잘못된 연결 코드로 진행이 사라지지 않는지를 검사했다.
- 원본 Mac `BattleCoordinator`를 호스트와 참가자로 각각 실행해 Windows 구현과
  실제 TCP로 연결했다. 한 턴 확정 후 기권과 양쪽 전적 저장이 모두 통과했다.
- 숨김 Electron 창에서 실제 프리로드·IPC·전투 엔진, 도구 미리보기/적용,
  트레이너 등장과 포켓몬 출전, 원본 Phaser 기술 재생, 기술 상세·툴팁,
  보조 창·창 재로딩·보상·상점·다음 대전을 검사했다. 8개 언어의 가로 넘침과
  툴팁의 화면 경계도 확인했다.
- 기존 홈·상점·가방·컬렉션·설정의 숨김 렌더러 회귀 검사도 통과했다.

```sh
pnpm typecheck
pnpm test
POKE_BATTLE_OPENING=1 POKE_BATTLE_EFFECTS=1 pnpm exec electron scripts/battle-ui-smoke.mjs
pnpm exec electron scripts/battle-lan-ui-smoke.mjs
pnpm exec electron scripts/runtime-ui-smoke.mjs
```

Mac 원본 비교 도구는 `scripts/build-mac-battle-oracle.mjs`로 만들고,
원본 모듈이 이미 빌드되어 있으면 `scripts/build-mac-battle-peer.mjs`로 실제
교차 대전 상대를 만든다. 각각 `POKE_MAC_BATTLE_ORACLE`, `POKE_MAC_BATTLE_PEER`에
실행 파일 경로를 지정해 `tests/battle-lan.test.mjs`를 실행한다. 테스트는 임시
저장과 별도 UserDefaults만 사용한다.

## Windows 확인 범위

현재 실측 결과는 Mac에서 실행한 Windows용 Electron 코드와 원본 Mac 코드의
로컬 검증이다. Windows x64 CI에 배틀 창·원본 출전/기술 연출·LAN 두 상대
검사를 추가했다. 실제 Windows 기기 두 대의 방화벽·다중 모니터·GPU/오디오,
설치본과 별도 기기의 Mac 사이 연결 확인은 남아 있다. 더블 화면과 Mac 저장의
챌린지 진행 가져오기는 이번 범위에 포함하지 않는다.

지닌도구의 컬렉션 기본값·Mac 저장 복원·미리보기·제한 안내·키보드 선택 검증은
[BATTLE_ITEMS_AUDIT.md](BATTLE_ITEMS_AUDIT.md)에 기록했다.
