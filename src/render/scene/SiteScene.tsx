// 3D 가상 현장 — 한 번에 한 층을 그린다(층 버튼으로 전환, 설계 §9). MFC 시뮬레이터 render/scene/SiteScene.tsx 와 같은 틀.
// 매 프레임 바뀌는 값은 useFrame 안에서 three 객체를 직접 바꾼다(CLAUDE.md).
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AppContext, useApp, useTick, useView, type AppCtx } from '../../app/context';
import { OUTBOUND, RACK, SHELF, TMS } from '../../config';
import { TEMP_KO } from '../../sim/simulation';
import { B1 } from '../../sim/site';
import type { FloorLayout, Location } from '../../domain/layout';
import { SCENE, ZONE_COLOR, zoneBoxColor } from '../colors';
import { plateTexture } from '../sprites';
import { Agents, SimDriver } from './Agents';
import { Facility, Lights } from './Facility';
import { EquipmentModel, RollContainer } from './Equipment3D';
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
  if (view.floor === 'B1') return <Basement />;
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
      <Equipment f={f} />
      <Selected />
    </group>
  );
}

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
  const uprights = RACK.baysPerSide + 1;
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
  const { backend } = useApp();
  const decks = useRef<THREE.InstancedMesh>(null);
  const loads = useRef<THREE.InstancedMesh>(null);
  const seen = useRef(-1);
  useFrame(() => {
    if (seen.current === backend.ledger.version) return;
    seen.current = backend.ledger.version;
    const stock = backend.ledger.onHandByLocation();
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
      const h = (LOAD_MAX - deckH) * (0.4 + 0.6 * ratio);
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
        <meshStandardMaterial color={SCENE.pallet} />
      </instancedMesh>
      <instancedMesh ref={loads} args={[undefined, undefined, f.locations.length]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
    </>
  );
}

/** 랙 끝 위 흰 번호판(예 C02) — 사진의 A10·A11 판 */
function Plates({ f }: { f: FloorLayout }) {
  const y = (lv: number) => lv * RACK.levelH + 0.9;
  return (
    <>
      {f.aisles.map((a) => {
        const levels = f.spec.zones.find((z) => z.letter === a.zone)!.levels;
        return (
          <sprite key={a.plate} position={[a.cx, y(levels), f.rows[0].z0 - 0.4]} scale={[2.4, 1.2, 1]}>
            <spriteMaterial map={plateTexture(a.plate)} depthWrite={false} />
          </sprite>
        );
      })}
    </>
  );
}

/** 화물 승강기 — 문(92)으로 롤테이너를 지하 B1 로 내린다 */
function Lifts({ f }: { f: FloorLayout }) {
  return (
    <>
      {f.lifts.map((l) => (
        <group key={l.code}>
          <mesh position={[(l.rect.x0 + l.rect.x1) / 2, 2, (l.rect.z0 + l.rect.z1) / 2]}>
            <boxGeometry args={[l.rect.x1 - l.rect.x0, 4, l.rect.z1 - l.rect.z0]} />
            <meshStandardMaterial color={SCENE.lift} />
          </mesh>
          <mesh position={[(l.rect.x0 + l.rect.x1) / 2, 1.4, l.rect.z1 + 0.02]}>
            <planeGeometry args={[(l.rect.x1 - l.rect.x0) * 0.7, 2.8]} />
            <meshStandardMaterial color={SCENE.liftDoor} />
          </mesh>
          <sprite position={[(l.rect.x0 + l.rect.x1) / 2, 5, (l.rect.z0 + l.rect.z1) / 2]} scale={[2.6, 1.3, 1]}>
            <spriteMaterial map={plateTexture(`${f.floor}-${String(l.no).padStart(2, '0')}`)} />
          </sprite>
        </group>
      ))}
    </>
  );
}

/**
 * 출고대기 롤테이너 자리(91) — 01~05 는 MFC 기본 배정. 저온은 은색 보냉 커버 [현장 사진].
 * 자키가 옮겨 온 박스 수만큼 R/T 가 늘어난다(한 대 = 박스 OUTBOUND.boxesPerRt 개 [가정], 자리에 최대 4대까지 보임).
 */
function Staging({ f }: { f: FloorLayout }) {
  const { sim } = useApp();
  useTick();
  return (
    <>
      {f.staging.map((s) => {
        const used = s.bay <= 5;
        const cold = s.temp !== 'AMBIENT';
        const boxes = sim.staged.get(s.code)?.length ?? 0;
        const rolls = Math.min(4, Math.ceil(boxes / OUTBOUND.boxesPerRt));
        return (
          <group key={s.code} position={[s.pos.x, 0, s.pos.z]}>
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
 * 지하 B1 — 차량 접안 자리(90). 8,600평 밖 공용 시설. 북쪽에 승강기 착지(위층과 같은 승강기), 그 남쪽 상차 마당, 접안 문 남쪽에 차.
 * 차는 운행(노선 × 온도대)마다 한 대 — 22:00 배차 뒤 접안 문에 서고, 실린 R/T 수를 차 위에, 출차하면 사라진다.
 */
function Basement() {
  const { layout, sim } = useApp();
  useTick();
  const w = Math.max(6 + layout.docks.length * 4.5 + 4, layout.floors[0].lifts[layout.floors[0].lifts.length - 1].rect.x1 + 4);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[w / 2, -0.01, 4]}>
        <planeGeometry args={[w, 30]} />
        <meshStandardMaterial color={SCENE.floor} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[w / 2, 0.004, B1.corridorZ]}>
        <planeGeometry args={[w, 1.4]} />
        <meshBasicMaterial color={SCENE.hazard} transparent opacity={0.25} />
      </mesh>
      {layout.floors[0].lifts.map((l) => (
        <group key={l.no}>
          <mesh position={[(l.rect.x0 + l.rect.x1) / 2, 2, B1.liftZ]}>
            <boxGeometry args={[l.rect.x1 - l.rect.x0, 4, 3.5]} />
            <meshStandardMaterial color={SCENE.lift} />
          </mesh>
          <sprite position={[(l.rect.x0 + l.rect.x1) / 2, 5, B1.liftZ]} scale={[2.6, 1.3, 1]}>
            <spriteMaterial map={plateTexture(`승강기 ${l.no}`)} />
          </sprite>
        </group>
      ))}
      {layout.docks.map((d) => (
        <group key={d.code} position={[d.pos.x, 0, 0]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, (B1.truckZ0 + B1.truckZ1) / 2]}>
            <planeGeometry args={[3.6, B1.truckZ1 - B1.truckZ0 + 2]} />
            <meshBasicMaterial color={ZONE_COLOR[d.temp]} transparent opacity={0.3} />
          </mesh>
          {/* 접안 문(사진: 셔터 반쯤 열림·문틀) + 도크 레벨러(무늬 강판) + 양옆 볼라드(주황 띠) + 노란 바닥선 */}
          <mesh position={[0, 2.6, B1.doorZ + 1.2]}>
            <boxGeometry args={[3.4, 5.2, 0.25]} />
            <meshStandardMaterial color={0x8f969f} transparent opacity={0.35} />
          </mesh>
          <mesh position={[0, 4.4, B1.doorZ + 1.1]}>
            <boxGeometry args={[3.0, 1.6, 0.3]} />
            <meshStandardMaterial color={0xd2d6db} metalness={0.1} roughness={0.6} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, B1.doorZ + 0.3]}>
            <planeGeometry args={[2.4, 1.6]} />
            <meshStandardMaterial color={0xc3c8ce} metalness={0.1} roughness={0.6} />
          </mesh>
          {[-1.45, 1.45].map((bx) => (
            <group key={bx} position={[bx, 0, B1.doorZ - 0.5]}>
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
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, B1.doorZ - 1.4]}>
            <planeGeometry args={[3.4, 0.12]} />
            <meshBasicMaterial color={SCENE.hazard} />
          </mesh>
          {/* 문 번호 — 사진의 둥근 판("4-16")처럼 */}
          <sprite position={[0, 5.6, B1.doorZ + 0.9]} scale={[1.6, 1.6, 1]}>
            <spriteMaterial map={plateTexture(d.short.replace('B1-', 'B1·'), { bg: '#2fa7c9', fg: '#ffffff', w: 192, h: 192 })} />
          </sprite>
        </group>
      ))}
      {[...sim.runs.values()]
        .filter((r) => r.state === 'PLANNED' || r.state === 'LOADING')
        .map((r) => {
          const rts = Math.ceil(r.loaded.length / OUTBOUND.boxesPerRt);
          // 접안 간격 4.5 m 안에 들어가게 짧게 두 줄 — 노선·정차는 오른쪽 ⛟ 운송 표에
          const name = `${r.plan.region.replace(/권$/, '')} ${TEMP_KO[r.plan.temp]}`;
          return (
            <group key={r.plan.tripId} position={[r.dock.pos.x, 0, 0]}>
              <mesh position={[0, 1.7, (B1.truckZ0 + B1.truckZ1 - 2) / 2]}>
                <boxGeometry args={[2.4, 2.6, B1.truckZ1 - B1.truckZ0 - 2]} />
                <meshStandardMaterial color={r.plan.temp === 'AMBIENT' ? 0xf4f6fa : r.plan.temp === 'CHILLED' ? 0xd8ecff : 0xcfe0f5} />
              </mesh>
              <mesh position={[0, 1.4, B1.truckZ1 - 0.8]}>
                <boxGeometry args={[2.3, 2.2, 1.6]} />
                <meshStandardMaterial color={0x2f6fd6} />
              </mesh>
              <sprite position={[0, 4.4, (B1.truckZ0 + B1.truckZ1) / 2]} scale={[4.2, 1.7, 1]}>
                <spriteMaterial map={plateTexture(`${name}\n${rts}/${TMS.vehicle.maxRt} R/T`, { w: 384, h: 156 })} />
              </sprite>
            </group>
          );
        })}
    </group>
  );
}

