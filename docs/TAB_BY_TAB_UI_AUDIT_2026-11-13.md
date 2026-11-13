# 탭별 Mac / Windows UI 비교 — 2026-11-13

## 비교 기준과 검증 범위

- Mac: `/Users/danbiedu/Desktop/holywater/PokeTokenBar`, HEAD `ad1bb7c`. 기존 이식 기준 `deaf07e`와 이전 도구 점검 기준 `186697a`보다 최신이다. 최근 `fe46ae0`의 아르세우스 폼 표시와 `ad1bb7c`의 상세 데이터 구성 개선까지 포함한다.
- Windows: 현재 작업 디렉터리의 소스와 `pnpm build`로 생성한 Electron 렌더러. 배포된 Windows 설치물의 화면을 직접 실행한 것은 아니다.
- 화면 구조는 원본 SwiftUI 구현과 대조했다. Mac 홈은 사용자가 제공한 이미지도 참고했다. 원본 Mac 앱을 동일 저장·동일 시점에서 새로 캡처한 픽셀 비교는 수행하지 않았다.
- 현재 앱은 임시 저장으로 숨김 Electron 창을 실행해 홈·상점·가방·컬렉션·상세·교환·CPU 배틀을 검증했다. 실제 사용자 저장은 사용하지 않았다.
- 이 문서의 **확인된 차이**와 OS 대응·사용자 지정은 구분한다. 이번 작업은 점검과 보고이며 앱 기능 코드는 변경하지 않았다.

우선순위 P1은 잘못된 데이터 표시, 기능 누락 또는 중요한 사용 흐름 차이이고, P2는 표시·탐색·밀도·부가 정보 차이다. 자동 테스트의 통과는 테스트한 계약의 통과이며 모든 화면이 Mac과 같다는 의미는 아니다.

## 전체 판정

**현재 앱은 Mac과 완전히 같은 화면·기능 상태가 아니다.** 6개 탭의 순서와 주요 흐름은 연결되어 있지만, 홈 정보 밀도와 상세 사용량, 컬렉션의 폼·특성 편집, 배틀 로비·종료 규칙, 고급 설정에 차이가 남아 있다.

| 영역 | 일치하거나 연결된 부분 | 주요 차이 |
|---|---|---|
| 홈 | 포켓몬→사용량→그래프→제공자→한도의 큰 순서, 토큰 축약 단위, 성장·진화 표시 | 카드/여백 때문에 덜 간결함. 회고·토큰 종류·모델 내역·그래프 전환·정교한 한도 표시 누락 |
| 상점 | 원본 PNG, 상품명·가격 단위, 가격순 병합, 알 등급 배지, 수량 구매, 구매 확인 | 부족한 잔액의 버튼 상태와 고가치 개체 경고 문구 차이 |
| 가방 | 아이템 순서, 사용 버튼, 보유형 부적 표시, 사용 후 홈 이동, 단풍 별도 창 | 사탕 졸업 시 버려지는 XP / 진화 후 이월 XP의 수치 안내 누락 |
| 컬렉션 | 4×4 도감, 검색·필터·정렬·기록, 진화 과정, 기술 교체·툴팁·기본 도구 | 폼 썸네일·특성 교체·메가 정보 없음. 아르세우스 폼별 표시가 최신 Mac과 다름 |
| 교환 | 대상 선택→양쪽 제안→승인/거절→백업/결과 | 수동 TCP 진입, 정체성 헤더와 대기/제안 영역 구성 차이 |
| 배틀 | 싱글 CPU/LAN, 6마리 등록·3마리 LAN 선발, 도구·프리셋, 전투·보조 창·보상 | 로비 배열, 순서 변경, 폼 썸네일, 기록, 제한 시간, CPU 창 닫기 규칙 차이 |
| 설정 | 별도 창, 8언어·품질·제공자·펫·알림·난이도·Windows 통합·백업 | 추적 계정 선택, 세션 키/조직, 복수 로그 경로, Mac v2 내보내기, 지원 링크 등 부족 |

