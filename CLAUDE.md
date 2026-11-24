# CLAUDE.md — PMart CDC 가상 현장 (simulation)

PMart CDC(물류센터)의 **출고·피킹·상차**와 이어지는 **TMS 운송(CDC → MFC)** 을 돌리는 가상 현장이다.
형제 프로젝트 `../pmart-mfc-simulation`(MFC 가상 현장)을 토대로 만들고, 백엔드(`../pmart-backend`)에 대해 현장 단말처럼 계약 API 를 부른다.

## 기술 스택 (`../pmart-mfc-simulation` 과 같게)
Vite 6 + TypeScript 5 (strict) + React 19 + react-three-fiber 9 (Three.js 0.169) + Vitest 3.
- 화면 UI 는 React 컴포넌트(`src/ui`), 3D 장면은 react-three-fiber 컴포넌트(`src/render/scene`).
- 시뮬레이션 엔진(`src/sim`)·백엔드 어댑터(`src/backend` — `port.ts` + `mock/` + `http/`)·도메인(`src/domain`)은 React 에 의존하지 않는다(테스트가 화면 없이 돈다).
- 매 프레임 바뀌는 값(위치·수량)은 `useFrame` 안에서 three 객체를 직접 바꾸고 React 상태로 올리지 않는다.
- 설정·스크립트·폴더 구조(`package.json`, `tsconfig.json`, `vite.config.ts`, `server/`, `test/**/*.test.ts`)는 MFC 시뮬레이터를 따른다. 버전을 올리거나 라이브러리를 더하려면 먼저 사용자에게 묻는다.
- 화면 UI/UX 는 MFC 시뮬레이터를 그대로 따른다(사용자 2026-11-24). 다른 점은 설계 §9.
- 개발 서버 포트: **5182**. 이미 쓰는 포트 — 백오피스 5173~5176, MFC 시뮬레이터 5180, 라이더 시뮬레이터 5181, rider-backoffice 목 모드 5186.

## 센터 고정값 — 절대 바꾸지 않는다 (사용자 2026-11-24)
- **칠곡 중앙물류센터(칠곡 DC)**, 경상북도 칠곡군 지천면 산단터널로 240.
- **8,600평**, **건물 5층~7층** 사용, **보관 520만 유닛**.
- 코드에서는 `src/config.ts` `CDC_FACTS` 한 곳에만 두고 시험으로 지킨다. 설계 전체는 `docs/design/cdc-design.md`.

## 실제 DC 자료 — 거스르지 않는다 (사용자 2026-11-24)
- 알바몬 후기 https://community.albamon.com/post/detail/929845 (석간 13~22시, FC·분배·라인 작업 방식)
- 우아한청년들 https://www.woowayouths.com/story/culture/view/5/24 (실제 내부: DAS·DPS·휠소터·오토스토어, 보냉 커버 롤테이너)
- 같은 사이트 보도자료 https://www.woowayouths.com/media/press/view/1/27 (DAS 냉장·DPS 냉동·1차 고속분류기·비식재 오토스토어), 하루 일정 https://www.woowayouths.com/story/culture/view/1/10 (08:00 입고·13:00 선별·23:00 출발).
- 확인한 내용은 `docs/design/cdc-design.md` §2.
- 사용자 결정(2026-11-24): 층마다 2,867평 균등, 차량은 지하로 들어오고 승강기로 올림, 주간조 있음. 작업 방식·장비·시간을 정할 때 이 자료와 어긋나면 안 된다.
- 사용자 개념도·DC Wave 초안은 `docs/design/ref/`(원본, 수정하지 않음).

## 비즈니스 로직 근거 (`../pmart-backend/docs`, 읽기 전용)
- **CDC 업무 정본: `../pmart-backend/docs/business/WMS-business-logic.md`** — 특히 §12 이관 할당·Wave·실제 피킹(CDC-F-016~018), §13 가상 분류·검품·상차와 단일 출발(CDC-F-019~022), §14 운송 결과·MFC 원수령·수량 대사(CDC-F-023~025).
- MFC 문서(`MFC-business-logic.md`)의 규칙을 CDC 에 섞지 않는다. 용어·약어(TRF·TOUT·TIN·LPN·FEFO 등)는 `docs/business/glossary.md`.
- 운송: `docs/business/TMS-business-logic.md`, 보충 흐름 `docs/business/flows/replenishment-transfer.md`, `flows/forecast-based-supply-request.md`, SCM `SCM-business-logic.md`.
- 시뮬레이션 범위 결정: `docs/simulator/scope.md`(S-1~S-7, L-1~L-3), `docs/simulator/cdc/README.md`. 도면을 만들면 백엔드 쪽 위치는 `docs/simulator/cdc/layout/`(백엔드 문서 — 직접 쓰지 않고 요청).
- 계약: `../pmart-backend/contracts/openapi/cdc-*.yaml`(outbound·location·inventory 등), 서비스 구현 상태는 `services/cdc-*/CLAUDE.md`, 결정은 `docs/adr/`, 진행은 `docs/worklog/`.
- 백엔드 → 시뮬레이터 공지는 `docs/handoff/simulator/` 를 본다.

