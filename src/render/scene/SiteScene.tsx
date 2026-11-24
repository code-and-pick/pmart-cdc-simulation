// 3D 가상 현장 — 한 번에 한 층을 그린다(층 버튼으로 전환, 설계 §9). MFC 시뮬레이터 render/scene/SiteScene.tsx 와 같은 틀.
// 매 프레임 바뀌는 값은 useFrame 안에서 three 객체를 직접 바꾼다(CLAUDE.md).
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AppContext, useApp, useView, type AppCtx } from '../../app/context';
import { RACK } from '../../config';
import type { FloorLayout, Location, Rect } from '../../domain/layout';
import { SCENE, ZONE_COLOR } from '../colors';
import { plateTexture } from '../sprites';

export function SiteScene({ app }: { app: AppCtx }) {
  return (
    <Canvas shadows={false} flat dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 45, near: 0.1, far: 900, position: [60, 120, 140] }}>
      <AppContext.Provider value={app}>
        <Backdrop />
        <ambientLight intensity={0.85} />
        <directionalLight position={[60, 120, 40]} intensity={1.1} />
        <FloorContent />
        <CameraRig />
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
      <Slab w={layout.width} d={layout.depth} />
      {f.zones.map((z) =>
        z.kind === 'RACK' ? <Tint key={z.id} r={z.rect} color={ZONE_COLOR[z.temp!]} /> : z.kind === 'BAND' ? <Tint key={z.id} r={z.rect} color={SCENE.band} opacity={0.6} /> : null,
      )}
      <Racks f={f} />
      <Loads f={f} />
      {view.labelMode !== 'off' && <Plates f={f} />}
      <Lifts f={f} />
      <Staging f={f} />
      <Equipment f={f} />
      <Selected />
    </group>
  );
}

function Slab({ w, d }: { w: number; d: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[w / 2, -0.01, d / 2]}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color={SCENE.floor} />
    </mesh>
  );
}

function Tint({ r, color, opacity = SCENE.zoneTint }: { r: Rect; color: number; opacity?: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(r.x0 + r.x1) / 2, 0.005, (r.z0 + r.z1) / 2]}>
      <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

const tmp = new THREE.Object3D();

/** 랙 기둥(파랑)·빔(주황) — 사진처럼 */
function Racks({ f }: { f: FloorLayout }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);
  const counts = useMemo(() => {
    let p = 0;
    let b = 0;
    for (const r of f.rows) {
      p += (RACK.baysPerSide + 1) * 2;
      b += r.levels * 2;
    }
    return { p, b };
  }, [f]);
  useEffect(() => {
    let i = 0;
    let j = 0;
    for (const r of f.rows) {
      const h = r.levels * RACK.levelH;
      for (let k = 0; k <= RACK.baysPerSide; k++) {
        for (const dx of [-RACK.depth / 2, RACK.depth / 2]) {
          tmp.position.set(r.cx + dx, h / 2, r.z0 + k * RACK.bayW);
          tmp.scale.set(0.09, h, 0.09);
          tmp.updateMatrix();
          posts.current!.setMatrixAt(i++, tmp.matrix);
        }
      }
      for (let lv = 1; lv <= r.levels; lv++) {
        for (const dx of [-RACK.depth / 2, RACK.depth / 2]) {
          tmp.position.set(r.cx + dx, lv * RACK.levelH - 0.08, (r.z0 + r.z1) / 2);
          tmp.scale.set(0.1, 0.12, r.z1 - r.z0);
          tmp.updateMatrix();
          beams.current!.setMatrixAt(j++, tmp.matrix);
        }
      }
    }
    posts.current!.instanceMatrix.needsUpdate = true;
    beams.current!.instanceMatrix.needsUpdate = true;
  }, [f]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, counts.p]} frustumCulled={false}>
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
 * 칸마다 팔레트 짐(갈색 상자) — 재고 원장이 붙기 전이라 시드 모양만 [시뮬]. 누르면 그 칸을 고른다.
 * 1단은 사진처럼 바닥 피킹면.
 */
