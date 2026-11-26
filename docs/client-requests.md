# 클라이언트(pmart-clients) 요청

DC 시뮬레이터가 클라이언트 앱에 부탁하는 것. 클라이언트 저장소는 읽기만 하고, 요청은 여기 적고 클라이언트 세션에 보낸다.

| 번호 | 날짜 | 내용 | 상태 |
|---|---|---|---|
| C-01 | 2026-11-26 | **MFC PDA 앱(`apps/mfc_app`)으로 DC 작업자도 피킹·패킹·분배·출고(검품)·상차·하차** (사용자 "MFC 용 PDA 앱 만든 거 있는데 DC 작업자도 그 PDA 앱으로 피킹패킹분배출고상차하차 할 수 있게"). 아래 §C-01 | 반영됨 — pmart-clients 54825500(분배·패킹·검품·상차·MFC 하차 인계). 시뮬레이터 "실서버 한 건 돌리기" PDA 모드로 확인 |
| C-02 | 2026-11-26 | **PDA 검품에 분배 끝난 TRF 가 안 뜸** — 검품 화면 TRF 목록(`_TrfPick` → `pickedTransfers`)이 `GET /cdcs/{cdcId}/transfers?state=PICKED` 만 부른다. 분배·패킹(sorting-results)을 다 하면 TRF 가 **SORTED** 로 넘어가 검품 목록에서 빠짐. 검품은 SORTED(부분 검품·재검품이면 INSPECTED 전까지)를 보여야 함 — 분배는 PICKED, 검품은 SORTED 로 화면마다 상태를 달리. LAN 실측: TRF-SIM-MWXEHEAB SORTED(분류 6/6·검품 0) 인데 PDA 검품에 작업 없음 | 반영됨 — pmart-clients f8d500cf |

## C-01 DC 작업자 PDA 업무

지금 `apps/mfc_app` 에는 DC(CDC) 직원 로그인 → DC 업무 메뉴(피킹·분배/라인·검품·상차·지게차 적치)가 있고, **피킹만** 구현돼 있다(ce8f6003 · 13558b06). 나머지를 같은 앱에서 할 수 있게 부탁한다. 계약은 `pmart-backend/contracts/openapi/cdc-outbound-service.yaml`(0.29.0 LAN)·`transport-execution-service.yaml`·`cdc-inventory-service.yaml`·`mfc-inbound` 계약 그대로.

현장 흐름(칠곡 DC 시뮬레이터와 같게 — 기사 사진·알바몬 후기, 시뮬레이터 설계 §5·§9):

1. **피킹** (있음) — `POST /cdcs/{cdcId}/workers/{workerId}/next-tasks`(kind PICK) → `starts` → `pick-results`(줄마다 실피킹·부족 사유). 더 해 주면 좋은 것: 지역 바코드 스캔(REGION_BATCH 작업 — 같은 지역 MFC 몫을 한 카트에), 작업 방식별 화면 문구(pickMode: REGION_BATCH 지역 카트 · SKU_BATCH 라인용 상품 박스 · DISCRETE DPS 불 켜진 칸).
2. **분배·라인(DAS)** — 라인에 모인 상품 박스를 **상품 스캔** → 받는 MFC 칸마다 수량 표시(작업 줄의 `shares` — MFC 별 몫) → 칸마다 넣음 → MFC 몫이 끝나면 칸 박스 닫기. 냉장 야채는 분배대 MFC 크레이트(DISTRIBUTION). 결과는 아래 3 의 분류 실적.
3. **패킹(박스 닫기)** — MFC 박스(LPN) 바코드 스캔·내용 확인 → `POST /sorting-results` {waveId, trfId, workerId, lpns[{lpn, unitType BOX, state SEALED, temperatureZone, contents[{sku, lot, qty}]}]}. 한 LPN = 한 TRF(한 MFC).
4. **출고 검품** — 출고대기(91)에서 박스 스캔 → 수량·봉인·온도 확인 → `POST /inspection-results` {trfId, inspectorId, items[{lpn, result PASSED/FAILED, failReason, temperatureC}]}. 불합격은 재포장 → 다시 검품.
5. **상차** — 도크(90) 스캔(계획완료 때 자동 배정 `dockCode`) → 운행(tripId)·차량 확인 → 박스·R/T 스캔 → `POST /loading-results` {trfId, tripId, vehicleId, dockCode, workerId, action LOADED/UNLOADED, lpns[{lpn, compartment, sealNo}]}. 저온은 보냉 커버·온도. 다 실으면 운행 상차완료 `POST /trips/{tripId}/loading-completions` {transfers[{trfId, lpns, rtCount, sealNos}]} → 출차는 운영자/기사 몫(`departures`).
6. **하차(MFC 도착)** — MFC 점원이 같은 앱에서: 도착한 운행 확인(`GET /mfcs/{mfcId}/inbound-trips`) → R/T·박스 스캔 → 인계 `POST /trips/{tripId}/stops/{stopSeq}/handovers` → MFC 입고(수령) — mfc-inbound 입고 예정이 생기는 경로는 백엔드 R-26 ②·③ 답을 기다림(TransferApproved 보내는 곳 없음, 수령 확정 PC3 IV-8).
7. (함께) **지게차 보충(MOV)** — 팔레트 → 피킹면 이동. cdc-inbound 자동 보충(피킹면 최소·목표, 시뮬레이터 R-26 ① 값)이 LAN 에 들어가면 그 작업을 받는 화면.

역할·계정: `CDC_WORKER`(cdcw-fc·dl·qc·ld·fk), `CDC_SUPERVISOR`(claude-cdc-sup) — 백엔드 `lan-test-accounts.md` §2-5. 센터 CDC01.

시뮬레이터 쪽: LAN 에서 같은 흐름을 계약 API 로 한 건 돌리는 실행기가 있다(설정 탭 "한 건 돌리기") — 앱 화면을 만들 때 단계·요청 본문 예시로 써도 된다(`src/backend/http/lanRun.ts`).
