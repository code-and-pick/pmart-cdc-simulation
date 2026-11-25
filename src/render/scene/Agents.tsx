// 현장 사람 — 보는 층의 작업자만. 위치·방향·짐은 useFrame 에서 three 객체를 직접 바꾼다(React 상태로 올리지 않음).
// 사람은 MFC Humanoid 모형, 조끼 색 = 역할: FC 파랑 · 분배/라인 초록 · 자키 주황 · 검품 보라 · 도크 상차 청록. 지게차 보충은 입식 리치 지게차(사용자 사진). 누르면 PDA 카드.

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useApp, useView } from '../../app/context';
import type { Agent, Role } from '../../sim/agent';
import { SCENE } from '../colors';
import { boxTexture, palletTexture } from '../sprites';
import { RollContainer } from './Equipment3D';
import { Crowd } from './Crowd';
import type { HumanoidLook } from './Humanoid';
import { StaticMerge } from './StaticMerge';

const ROLE_COLOR: Record<Role, number> = { FC: 0x2f80ed, SORT: 0x27ae60, JOCKEY: 0xf2994a, REPL: 0xf2c94c, INSPECT: 0x9b51e0, LOADER: 0x00a3a3, DPS: 0x56ccf2, INBOUND: 0xeb5757 };

/** 시뮬레이션 시계를 화면 프레임에 맞춰 돌리고, 패널은 약 4Hz 로 갱신 */
export function SimDriver() {
  const { sim, ticker } = useApp();
  const acc = useRef(0);
  useFrame((_, dt) => {
    // 화면이 느려도 시뮬 시각이 배속만큼 가게 — 한 프레임 최대 1초(시뮬은 안에서 1초씩 나눠 돈다). 0.25초면 4fps 아래에서 120배속이 늦어졌다(사용자 2026-11-25 "느리다")
    sim.advance(Math.min(dt, 1));
    acc.current += dt;
    if (acc.current > 0.25) {
      acc.current = 0;
      ticker.bump();
    }
  });
  return null;
}

export function Agents() {
  const { sim } = useApp();
  const view = useView();
  return (
    <>
      {/* 사람 모형은 부위별로 한 번에 그린다(Crowd — 성능). Person 은 누르기 판정·카트·지게차·고름 표시 */}
      <Crowd lookOf={lookOf} />
      {sim.agents
        .filter((a) => a.floor === view.floor)
        .map((a) => (
          <Person key={a.id} a={a} selected={view.selectedWorker === a.id} />
        ))}
    </>
  );
}

/** 역할별 옷 — MFC Humanoid 모형, 조끼 색 = 역할 색. 지게차 보충은 사진처럼 흰 안전모 + 형광 조끼 */
function lookOf(a: Agent): HumanoidLook {
  if (a.role === 'REPL') return { shirt: 0x4a5160, pants: 0x2b3040, vest: 0xd8f03a, head: 'helmet', headColor: 0xffffff };
  if (a.role === 'LOADER') return { shirt: 0x3b4252, pants: 0x2b3040, vest: ROLE_COLOR.LOADER, head: 'helmet', headColor: 0xffffff };
  const n = Number(a.id.slice(-2)) || 0;
  return { shirt: [0xf5f6f8, 0x5b6474, 0x2f3542][n % 3], pants: [0x2b3040, 0x3d4454][n % 2], vest: ROLE_COLOR[a.role], head: n % 3 === 1 ? 'cap' : 'hair', headColor: n % 3 === 1 ? ROLE_COLOR[a.role] : [0x2a1f1a, 0x4a3426, 0x1c1c1c][n % 3], pda: a.role === 'FC' || a.role === 'SORT' };
}