## 공통 외형

| ID | 확인한 차이 | 판단 |
|---|---|---|
| G01 | 현재 `theme.css`는 크림색/짙은 회녹색 바탕과 붉은 강조색, 외곽선·그림자가 있는 카드다. Mac은 시스템 재질·강조색을 사용하며 제공된 홈 이미지는 반투명 다크·파란 강조색이다. | Windows 전용 스타일 차이. OS 기본 렌더링 차이와 별개로 앱에서 명시한 테마 차이도 있다. |
| G02 | 현재 상단에는 몬스터볼·PokeTokenBar·WINDOWS 브랜드 행과 아이콘 있는 탭이 추가된다. Mac은 텍스트 세그먼트가 바로 시작한다. 현재 네 번째 탭은 `도감`, Mac은 `컬렉션`이다. | P2. 탭의 의미와 차지하는 높이가 다르다. |
| G03 | 현재 상점/가방은 탭 안에 큰 화면 제목이 한 번 더 나오고 카드 안팎 여백도 더 크다. | P2. 원본보다 한 화면에 보이는 정보가 적다. |
| G04 | 홈 스프라이트 자체는 투명하지만, `#pane-home .companion`에 창 바탕과 다른 `--surface` 배경·테두리·그림자가 적용된다. | 사용자 요청 재확인 대상. 포켓몬 뒤를 창 색 그대로 보이게 한다는 요청과 현재 전체 파트너 카드의 배경은 구분해야 한다. |

근거: [theme.css](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/theme.css:1), [index.html](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/index.html:37), [Mac PopoverView.swift](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/PopoverView.swift:158).

## 1. 홈

| ID | Mac | 현재 Windows | 우선순위 |
|---|---|---|---|
| H01 | 오늘 합계를 크게, 주/월 합계는 작은 인라인 정보로 표시한다. | 오늘 수치 40px, 주/월을 각각 별도 상자로 표시하고 합계·비용을 여러 줄로 배치한다. 파트너/사용량 카드 테두리와 상단 브랜드까지 더해져 490×665 캡처에서 그래프와 제공자 영역이 아래로 밀린다. | P1: 사용자가 요청한 간결한 데이터 계층과 차이 |
| H02 | `상세`가 주·월·연 회고 화면으로 이동한다. 이전 기간, 현재 기간, 비교·최고 사용일·육성 기록을 본다. | `상세`는 같은 홈 안에서 제공자별 오늘/주/월 표를 펼치는 HTML details다. 회고 화면이 없다. | P1 |
| H03 | 선택 제공자의 오늘 합계·비용, 입력/출력/캐시 쓰기/캐시 읽기와 복수 모델별 사용량을 표시한다. | 제공자 선택 뒤 오늘 합계·비용과 Claude 최근 5시간 합계만 표시한다. | P1 |
| H04 | ActivityPanel에서 막대 그래프와 최근 활동 히트맵을 전환한다. | 막대 그래프와 기간 선택만 있다. 추가 제공자를 각각 표시하지 않고 `기타`로 합친다. | P2 |
| H05 | 한도 계정 탭, 계정 메타 정보, 만료/오래된 정보 안내, 상대 리셋 시간, 페이스 표시와 소진 예측 등 제공자별 표시가 있다. 지원하지 않는 제공자는 공식 한도 영역을 생략한다. | 계정별 창을 단순 목록과 progress로 모두 표시한다. 절대 리셋 시각·조회 실패/없음 위주이며 계정 선택·페이스·예측·인증 복구 안내가 없다. 공식 한도 영역도 항상 남는다. | P1 |
| H06 | 성장 바에 300ms 호버하면 수치가 바 안에 드러난다. 긴 진화 라인은 좌우 이동 안내가 있다. | 성장 바는 title 툴팁이고 원본의 확장 연출은 없다. 진화 라인의 원본 좌우 이동 버튼도 없다. | P2, 두께는 사용자 지정 유지 |

