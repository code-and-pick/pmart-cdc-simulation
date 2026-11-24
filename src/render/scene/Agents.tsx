// 현장 사람 — 보는 층의 작업자만. 위치·방향·짐은 useFrame 에서 three 객체를 직접 바꾼다(React 상태로 올리지 않음).
// 색: FC 파랑 · 분배/라인 초록 · 자키 주황 · 지게차 노랑 · 검품 보라 · 지하 상차 청록. 누르면 PDA 카드.

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useApp, useView } from '../../app/context';
import type { Agent, Role } from '../../sim/agent';
import { SCENE } from '../colors';

const ROLE_COLOR: Record<Role, number> = { FC: 0x2f80ed, SORT: 0x27ae60, JOCKEY: 0xf2994a, REPL: 0xf2c94c, INSPECT: 0x9b51e0, LOADER: 0x00a3a3 };

/** 시뮬레이션 시계를 화면 프레임에 맞춰 돌리고, 패널은 약 4Hz 로 갱신 */
export function SimDriver() {
  const { sim, ticker } = useApp();
  const acc = useRef(0);
  useFrame((_, dt) => {
    sim.advance(Math.min(dt, 0.1));
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
      {sim.agents
        .filter((a) => a.floor === view.floor)
        .map((a) => (
          <Person key={a.id} a={a} selected={view.selectedWorker === a.id} />
        ))}
    </>
  );
}

function Person({ a, selected }: { a: Agent; selected: boolean }) {
  const view = useView();
  const g = useRef<THREE.Group>(null);
  const cart = useRef<THREE.Mesh>(null);
  const pallet = useRef<THREE.Mesh>(null);
  const forklift = useRef<THREE.Mesh>(null);
  const cartMat = useRef<THREE.MeshStandardMaterial>(null);
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
    cart.current!.visible = a.carrying === 'CART' || a.carrying === 'ROLL';
    cartMat.current!.color.setHex(a.carrying === 'ROLL' ? (a.cold ? SCENE.coldCover : SCENE.rollContainer) : 0x8a93a3);
    pallet.current!.visible = a.carrying === 'PALLET';
    forklift.current!.visible = a.role === 'REPL';
  });
  const color = ROLE_COLOR[a.role];
  return (
    <group ref={g}>
      {/* 지게차 몸체 */}
      <mesh ref={forklift} position={[0, 0.6, -0.4]}>
        <boxGeometry args={[1.0, 1.2, 1.6]} />
        <meshStandardMaterial color={0xe0b100} />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.22, 0.25, 1.1, 10]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.18, 12, 10]} />
        <meshStandardMaterial color={0xf1d3b3} />
      </mesh>
      {/* 카트·롤테이너(앞에 밀고 감) */}
      <mesh ref={cart} position={[0, 0.6, 0.8]}>
        <boxGeometry args={[0.6, 1.1, 0.9]} />
        <meshStandardMaterial ref={cartMat} color={0x8a93a3} transparent opacity={0.9} />
      </mesh>
      {/* 지게차 포크 위 팔레트 */}
      <mesh ref={pallet} position={[0, 0.7, 0.9]}>
        <boxGeometry args={[1.1, 1.0, 1.1]} />
        <meshStandardMaterial color={SCENE.box} />
      </mesh>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.55, 0.75, 32]} />
          <meshBasicMaterial color={SCENE.selected} />
        </mesh>
      )}
    </group>
  );
}