function Person({ a, selected }: { a: Agent; selected: boolean }) {
  const view = useView();
  const g = useRef<THREE.Group>(null);
  const cart = useRef<THREE.Group>(null);
  const roll = useRef<THREE.Group>(null);
  const coldRoll = useRef<THREE.Group>(null);
  const jack = useRef<THREE.Group>(null);
  const jackRoll = useRef<THREE.Group>(null);
  const jackColdRoll = useRef<THREE.Group>(null);
  // 자키는 R/T 를 핸드자키에 얹어 끈다(사용자 2026-11-26 "자키 작업 중엔 자키를 끌고 다니게") — 상차 작업자는 R/T 를 그대로 민다
  const jockey = a.role === 'JOCKEY';
  const load = useRef<THREE.Group>(null);
  const truckG = useRef<THREE.Group>(null);
  const truck = a.role === 'REPL';
  // 클릭 판정(Core.Picker)이 사람을 먼저 잡도록 등록
  useEffect(() => {
    const o = g.current!;
    view.people.set(a.id, o);
    return () => {
      view.people.delete(a.id);
    };
  }, [a.id, view]);
  useFrame(() => {
    const o = g.current;
    if (!o) return;
    o.position.set(a.pos.x, 0, a.pos.z);
    o.rotation.y = a.heading;
    // 지게차: 타고 있으면 운전석에 서고, 세워 두면(선반 입구) 지게차는 그 자리에 두고 사람만 걷는다
    if (truckG.current) {
      const pk = a.parked;
      truckG.current.position.set(pk ? pk.x : a.pos.x, 0, pk ? pk.z : a.pos.z);
      truckG.current.rotation.y = pk ? pk.heading : a.heading;
    }
    cart.current!.visible = a.carrying === 'CART';
    roll.current!.visible = !jockey && a.carrying === 'ROLL' && !a.cold;
    coldRoll.current!.visible = !jockey && a.carrying === 'ROLL' && a.cold;
    jackRoll.current!.visible = jockey && a.carrying === 'ROLL' && !a.cold;
    jackColdRoll.current!.visible = jockey && a.carrying === 'ROLL' && a.cold;
    jack.current!.visible = !truck && a.carrying === 'PALLET';
    if (load.current) load.current.visible = a.carrying === 'PALLET';
  });
  return (
    <>
    {truck && (
      <group ref={truckG}>
        <ReachTruck load={load} />
      </group>
    )}
    <group ref={g}>
      {/* 클릭 판정(보이지 않음) */}
      <mesh position-y={0.9}>
        <boxGeometry args={[0.6, 1.8, 0.5]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* FC 피킹 카트(MFC 카트 모양) — 안에 MFC 상자 무늬 상자 */}
      <group ref={cart} position={[0, 0, 0.66]} visible={false}>
        <PickCart />
      </group>
      <group ref={roll} position={[0, 0, 0.78]} visible={false}>
        <RollContainer x={0} z={0} fill={0.6} />
      </group>
      <group ref={coldRoll} position={[0, 0, 0.78]} visible={false}>
        <RollContainer x={0} z={0} cold fill={0.6} />
      </group>
      {/* 자키: 핸드자키 포크 위 R/T */}
      <group ref={jackRoll} position={[0, 0, 0.95]} visible={false}>
        <HandJack>
          <RollContainer x={0} z={0} fill={0.6} />
        </HandJack>
      </group>
      <group ref={jackColdRoll} position={[0, 0, 0.95]} visible={false}>
        <HandJack>
          <RollContainer x={0} z={0} cold fill={0.6} />
        </HandJack>
      </group>
      {/* 핸드자키(손 팔레트 트럭) + 상품 박스 팔레트 */}
      <group ref={jack} position={[0, 0, 0.95]} visible={false}>
        <HandJack />
      </group>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.55, 0.75, 32]} />
          <meshBasicMaterial color={SCENE.selected} />
        </mesh>
      )}
    </group>
    </>
  );
}