원본 PNG·타입 배지·기분 판정·진화 경로의 기본 자료와 토큰 축약 단위는 관련 검사에서 일치했다. 데이터 종류와 표시 계층의 누락을 계산 오류와 혼동하지 않아야 한다.

근거: [usage.js](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/usage.js:121), [Mac 홈 헤더](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/PopoverView.swift:220), [Mac 회고 화면](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/UsageRecapView.swift:355), [Mac 활동 표시](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/ActivityVisualization.swift:48).

## 2. 상점

맞는 부분: 민트→붉은 단풍→이상한 사탕→일반 알→고급 알→부적→희귀 알의 기본 순서, 구매한 부적의 뒤쪽 이동, 원본 알/사탕/부적 PNG, 고급·희귀 배지, 축약 토큰 가격, 수량 구매·인라인 확인, 고가치 개체 추가 확인, 알 구매 후 홈 이동.

| ID | 확인한 차이 | 우선순위 |
|---|---|---|
| S01 | 잔액 부족 시 Mac은 구매 버튼 대신 부족 안내를 보인다. 현재는 부족 안내와 비활성 구매 버튼이 함께 남는다. 알 부화 전 비활성 구매는 원본에도 있으므로 이 차이와 구분한다. | P2 |
| S02 | Mac은 이로치와 전설 경고 문구 및 확정 버튼을 구분한다. 현재 추가 경고는 `이로치 또는 희귀 개체`라는 일반 문구와 `놓아주고 구매 확정`을 사용한다. 경고 진입 조건은 이로치/전설로 맞지만 설명은 덜 정확하다. | P2 |
| S03 | 수량 조절은 Mac 네이티브 Stepper 대신 숫자 입력·별도 −/+ 버튼이다. 더 큰 제목·지갑·외곽선 카드는 G01/G03의 공통 스타일 차이다. | Windows 대응 / 표시 차이 |

알 3종이 같은 PNG인 것은 원본과 같다. 등급 배지로 구분하므로 이미지 누락으로 판단하지 않는다.

근거: [companion.js 상점](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/companion.js:318), [Mac ShopView.swift](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/ShopView.swift:113).

## 3. 가방

맞는 부분: 사탕/민트/단풍/부적 순서, `사용` 버튼, 수량 사용·확인, 상시 부적의 버튼 없는 적용 표시, 사용 후 홈 이동, 붉은 단풍 개체·IV 선택 별도 창, 빈 가방의 잠만보.

| ID | 확인한 차이 | 우선순위 |
|---|---|---|
| B01 | Mac은 사탕으로 졸업할 때와 초과 XP가 버려질 때 경고·버려지는 양을 표시하고, 진화 후 이월 XP도 숫자로 보여준다. 현재는 `+100M XP · 진화/졸업/성장 진행` 정도만 표시한다. 소비 전 손실 규모를 알 수 없다. | P1 |
| B02 | Mac은 알 상태와 사용 가능한 포켓몬 없음의 안내를 구분한다. 현재는 `현재 파트너에게 사용할 수 없습니다`로 통합하고 비활성 사용 버튼도 남긴다. | P2 |

근거: [companion.js 가방](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/companion.js:365), [Mac BagView.swift](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/BagView.swift:81).

## 4. 컬렉션 / 포획 기록 / 포켓몬 상세

맞는 부분: 도감/포획 기록 전환, 4×4·16칸 페이지, 이름/번호 검색, 희귀도·지방·이로치 필터, 대표 지정, 개체·폼·일반/이로치 선택, 기록의 진화 단계 링크, 현재 능력치·별 등급, 배운 기술 최대 4개 교체, 열린 메뉴의 상세 툴팁, 기본 배틀 도구 지정·저장 복원.

