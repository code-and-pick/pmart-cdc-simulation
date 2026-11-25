// 3D 가상 현장 — 한 번에 한 층을 그린다(층 버튼으로 전환, 설계 §9). MFC 시뮬레이터 render/scene/SiteScene.tsx 와 같은 틀.
// 매 프레임 바뀌는 값은 useFrame 안에서 three 객체를 직접 바꾼다(CLAUDE.md).
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef , lazy, Suspense } from 'react';
import * as THREE from 'three';
import { AppContext, useApp, useTick, useView, type AppCtx } from '../../app/context';
import { OUTBOUND, RACK, SHELF, TMS, BUILDING, MFCS } from '../../config';
import { TEMP_KO } from '../../sim/simulation';
import type { FloorLayout, Location } from '../../domain/layout';
import { SCENE, zoneBoxColor } from '../colors';
import { boxTexture, palletTexture, plateTexture } from '../sprites';
import { Agents, SimDriver } from './Agents';
import { Facility, Lights } from './Facility';
import { EquipmentModel, FreightLift, RollContainer, WorkLights } from './Equipment3D';
import { CameraRig, CellLabels, Picker } from './Core';
import { Shelves } from './Shelves';
import { BEAM_H, beamY, LOAD_MAX } from '../rackGeom';

export function SiteScene({ app }: { app: AppCtx }) {
  return (
    <Canvas shadows={false} flat dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 45, near: 0.1, far: 900, position: [60, 120, 140] }}>
      <AppContext.Provider value={app}>
        <Backdrop />
        <Lights />
        <FloorContent />
        <Agents />
        <SimDriver />
        {PerfProbe && (
          <Suspense fallback={null}>
            <PerfProbe />
          </Suspense>
        )}
        <CameraRig />
        <Picker />
        <CellLabels />
      </AppContext.Provider>
    </Canvas>
  );
}

function Backdrop() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const c = new THREE.Color(SCENE.backdrop);
    scene.background = c;
    scene.fog = new THREE.Fog(c, 260, 620);
  }, [scene]);
  return null;
}

function FloorContent() {
  const { layout } = useApp();
  const view = useView();
  const f = layout.floors.find((x) => x.floor === view.floor)!;
  return (
    <group key={f.floor}>
      <Facility f={f} L={layout} />
      <Racks f={f} />
      <Loads f={f} />
      <Shelves f={f} />
      {view.labelMode !== 'off' && <Plates f={f} />}
      <Lifts f={f} />
      <Staging f={f} />
      <FloorDocks f={f} />
      <Equipment f={f} />
      <WorkLights floor={f.floor} />
      <Selected />
    </group>
  );
}

// 성능 측정(npm run dev 에서만, MFC 와 같음)
const PerfProbe = import.meta.env.DEV ? lazy(() => import('../../dev/perf').then((m) => ({ default: m.PerfProbe }))) : null;

const tmp = new THREE.Object3D();

/** 기둥 옆 가새 한 칸 높이 */
const BRACE_STEP = 1.0;

/**
 * 랙 — 사진처럼 파란 기둥 + 옆면 지그재그 가새, 주황 빔.
 * 규격 [사용자]: 6m × 2.6m × 1m, 4단(바닥 + 2·4·6m 빔), 단 2m.
 */