/** MFC 피킹 카트 모양(파란 바구니·손잡이·바퀴) */
function PickCart() {
  return (
    <group>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.45, 0.42, 0.62]} />
        <meshStandardMaterial color={0x4a90d9} transparent opacity={0.8} />
      </mesh>
      <StaticMerge>
        <mesh position={[0, 0.86, -0.36]}>
          <boxGeometry args={[0.5, 0.03, 0.03]} />
          <meshStandardMaterial color={0x90a4ae} metalness={0.6} roughness={0.3} />
        </mesh>
        {[-0.2, 0.2].map((x) => (
          <mesh key={'h' + x} position={[x, 0.7, -0.34]}>
            <boxGeometry args={[0.025, 0.34, 0.025]} />
            <meshStandardMaterial color={0x90a4ae} metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        {[
          [-0.19, -0.27],
          [0.19, -0.27],
          [-0.19, 0.27],
          [0.19, 0.27],
        ].map(([x, z]) => (
          <mesh key={'w' + x + ':' + z} position={[x, 0.07, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.06, 0.06, 0.04, 10]} />
            <meshStandardMaterial color={0x263238} />
          </mesh>
        ))}
        {[-0.19, 0.19].flatMap((x) =>
          [-0.27, 0.27].map((z) => (
            <mesh key={'l' + x + z} position={[x, 0.18, z]}>
              <boxGeometry args={[0.02, 0.22, 0.02]} />
              <meshStandardMaterial color={0x90a4ae} metalness={0.6} roughness={0.3} />
            </mesh>
          )),
        )}
      </StaticMerge>
      {[-0.1, 0.1].map((x, i) => (
        <mesh key={x} position={[x, 0.62, i ? 0.12 : -0.1]}>
          <boxGeometry args={[0.18, 0.16, 0.22]} />
          <meshStandardMaterial color={0xd2a679} roughness={0.85} map={boxTexture()} />
        </mesh>
      ))}
    </group>
  );
}

/** 상품 박스 팔레트(나무 팔레트 + MFC 상자 무늬 상자 더미) */
function PalletLoad({ h = 0.9 }: { h?: number }) {
  return (
    <group>
      <mesh position={[0, 0.07, 0]}>
        <boxGeometry args={[1.1, 0.14, 1.1]} />
        <meshStandardMaterial color={0xd9b98a} roughness={0.85} map={palletTexture()} />
      </mesh>
      {[-0.27, 0.27].flatMap((x) =>
        [-0.27, 0.27].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.14 + h / 2, z]}>
            <boxGeometry args={[0.52, h, 0.52]} />
            <meshStandardMaterial color={(x > 0) !== (z > 0) ? 0xc99a6b : 0xd2a679} roughness={0.85} map={boxTexture()} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** 핸드자키 — 빨간 손잡이·포크 + 짐(기본 = 상품 박스 팔레트, 자키는 R/T) */
function HandJack({ children }: { children?: ReactNode }) {
  return (
    <group>
      <mesh position={[0, 0.55, -0.62]} rotation-x={-0.25}>
        <boxGeometry args={[0.06, 1.0, 0.06]} />
        <meshStandardMaterial color={0xd83a2e} />
      </mesh>
      <mesh position={[0, 1.02, -0.74]}>
        <boxGeometry args={[0.3, 0.05, 0.05]} />
        <meshStandardMaterial color={0x222831} />
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.05, 0]}>
          <boxGeometry args={[0.16, 0.06, 1.15]} />
          <meshStandardMaterial color={0xd83a2e} />
        </mesh>
      ))}
      <group position={[0, children ? 0.09 : 0.05, 0]}>{children ?? <PalletLoad h={0.6} />}</group>
    </group>
  );
}

/**
 * 입식 리치 지게차 — 사용자 사진(2026-11-25): 연두 몸체·뒤 운전석(서서 탐)·검은 운전석 지붕 틀·앞 높은 검은 마스트·포크·
 * 바닥 앞쪽으로 뻗은 받침다리(아웃리거)·노란 화살표 등·꼭대기 빨간 경광등. 앞 = +z.
 */