## 범위 (scope.md, 2026-11-09 결정)
- 한다: CDC **출고·피킹·상차**(S-6), **TMS = 차량·기사 정보, 배차, 실제 출발·도착 기록**(S-7, 경로는 OR-Tools 방향).
- 안 한다: **입고**, 재고 조정, 품질, 수요예측(S-3, L-2). CDC 재고는 시작 재고(시드)로 둔다 — 확인 필요.
- 도면은 CDC 마다 다르다 → 도면·칸 좌표는 센터별 데이터로 다루고 특정 배치를 코드에 박지 않는다(ADR-0050).

## 절대 규칙
- `../pmart-backend`, `../pmart-mfc-simulation`, `../pmart-clients` 는 **읽기만** 한다. 백엔드에 필요한 변경은 `docs/backend-requests.md` 에 적고 사용자에게 보고한다.
- 계약이 정본이다. `src/domain/contract.ts` 의 이름·상태값은 `pmart-backend/contracts/openapi/cdc-*.yaml` 을 그대로 따른다. 계약에 없는 엔드포인트를 HttpBackend 에서 추측해 부르지 않는다.
- MockBackend 는 계약 의미를 흉내 낼 뿐 실서버를 대신하지 않는다. 흉내 내며 정한 값은 `docs/backend-requests.md` "시뮬레이터가 정한 값"에 적는다.
- 서버가 확정한 결과만 확정으로 그린다. 응답이 없으면 결과 불명으로 보고 같은 Idempotency-Key 로 재전송한다. 실패로 단정하지 않는다.
- WMS 문서의 수량 원장 불변식(제1부 0.3)과 TRF 단일 출발 규칙을 바꾸지 않는다.
- 업무 문서에 없는 수치는 `src/config.ts` 에 근거 태그(`[확정]`/`[가정]`/`[시뮬]`)와 함께 둔다.
- 토큰은 localStorage 에 저장하지 않는다(sessionStorage 만).
- 실행하지 않은 테스트·빌드를 통과했다고 보고하지 않는다.
- 무거운 시험(vitest·build 등) 전에 PC 의 남은 실메모리를 본다. 4GB 아래면 미루고 사용자에게 알린다. 다른 세션이 띄운 프로세스는 끄지 않고 알린다.
- 작업 일지를 `docs/worklog/YYYY-MM-DD.md` 에 남긴다(형식은 `../pmart-mfc-simulation/docs/worklog/README.md` 를 따름).

## MFC 시뮬레이터 최신 반영 (PC1 담당)
`../pmart-mfc-simulation` 은 **다른 PC(PC1)** 가 개발한다(origin `code-and-pick/pmart-mfc-simulation`, `main`).
사용자가 "MFC 쪽 새로운 거 반영해줘" 같은 요청을 하면:
1. `git -C ../pmart-mfc-simulation status` 로 로컬 변경을 확인한다. 커밋 안 된 변경이 있으면 버리거나 stash 하지 말고 사용자에게 알린 뒤 진행 여부를 묻는다.
2. `git -C ../pmart-mfc-simulation pull --ff-only` 로 받아온다(merge·rebase·reset·push 하지 않는다. ff 가 안 되면 멈추고 보고).
3. `git -C ../pmart-mfc-simulation log --oneline <이전 HEAD>..HEAD` 와 diff 로 바뀐 점을 정리하고, 이 프로젝트에 반영할 것(공통 구조·백엔드 어댑터·규칙·`CLAUDE.md` 변경 등)을 골라 반영한다.
4. 무엇을 받아와 무엇을 반영했는지 일지에 남긴다.

## 명령 (구성 후)
```bash
npm run dev
npm test
npm run typecheck
npm run build
```