function Racks({ f }: { f: FloorLayout }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);
  const braces = useRef<THREE.InstancedMesh>(null);
  const uprights = RACK.bundleBays + 1; // 줄(RackRow) 하나 = 묶음 한쪽 12개
  const panels = Math.round(RACK.height / BRACE_STEP);
  const counts = useMemo(() => {
    let b = 0;
    for (const r of f.rows) b += r.levels * 2;
    return { p: f.rows.length * uprights * 2, b, br: f.rows.length * uprights * panels };
  }, [f, uprights, panels]);
  useEffect(() => {
    let i = 0;
    let j = 0;
    let q = 0;
    const diag = Math.hypot(RACK.depth, BRACE_STEP);
    const ang = Math.atan2(RACK.depth, BRACE_STEP);
    for (const r of f.rows) {
      for (let k = 0; k < uprights; k++) {
        const z = r.z0 + k * RACK.bayW;
        for (const dx of [-RACK.depth / 2, RACK.depth / 2]) {
          tmp.position.set(r.cx + dx, RACK.height / 2, z);
          tmp.rotation.set(0, 0, 0);
          tmp.scale.set(0.09, RACK.height, 0.09);
          tmp.updateMatrix();
          posts.current!.setMatrixAt(i++, tmp.matrix);
        }
        // 옆면 가새: 앞뒤 기둥 사이를 1m 마다 번갈아 비스듬히
        for (let n = 0; n < panels; n++) {
          tmp.position.set(r.cx, (n + 0.5) * BRACE_STEP, z);
          tmp.rotation.set(0, 0, n % 2 ? ang : -ang);
          tmp.scale.set(0.04, diag, 0.04);
          tmp.updateMatrix();
          braces.current!.setMatrixAt(q++, tmp.matrix);
        }
      }
      for (let lv = 1; lv <= r.levels; lv++) {
        for (const dx of [-RACK.depth / 2, RACK.depth / 2]) {
          tmp.position.set(r.cx + dx, beamY(lv), (r.z0 + r.z1) / 2);
          tmp.rotation.set(0, 0, 0);
          tmp.scale.set(0.08, BEAM_H, r.z1 - r.z0);
          tmp.updateMatrix();
          beams.current!.setMatrixAt(j++, tmp.matrix);
        }
      }
    }
    tmp.rotation.set(0, 0, 0);
    posts.current!.instanceMatrix.needsUpdate = true;
    beams.current!.instanceMatrix.needsUpdate = true;
    braces.current!.instanceMatrix.needsUpdate = true;
  }, [f, uprights, panels]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, counts.p]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={SCENE.rackPost} />
      </instancedMesh>
      <instancedMesh ref={braces} args={[undefined, undefined, counts.br]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={SCENE.rackPost} />
      </instancedMesh>
      <instancedMesh ref={beams} args={[undefined, undefined, counts.b]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={SCENE.rackBeam} />
      </instancedMesh>
    </>
  );
}

/**
 * 칸마다 팔레트(1.1 × 1.1m 나무 받침) + 랩 씌운 박스 짐 — 사진처럼 단마다 2개.
 * 칸마다 인스턴스 하나(빈 칸은 크기 0). 원장 거래(ledger.version)가 바뀌면 다시 그린다 — 보충으로 팔레트가 줄어드는 게 보인다.
 */