function ReachTruck({ load }: { load: React.RefObject<THREE.Group | null> }) {
  const body = 0xb7d433;
  const dark = 0x23272e;
  return (
    <group>
      <StaticMerge>
        {/* 몸체(뒤) — 운전석을 감싼 연두 상자, 운전석 쪽(뒤)은 열림 */}
        <mesh position={[0, 0.62, -0.25]}>
          <boxGeometry args={[1.1, 1.1, 0.7]} />
          <meshStandardMaterial color={body} roughness={0.55} />
        </mesh>
        {[-0.5, 0.5].map((x) => (
          <mesh key={x} position={[x, 0.62, -0.78]}>
            <boxGeometry args={[0.1, 1.1, 0.4]} />
            <meshStandardMaterial color={body} roughness={0.55} />
          </mesh>
        ))}
        {/* 운전석 바닥 */}
        <mesh position={[0, 0.16, -0.7]}>
          <boxGeometry args={[0.95, 0.12, 0.55]} />
          <meshStandardMaterial color={dark} />
        </mesh>
        {/* 운전석 지붕 틀(헤드가드) */}
        {[-0.5, 0.5].flatMap((x) =>
          [-0.95, -0.1].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 1.6, z]}>
              <boxGeometry args={[0.06, 0.95, 0.06]} />
              <meshStandardMaterial color={dark} />
            </mesh>
          )),
        )}
        <mesh position={[0, 2.08, -0.52]}>
          <boxGeometry args={[1.1, 0.06, 0.95]} />
          <meshStandardMaterial color={dark} />
        </mesh>
        {/* 마스트 두 기둥 + 가로대 */}
        {[-0.38, 0.38].map((x) => (
          <mesh key={x} position={[x, 1.75, 0.22]}>
            <boxGeometry args={[0.12, 3.5, 0.14]} />
            <meshStandardMaterial color={dark} metalness={0.3} roughness={0.5} />
          </mesh>
        ))}
        {[0.6, 3.45].map((y) => (
          <mesh key={y} position={[0, y, 0.22]}>
            <boxGeometry args={[0.9, 0.1, 0.1]} />
            <meshStandardMaterial color={dark} />
          </mesh>
        ))}
        {/* 받침다리(아웃리거) — 바닥에 앞으로, 끝에 바퀴 */}
        {[-0.48, 0.48].map((x) => (
          <mesh key={x} position={[x, 0.09, 0.75]}>
            <boxGeometry args={[0.14, 0.16, 1.3]} />
            <meshStandardMaterial color={dark} />
          </mesh>
        ))}
        {[-0.48, 0.48].map((x) => (
          <mesh key={'w' + x} position={[x, 0.08, 1.3]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.08, 0.08, 0.1, 12]} />
            <meshStandardMaterial color={0x111111} />
          </mesh>
        ))}
        {/* 포크 캐리지 + 포크 */}
        <mesh position={[0, 0.5, 0.33]}>
          <boxGeometry args={[0.85, 0.5, 0.06]} />
          <meshStandardMaterial color={dark} />
        </mesh>
        {[-0.22, 0.22].map((x) => (
          <mesh key={'f' + x} position={[x, 0.27, 0.85]}>
            <boxGeometry args={[0.1, 0.04, 1.0]} />
            <meshStandardMaterial color={0x3a3f47} metalness={0.4} roughness={0.4} />
          </mesh>
        ))}
        {/* 관리자 판(흰 종이) */}
        <mesh position={[0.56, 0.75, -0.25]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[0.36, 0.26]} />
          <meshStandardMaterial color={0xf4f4f0} />
        </mesh>
      </StaticMerge>
      {/* 노란 화살표 등·빨간 경광등(빛나는 것) */}
      <mesh position={[0.56, 0.22, 0.02]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[0.3, 0.06]} />
        <meshStandardMaterial color={0xffd400} emissive={0xffd400} emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[0.4, 2.18, -0.95]}>
        <cylinderGeometry args={[0.06, 0.07, 0.12, 12]} />
        <meshStandardMaterial color={0xff2a2a} emissive={0xff2a2a} emissiveIntensity={1.0} />
      </mesh>
      {/* 포크 위 팔레트(보충 중) */}
      <group ref={load} position={[0, 0.3, 0.92]} visible={false}>
        <PalletLoad h={0.8} />
      </group>
    </group>
  );
}