| ID | Mac | 현재 Windows | 우선순위 |
|---|---|---|---|
| C01 | 모든 폼을 썸네일 격자로 표시하고 미보유 폼은 흐리게 비활성화, 수집 수/전체 수를 함께 표시한다. | 보유 폼만 드롭다운에 나열한다. 이름도 일반 폼 문자열을 영문 제목 형태로 바꾸는 경우가 있어 원본 폼별 번역과 다르다. | P1 |
| C02 | 보유 개체의 특성을 가능한 특성 목록에서 변경할 수 있다. | 현재 특성·숨겨진 특성·설명은 보이지만 편집 컨트롤과 변경 IPC가 없다. | P1 |
| C03 | 메가스톤이 있는 종에 메가진화 정보 버튼·별도 정보 화면이 있다. | 해당 버튼과 정보 화면이 없다. 전투에서의 메가진화 구현과 별개다. | P1 |
| C04 | 최신 Mac은 아르세우스의 선택 타입 폼에 맞춰 타입과 심판의 메뉴/툴팁 타입을 표시한다. | 상세 데이터·캐시·기술 텍스트가 종 번호 기준이고 폼별 투영이 없다. 홈도 기본 종 메타데이터의 타입을 우선 사용한다. `정보는 기본 폼 기준` 문구로 대체되어 최신 Mac과 표시 데이터가 다르다. | P1 |
| C05 | 정렬은 위/아래 화살표 아이콘이며 사용자 정렬이면 강조된다. 도감은 휠/트랙패드 페이지 이동도 지원한다. | 정렬 select의 글자를 투명하게 숨겨 일반 아래 화살표만 보인다. 휠 페이지 이동도 없고, 캡처한 490×665 화면에서 페이지 버튼을 보려면 바깥 영역을 더 스크롤해야 한다. | P2 |
| C06 | 도감 종 카드에도 챌린지 챔피언 배지가 붙는다. | 상세와 포획 기록에는 있지만 도감 종 카드에는 없다. | P2 |
| C07 | 개체 상세에 부화 전 기도 횟수 이력을 표시한다. | 펫의 현재 알 기도 기능과 별개로, 개체 상세에는 그 이력이 없다. | P2 |

기본 능력치/종족값 표와 종족값 합계를 표시하지 않는 것은 사용자의 명시적 요청이다. 원본에 해당 표가 남아 있어도 복구할 누락으로 취급하지 않는다.

근거: [상세 렌더러](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/pokemon-details.js:49), [폼·기록 렌더러](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/companion.js:434), [Mac 상세](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/CompanionView.swift:1722), [Mac 폼 선택](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/CompanionView.swift:1820), [Mac 특성 변경](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/CompanionView.swift:1941).

## 5. 교환

맞는 부분: 직접 선택한 개체로 제안, 내가 주는/받는 개체 비교, 육성 중 개체 수신에 따른 덮어쓰기 경고, 재선택 시 승인 해제, 거절·탭 이탈 시 연결 정리, 양쪽 승인 후 저장과 사전 백업, 완료/상대 저장 미확인 안내.

| ID | 확인한 차이 | 판단 |
|---|---|---|
| T01 | Mac은 내 별명·고정 교환 코드·상대 정체성을 헤더에 유지하며 자동 탐색부터 시작한다. 현재는 방 열기/IPv4:포트 입력과 닉네임 편집부터 보인다. Apple Multipeer 자동 탐색은 없다. | 플랫폼 대응. 수동 TCP 상호 연결과 화면 동등성은 별개다. |
| T02 | Mac의 제안 비교는 한 줄 label→스프라이트/이름→희귀도다. 현재는 32/48px 이미지와 레벨·성격·폼·진행을 포함한 큰 카드다. | P2. 정보는 늘었지만 같은 영역 구조가 아니다. |
| T03 | Mac의 상대 제안/승인 대기 단계는 대기 안내와 재선택 중심이다. 현재는 제안 패널을 유지하고 버튼 상태·문구로 대기 단계를 나타낸다. | P2 |