function Loads({ f }: { f: FloorLayout }) {
  const { backend, sim } = useApp();
  const decks = useRef<THREE.InstancedMesh>(null);
  const loads = useRef<THREE.InstancedMesh>(null);
  const seen = useRef(-1);
  const at = useRef(0);
  useFrame(({ clock }) => {
    // 0.5초에 한 번만 다시 그림(성능 — ShelfStock 과 같음)
    if (seen.current === backend.ledger.version || (seen.current >= 0 && clock.elapsedTime - at.current < 0.5)) return;
    seen.current = backend.ledger.version;
    at.current = clock.elapsedTime;
    const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
    const color = new THREE.Color();
    const { w, d, deckH } = RACK.pallet;
    f.locations.forEach((l, i) => {
      const q = stock.get(l.code) ?? 0;
      const ratio = Math.min(1, q / l.capacity);
      const base = beamY(l.level) + BEAM_H / 2;
      tmp.position.set(l.pos.x, base + deckH / 2, l.pos.z);
      tmp.scale.set(q ? d : 0, q ? deckH : 0, q ? w : 0);
      tmp.updateMatrix();
      decks.current!.setMatrixAt(i, tmp.matrix);
      // 저온 방은 천장 단열·냉각기로 짐 높이 1.7m [가정 BUILDING.coldPalletH], 상온 2.0m
      const hMax = l.temp === 'AMBIENT' ? LOAD_MAX : Math.min(LOAD_MAX, BUILDING.coldPalletH);
      const h = (hMax - deckH) * (0.4 + 0.6 * ratio);
      tmp.position.set(l.pos.x, base + deckH + h / 2, l.pos.z);
      tmp.scale.set(q ? d * 0.96 : 0, q ? h : 0, q ? w * 0.96 : 0);
      tmp.updateMatrix();
      loads.current!.setMatrixAt(i, tmp.matrix);
      // MFC 상자 색(zoneBoxColor): 상온 흰 상자, 저온은 구역 바닥색을 진하게 — 갈색 덩어리 대신 MFC 처럼 밝게
      zoneBoxColor(l.temp, color);
      color.offsetHSL(0, 0, (((i * 13) % 7) - 3) / 140);
      loads.current!.setColorAt(i, color);
    });
    decks.current!.instanceMatrix.needsUpdate = true;
    loads.current!.instanceMatrix.needsUpdate = true;
    if (loads.current!.instanceColor) loads.current!.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={decks} args={[undefined, undefined, f.locations.length]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0xd9b98a} roughness={0.85} map={palletTexture()} />
      </instancedMesh>
      <instancedMesh ref={loads} args={[undefined, undefined, f.locations.length]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.8} map={boxTexture()} />
      </instancedMesh>
    </>
  );
}

/**
 * 랙 번호판 — 기사 사진(A10·A11·A12 …)처럼 랙 끝 기둥 위쪽 흰 판(사용자 2026-11-26 "사진대로").
 * 위치 코드가 통로 번호라 통로마다 하나 — 통로 입구 양쪽 랙 끝 기둥 위에 걸친 판(묶음마다 가로 통로 쪽 끝). 랙 줄보다 통로가 하나 많아
 * 랙 줄 기둥에 붙이면 한 줄에 둘이 붙는 곳이 생겼다(사용자 2026-11-26).
 */
function Plates({ f }: { f: FloorLayout }) {
  const y = (lv: number) => (lv - 0.5) * RACK.levelH + 0.4;
  return (
    <>
      {f.aisles.flatMap((a) => {
        const levels = f.spec.zones.find((z) => z.letter === a.zone)!.levels;
        return [...new Set(f.rows.map((r) => r.z0))].map((z0) => {
          if (!f.rows.some((r) => r.zone === a.zone && r.aisle === a.no && r.z0 === z0)) return null;
          return (
            <sprite key={`${a.plate}@${z0}`} position={[a.cx, y(levels), z0 - 0.12]} scale={[1.5, 0.95, 1]}>
              <spriteMaterial map={plateTexture(a.plate, { w: 256, h: 160 })} depthWrite={false} />
            </sprite>
          );
        });
      })}
    </>
  );
}

/** 화물 승강기 — 문(92)으로 5F 상온 롤테이너를 7F 도크 층으로 올린다. 모양은 MFC 화물 승강기와 같음, 문 앞에 사람이 오면 열린다 */
function Lifts({ f }: { f: FloorLayout }) {
  const { sim } = useApp();
  return (
    <>
      {f.lifts.map((l) => {
        const cx = (l.rect.x0 + l.rect.x1) / 2;
        const near = () => (sim.agents.some((a) => a.floor === f.floor && Math.abs(a.pos.x - cx) < 2 && a.pos.z > l.rect.z1 - 0.5 && a.pos.z < l.rect.z1 + 3) ? 1 : 0);
        return <FreightLift key={l.code} cx={cx} w={l.rect.x1 - l.rect.x0} zBack={l.rect.z0} zFront={l.rect.z1} label={`화물 승강기 ${f.floor}-${String(l.no).padStart(2, '0')}`} open={near} />;
      })}
    </>
  );
}

/**
 * 출고대기 롤테이너 자리(91) — 01~05 는 MFC 기본 배정. 저온은 은색 보냉 커버 [현장 사진].
 * 자키가 옮겨 온 박스 수만큼 R/T 가 늘어난다(한 대 = 박스 OUTBOUND.boxesPerRt 개 [가정], 자리에 최대 4대까지 보임).
 */
function Staging({ f }: { f: FloorLayout }) {
  const { sim } = useApp();
  const view = useView();
  useTick();
  const pick = view.mfcFilter ? MFCS.find((m) => m.id === view.mfcFilter)?.staging : null;
  return (
    <>
      {f.staging.map((s) => {
        const used = s.bay <= 5;
        const cold = s.temp !== 'AMBIENT';
        const boxes = sim.staged.get(s.code)?.length ?? 0;
        const rolls = Math.min(4, Math.ceil(boxes / OUTBOUND.boxesPerRt));
        return (
          <group key={s.code} position={[s.pos.x, 0, s.pos.z]} visible={!pick || s.bay === pick}>
            {pick === s.bay && (
              <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
                <ringGeometry args={[1.0, 1.25, 32]} />
                <meshBasicMaterial color={0xffb020} />
              </mesh>
            )}
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
              <planeGeometry args={[1.2, 1.9]} />
              <meshBasicMaterial color={SCENE.hazard} transparent opacity={0.35} />
            </mesh>
            {used && rolls === 0 && <RollContainer x={0} z={0} fill={0} />}
            {Array.from({ length: rolls }, (_, i) => (
              <RollContainer key={i} x={(i % 2) * 0.45 - 0.22} z={Math.floor(i / 2) * 0.8 - 0.4} cold={cold} fill={0.8} />
            ))}
          </group>
        );
      })}
    </>
  );
}

/** 설비 모형(Equipment3D) — 휠소터·DAS·분배·DPS·오토스토어. 이름은 구역 카드 */
function Equipment({ f }: { f: FloorLayout }) {
  return (
    <>
      {f.equipment.map((e) => (
        <EquipmentModel key={e.label} e={e} floor={f.floor} />
      ))}
    </>
  );
}

function Selected() {
  const view = useView();
  const l: Location | null = view.selected;
  if (!l || l.floor !== view.floor) return null;
  if (l.type === 'PICK_FACE')
    return (
      <mesh position={[l.pos.x, l.pos.y + 0.17, l.pos.z]}>
        <boxGeometry args={[SHELF.depth * 1.1, 0.36, (SHELF.unitLen / SHELF.slots) * 0.95]} />
        <meshBasicMaterial color={SCENE.selected} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    );
  return (
    <mesh position={[l.pos.x, (l.level === 1 ? 0 : beamY(l.level)) + RACK.levelH * 0.45, l.pos.z]}>
      <boxGeometry args={[RACK.depth * 1.05, RACK.levelH * 0.85, (RACK.bayW / RACK.slots) * 0.95]} />
      <meshBasicMaterial color={SCENE.selected} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

/**
 * 층 도크 — 북쪽 벽 접안 문(기사 사진: 셔터 문틀·도크 레벨러·주황 띠 볼라드·둥근 문 번호판 "4-16") + 바깥에 댄 차 + 도크 앞 R/T.
 * 차는 출차 1시간 전부터(또는 상차 중) 그 도크에 보인다 [사용자 2026-11-26 층마다 도크].
 */
function FloorDocks({ f }: { f: FloorLayout }) {
  const { sim } = useApp();
  useTick();
  const DOOR_Z = 0.05;
  const T0 = -12.5;
  const T1 = -1.2;
  const rolls = sim.atDock.filter((r) => r.floor === f.floor);
  const yardX = f.docks.length ? (Math.min(...f.docks.map((d) => d.pos.x)) + Math.max(...f.docks.map((d) => d.pos.x))) / 2 : 0;
  return (
    <group>
      {f.docks.map((d) => (
        <group key={d.code} position={[d.pos.x, 0, 0]}>
          {/* 접안 문(셔터 반쯤 열림·문틀) + 도크 레벨러(무늬 강판) + 양옆 볼라드(주황 띠) + 노란 바닥선 */}
          <mesh position={[0, 4.4, DOOR_Z]}>
            <boxGeometry args={[3.0, 1.6, 0.3]} />
            <meshStandardMaterial color={0xd2d6db} metalness={0.1} roughness={0.6} />
          </mesh>
          {[-1.6, 1.6].map((bx) => (
            <mesh key={bx} position={[bx, 2.6, DOOR_Z]}>
              <boxGeometry args={[0.2, 5.2, 0.3]} />
              <meshStandardMaterial color={0x8f969f} />
            </mesh>
          ))}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 1.1]}>
            <planeGeometry args={[2.4, 1.8]} />
            <meshStandardMaterial color={0xc3c8ce} metalness={0.1} roughness={0.6} />
          </mesh>
          {[-1.45, 1.45].map((bx) => (
            <group key={bx} position={[bx, 0, 2.3]}>
              <mesh position={[0, 0.6, 0]}>
                <cylinderGeometry args={[0.08, 0.08, 1.2, 12]} />
                <meshStandardMaterial color={0xe3e6ea} metalness={0.15} roughness={0.4} />
              </mesh>
              {[0.35, 0.65, 0.95].map((by) => (
                <mesh key={by} position={[0, by, 0]}>
                  <cylinderGeometry args={[0.083, 0.083, 0.08, 12]} />
                  <meshStandardMaterial color={0xf07a1a} />
                </mesh>
              ))}
            </group>
          ))}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 2.5]}>
            <planeGeometry args={[3.4, 0.12]} />
            <meshBasicMaterial color={SCENE.hazard} />
          </mesh>
          {/* 문 번호 — 사진의 둥근 판("4-16")처럼 층-번호 */}
          <sprite position={[0, 5.7, DOOR_Z + 0.3]} scale={[1.5, 1.5, 1]}>
            <spriteMaterial map={plateTexture(d.short, { bg: '#2fa7c9', fg: '#ffffff', w: 192, h: 192 })} depthWrite={false} />
          </sprite>
        </group>
      ))}
      {/* 도크 앞에 내려놓은 R/T(상차 대기) */}
      {rolls.slice(0, 14).map((_r, i) => (
        <RollContainer key={i} x={yardX - 6 + (i % 7) * 1.0} z={3.0 + Math.floor(i / 7) * 0.9} cold={f.floor !== 7} fill={0.8} />
      ))}
      {[...sim.runs.values()]
        .filter((r) => r.dock.floor === f.floor && (r.state === 'LOADING' || (r.state === 'PLANNED' && sim.time / 60 >= r.plan.plannedDepartMin - 60)))
        .map((r) => {
          const rts = Math.ceil(r.loaded.length / OUTBOUND.boxesPerRt);
          const name = `${r.plan.region.replace(/권$/, '')} ${TEMP_KO[r.plan.temp]}`;
          return (
            <group key={r.plan.tripId} position={[r.dock.pos.x, 0, 0]}>
              <mesh position={[0, 1.7, (T0 + T1 + 2) / 2]}>
                <boxGeometry args={[2.4, 2.6, T1 - T0 - 2]} />
                <meshStandardMaterial color={r.plan.temp === 'AMBIENT' ? 0xf4f6fa : r.plan.temp === 'CHILLED' ? 0xd8ecff : 0xcfe0f5} />
              </mesh>
              <mesh position={[0, 1.4, T0 + 0.8]}>
                <boxGeometry args={[2.3, 2.2, 1.6]} />
                <meshStandardMaterial color={0x2f6fd6} />
              </mesh>
              <sprite position={[0, 4.4, (T0 + T1) / 2]} scale={[4.2, 1.7, 1]}>
                <spriteMaterial map={plateTexture(`${name}\n${rts}/${TMS.vehicle.maxRt} R/T`, { w: 384, h: 156 })} depthWrite={false} />
              </sprite>
            </group>
          );
        })}
    </group>
  );
}