function Loads({ f }: { f: FloorLayout }) {
  const view = useView();
  const { backend } = useApp();
  const ref = useRef<THREE.InstancedMesh>(null);
  // 원장에 현물이 있는 칸만 그린다(시작 재고 시드). 상자 높이 = 칸 용량 대비 현물
  const filled = useMemo(() => {
    const stock = backend.ledger.onHandByLocation();
    return f.locations.filter((l) => (stock.get(l.code) ?? 0) > 0).map((l) => ({ l, ratio: Math.min(1, (stock.get(l.code) ?? 0) / l.capacity) }));
  }, [f, backend]);
  useEffect(() => {
    const m = ref.current!;
    const color = new THREE.Color();
    filled.forEach(({ l, ratio }, i) => {
      const h = RACK.levelH * 0.72 * (0.35 + 0.65 * ratio);
      tmp.position.set(l.pos.x, (l.level - 1) * RACK.levelH + h / 2 + 0.12, l.pos.z);
      tmp.scale.set(RACK.depth * 0.9, h, (RACK.bayW / RACK.slots) * 0.82);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      color.setHex(SCENE.box).offsetHSL(((i * 37) % 11) / 400 - 0.012, 0, ((i * 13) % 7) / 120 - 0.02);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [filled]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null) view.select(filled[e.instanceId].l);
  };
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, filled.length]} onClick={onClick} frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial />
    </instancedMesh>
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

/** 출고대기 롤테이너 자리(91) — 01~05 는 MFC 기본 배정. 저온은 은색 보냉 커버 [현장 사진] */
function Staging({ f }: { f: FloorLayout }) {
  return (
    <>
      {f.staging.map((s) => {
        const used = s.bay <= 5;
        const cold = s.temp !== 'AMBIENT';
        return (
          <group key={s.code} position={[s.pos.x, 0, s.pos.z]}>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
              <planeGeometry args={[1.2, 1.9]} />
              <meshBasicMaterial color={SCENE.hazard} transparent opacity={0.35} />
            </mesh>
            {used && (
              <mesh position={[0, 0.9, 0]}>
                <boxGeometry args={[0.8, 1.7, 0.7]} />
                <meshStandardMaterial color={cold ? SCENE.coldCover : SCENE.rollContainer} metalness={cold ? 0.5 : 0} roughness={cold ? 0.35 : 0.8} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

const EQUIP_COLOR: Record<string, number> = { WHEEL_SORTER: SCENE.conveyor, DPS: SCENE.conveyor, DAS: SCENE.conveyor, SPLIT: 0x3aa35a, AUTOSTORE: SCENE.autostore };

/** 설비 자리 — 지금은 높이 있는 판과 이름표만(설비 모양은 다음 단계) */
function Equipment({ f }: { f: FloorLayout }) {
  return (
    <>
      {f.equipment.map((e) => {
        const cx = (e.rect.x0 + e.rect.x1) / 2;
        const cz = (e.rect.z0 + e.rect.z1) / 2;
        const h = e.kind === 'AUTOSTORE' ? 5 : 0.9;
        return (
          <group key={e.label}>
            <mesh position={[cx, h / 2, cz]}>
              <boxGeometry args={[(e.rect.x1 - e.rect.x0) * 0.9, h, (e.rect.z1 - e.rect.z0) * (e.kind === 'AUTOSTORE' ? 0.8 : 0.35)]} />
              <meshStandardMaterial color={EQUIP_COLOR[e.kind]} transparent opacity={0.85} />
            </mesh>
            <sprite position={[cx, h + 1.6, cz]} scale={[7, 1.4, 1]}>
              <spriteMaterial map={plateTexture(e.label, { bg: SCENE.pill, fg: '#ffffff', w: 640, h: 128 })} />
            </sprite>
          </group>
        );
      })}
    </>
  );
}

function Selected() {
  const view = useView();
  const l: Location | null = view.selected;
  if (!l || l.floor !== view.floor) return null;
  return (
    <mesh position={[l.pos.x, (l.level - 1) * RACK.levelH + RACK.levelH * 0.4, l.pos.z]}>
      <boxGeometry args={[RACK.depth * 1.05, RACK.levelH * 0.85, (RACK.bayW / RACK.slots) * 0.95]} />
      <meshBasicMaterial color={SCENE.selected} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

/** 지하 B1 — 차량 접안 자리(90). 8,600평 밖 공용 시설 */
function Basement() {
  const { layout } = useApp();
  const w = 6 + layout.docks.length * 4.5 + 4;
  return (
    <group>
      <Slab w={w} d={30} />
      {layout.docks.map((d) => (
        <group key={d.code} position={[d.pos.x, 0, d.pos.z]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 8]}>
            <planeGeometry args={[3.6, 16]} />
            <meshBasicMaterial color={ZONE_COLOR[d.temp]} transparent opacity={0.3} />
          </mesh>
          <sprite position={[0, 3, 0]} scale={[3, 1.5, 1]}>
            <spriteMaterial map={plateTexture(d.short)} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

/** 카메라 — 마우스로 돌리고, 층·구역 버튼을 누르면 그쪽으로 부드럽게 옮긴다 */
function CameraRig() {
  const { controller } = useApp();
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const anim = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.maxPolarAngle = Math.PI / 2.05;
    controls.current = c;
    return () => c.dispose();
  }, [camera, gl]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const req = controller.takeCameraRequest();
    if (req) anim.current = { pos: req.pos, target: req.target, t: req.animate ? 0 : 1 };
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt * 2.2);
      camera.position.lerp(a.pos, a.t);
      c.target.lerp(a.target, a.t);
      if (a.t >= 1) anim.current = null;
    }
    c.update();
  });
  return null;
}