승인 오른쪽에 거절을 나란히 두는 것은 사용자의 명시적 요청이다. 원본의 거절-공백-승인 배치로 되돌릴 필요가 없다.

근거: [trade.js](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/trade.js:17), [Mac TradeView.swift](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/TradeView.swift:92), [Mac 제안 패널](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/TradeProposalPanel.swift:23).

## 6. 배틀 / CPU 챌린지 / 별도 창

맞는 부분: 싱글 CPU 27연전·LAN, 6마리 등록, LAN 3마리 순서 선택, 기본 도구 우선 적용·동일 도구 차단·프리셋, HP/PP 이월·보상·상점, 전투 기술/대상/교체/메가진화, 필드와 능력 랭크 보조 창, 체크포인트 복원. 원본 Node 엔진·PokéRogue 플레이어·트레이너 자산의 원본 바이트 일치도 다시 검사했다.

| ID | 확인한 차이 | 우선순위 |
|---|---|---|
| R01 | 현재 로비에는 원본에 없는 100px 배틀 장식 영역과 큰 전체 폭 챌린지 버튼이 있다. 원본은 규칙·모드·탐색/팀·기록을 392px 스크롤 안에 두고 하단 챌린지/프리셋 버튼을 나란히 둔다. | P2 |
| R02 | 원본 LAN 등록 팀에는 비어 있는 슬롯과 좌우 순서 변경 버튼이 있다. 현재는 선택한 개체만 표시하고 해제·재선택으로 순서를 바꾼다. | P2 |
| R03 | 현재 메인 탭의 LAN 이미지 함수는 종 번호만 사용해 폼 스프라이트를 반영하지 않는다. Mac 로비는 SpriteView에 폼 인자를 전달한다. 별도 CPU 챌린지 썸네일은 현재도 폼을 처리하므로 로비 이미지 경로의 차이다. | P2, 폼 표시 오류 포함 |
| R04 | 원본 기록은 상대 선택에 따른 기록과 일시·모드·승패 카드, 빈 기록 안내를 표시한다. 현재는 버튼을 눌러 최근 10개의 상대 이름·승패·턴 수 목록을 본다. | P2 |
| R05 | LAN 상태에는 deadline과 시간 초과 판정이 있지만 현재 전투 헤더에 남은 시간 표시가 없다. Mac은 결정 제한 카운트다운을 표시한다. | P1 |
| R06 | Mac은 진행 중 CPU 전투의 창 닫기/앱 종료에서 기권 확인을 요구한다. Windows의 창 닫기 확인은 LAN에만 걸려 CPU 창은 그대로 닫을 수 있다. | P1. 원본 `0f5dc80` 변경 미반영 |
| R07 | 원본 전투 창은 측정된 명령/로그/푸터 크기로 창 높이를 조정한다. 현재는 초기 660×최대840과 내부 스크롤 구조다. 낮은 창에서는 일부 기술/상세를 스크롤해야 한다. | P2 |
| R08 | Mac의 우승 결과/이로치 보상은 전용 챔피언·보상 화면이다. 현재는 일반 결과·팀 격자·후보 버튼 목록으로 구성한다. 보상 기능 연결과 디자인 일치는 별개다. | P2 |
| R09 | Mac은 대기 로비 하단에서 바로 프리셋 편집이 가능하다. 현재는 연결 후 등록 영역 또는 CPU 준비에서 접근한다. | P2 |

더블 화면 비활성화는 사용자가 싱글부터 요청한 범위에 맞는다. LEAD를 캐릭터 영역 좌측 위 배지로 두는 것도 사용자 지정이다.

추가 코드 확인: Mac은 CPU/LAN 전투 중 교환 진입과 교환 중 배틀 진입을 상호 비활성화한다. 현재 교환·배틀의 공통 활동 상태가 UI/IPC 사이에 연결되어 있지 않다. 교환 확정의 저장 예약은 있지만 그것은 별도 보호다. 이 부분은 실제 동시 창 시나리오를 추가 재현해야 하므로 저장 손상이 발생했다고 단정하지 않는다.

근거: [battle.js](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/battle.js:8), [배틀 창](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/main/battle/windows.ts:16), [배틀 IPC](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/main/battle/ipc.ts:50), [Mac 로비](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/BattleLobbyView.swift:137), [Mac CPU 종료](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/ChallengeWindowController.swift:122), [Mac 턴 시간](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/BattleView.swift:129).

## 7. 설정 / 저장 / 업데이트

별도 설정 창은 사용자 요청이다. macOS 전용 Keychain·로그인 항목·Finder를 그대로 옮길 대상은 아니며, Windows 자격 파일·시작 앱·파일 탐색기 대응과 구분한다.

| ID | 확인한 차이 | 우선순위 |
|---|---|---|
| E01 | Mac 대표 선택은 `현재 파트너 따라가기 / 도감에서 선택`을 통해 도감으로 이동한다. 현재는 설정 안에서 포켓몬 목록을 직접 선택한다. | P2 |
| E02 | Mac은 Claude 추적 계정의 자동/최고 사용량/특정 계정 선택, 세션 키와 조직 관련 입력을 제공한다. 현재는 계정 폴더 추가·제거와 로그인 다시 읽기 위주다. 자격 파일 대응만으로 이 선택 기능을 대체하지 못한다. | P1 |
| E03 | Mac은 제공자별 복수 추가 로그 경로를 편집하고 일치 파일 수를 미리 확인한다. 현재는 제공자별 한 폴더 선택/해제만 보인다. | P2 |
| E04 | Mac은 호환 v2 저장을 내보낸다. 현재는 Windows 백업 내보내기와 Mac v2 가져오기만 있어 Windows→Mac 복귀를 위한 v2 내보내기 경로가 없다. | P1 |
| E05 | Mac은 홈 업데이트 배너·버전 건너뛰기/다시 표시를 제공한다. 현재는 Windows 알림과 설정의 확인→다운로드→설치 상태 흐름이다. 같은 화면 기능은 아니다. | P2 |
| E06 | Mac은 버전·GitHub·웹사이트·후원 링크와 문제 보고 기능을 제공한다. 현재 정보 영역은 이름/버전뿐이다. | P2 |
| E07 | Mac의 설정은 고정 헤더/본문 스크롤/링크 푸터다. 현재는 긴 섹션 목록과 끝의 `저장` 버튼이다. 일반 설정은 즉시 저장되고 이 버튼은 난이도를 저장하므로 화면상 저장 의미가 다르다. 서비스 장애 조회도 원본 알림 섹션 대신 일반에 배치된다. | P2 |

근거: [settings.html](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/settings.html:31), [settings.js](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/settings.js:44), [Windows 업데이트 UI](/Users/danbiedu/Desktop/holywater/PokeTokenBar-windows/src/renderer/windows.js:37), [Mac SettingsView.swift](/Users/danbiedu/Desktop/holywater/PokeTokenBar/Sources/PokeTokenBar/UI/SettingsView.swift:197).

## 유지할 사용자 지정

- 포켓몬 뒤 별도 이미지 배경 없음. G04의 파트너 카드 배경은 별도 확인 대상이다.
- 경험치 바 두께는 기존 조정의 70%인 9.8px, 테두리 없음.
- 현재 능력치만 표시하고 주황색·둥근 게이지 사용.
- 클릭 가능한 포켓몬만 호버 피드백.
- 가방 실행 버튼은 `사용`.
- 교환 승인 오른쪽에 거절 배치.
- 설정은 Windows 기능으로 구성한 별도 창.
- 더블은 후속 범위. LEAD는 캐릭터 영역 좌측 위 배지.

## 이번 검증 결과와 한계

- `pnpm build`: 통과.
- `node --test tests/presentation.test.mjs tests/battle-presentation.test.mjs`: **8개 통과 / 실패 0 / 건너뜀 0**. 원본 아이템 PNG, 순서·표시 상수와 1,000개 이상의 원본 배틀 자산·엔진 파일 바이트를 포함한다.
- `scripts/runtime-ui-smoke.mjs`: 통과. 실제 기본 렌더러·8개 언어·좁은 창·설정·아이템 구매/사용·컬렉션·기술/도구·재로딩 검사. 사용량과 상세 메타데이터 일부는 테스트 입력이다.
- `scripts/trade-ui-smoke.mjs`: 통과. 실제 IPC·LAN·양쪽 저장·거절/철회·탭 이탈 검사. 이 스크립트는 교환 영역을 추출해 `style.css`만 로드하고, 이번 교환 이미지에는 테스트 스프라이트를 사용했다. **전체 앱 theme.css와 탭 셸의 시각 검증으로 확대 해석하면 안 된다.**
- `scripts/battle-ui-smoke.mjs`: 통과. 실제 배틀 창·도구·전투·보조 창·원본 효과·보상·재개 검사. 턴 전환 중 캡처는 동작 중 프레임이므로 정지 비교 기준으로 쓰지 않았다.
- Windows 실기기의 DPI·폰트·투명 효과·네이티브 컨트롤은 이번 검증에 포함되지 않는다.
- Mac 앱을 같은 상태로 새로 캡처하지 않았으므로 정확한 픽셀 일치율이나 모든 애니메이션의 프레임/시간 일치를 주장하지 않는다.

현재 기본 렌더러 캡처: [홈](/Users/danbiedu/.codex/visualizations/2026/11/10/01a1c464-4bac-7270-896f-9e0808e195e6/tab-review-2026-11-13/home.png), [상점](/Users/danbiedu/.codex/visualizations/2026/11/10/01a1c464-4bac-7270-896f-9e0808e195e6/tab-review-2026-11-13/shop.png), [가방](/Users/danbiedu/.codex/visualizations/2026/11/10/01a1c464-4bac-7270-896f-9e0808e195e6/tab-review-2026-11-13/bag.png), [컬렉션](/Users/danbiedu/.codex/visualizations/2026/11/10/01a1c464-4bac-7270-896f-9e0808e195e6/tab-review-2026-11-13/collection.png).

전체 캡처는 다음 폴더에 저장했다:
`/Users/danbiedu/.codex/visualizations/2026/11/10/01a1c464-4bac-7270-896f-9e0808e195e6/tab-review-2026-11-13/`.

## 권장 개선 순서

1. 홈의 인라인 주/월 합계·밀도, 파트너 카드 배경, 회고·토큰 종류/모델 내역을 맞춘다.
2. 아르세우스 폼별 표시와 특성 교체·메가 정보·폼 격자를 연결한다.
3. 사탕 초과/이월 XP 경고와 LAN 시간 표시·CPU 종료 규칙을 맞춘다.
4. 한도 계정·페이스·예측과 고급 설정·Mac v2 내보내기를 연결한다.
5. 나머지 로비·교환·아이콘·기록·지원 화면의 표시 차이를 정리하고, 동일 저장의 Mac/Windows 화면을 다시 캡처한다.

## 후속 반영: 홈·상세 사용량·회고

사용자가 홈 범위를 먼저 선택해 G04·H01~H04와 H06의 긴 진화 라인 이동을 반영했다.
고정 두께 성장 바의 수치는 기존 툴팁으로 유지했다. H05는 계정 선택·상대 리셋 시각·
미지원 제공자 숨김을 반영했고 페이스/소진 예측 등은 남아 있다.
구현·동일 입력 비교·화면 검증은 [HOME_USAGE_PARITY.md](HOME_USAGE_PARITY.md)를 참조한다.
원래 표는 점검 시점의 기록이며 후속 탭의 차이를 완료로 바꾸지 않는다.
