// 설비 모형 — 사용자 사진(2026-11-25)과 우아한청년들 기사 사진대로, MFC 시뮬레이터 모형처럼 단순한 상자·원기둥으로.
//  - 휠소터: 파란 틀·은색 롤러 컨베이어, 바퀴가 박스를 MFC 별 롤테이너 쪽 갈래로 보냄, 경광등(빨강·초록)
//  - 라인(DAS)·분배: 앞 롤러 작업대 + 뒤 파란 철망 롤테이너 + 위 선반 빔의 표시등
//  - DPS(냉동): 흐름 선반(표시등) + 앞 빈 박스 컨베이어
//  - 오토스토어: 알루미늄 격자 + 옥색 옆판 + 빨간 로봇이 격자 위를 다님, 앞 포트
//  - 롤테이너: 파란 철망 카트, 저온은 은색 보냉 커버(앞 창)
// 시뮬레이션과 묶이는 것은 "돌고 있는지"(분류 작업자가 일하는지)뿐 — 수량은 원장·계약에서만.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { MFCS } from '../../config';
import type { Equip } from '../../domain/layout';
import type { FloorNo } from '../../domain/sites/chilgok';
import { plateTexture } from '../sprites';

const BLUE = 0x1f63d0;
const STEEL = 0xc9ced6;
const ROLLER = 0xdfe3e8;
const ALU = 0xd9dde3;
const tmp = new THREE.Object3D();

/** 이 층 분류 작업자가 일하는 중인가 — 설비 움직임(박스 흐름·표시등) */
function useBusy(floor: FloorNo): () => boolean {
  const { sim } = useApp();
  return () => sim.speed > 0 && sim.agents.some((a) => a.floor === floor && (a.role === 'SORT' || a.role === 'FC') && !a.idle);
}

/** 롤러 컨베이어 한 줄(직선) — 파란 옆 틀, 은색 롤러, 다리. 길이 방향 = dir('x'|'z') */
function Conveyor({ x, z, len, dir, w = 0.9, h = 0.8 }: { x: number; z: number; len: number; dir: 'x' | 'z'; w?: number; h?: number }) {
  const rollers = useRef<THREE.InstancedMesh>(null!);
  const n = Math.max(2, Math.floor(len / 0.12));
  useLayoutEffect(() => {
    for (let i = 0; i < n; i++) {
      const a = -len / 2 + (i + 0.5) * (len / n);
      tmp.position.set(dir === 'x' ? x + a : x, h, dir === 'x' ? z : z + a);
      tmp.rotation.set(dir === 'x' ? Math.PI / 2 : 0, 0, dir === 'x' ? 0 : Math.PI / 2);
      if (dir === 'x') tmp.rotation.set(Math.PI / 2, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      rollers.current.setMatrixAt(i, tmp.matrix);
    }
    rollers.current.instanceMatrix.needsUpdate = true;
  }, [x, z, len, dir, n, h]);
  const sx = dir === 'x' ? len : w;
  const sz = dir === 'x' ? w : len;
  const rail = (s: number) => (dir === 'x' ? [x, h + 0.06, z + s * (w / 2 + 0.05)] : [x + s * (w / 2 + 0.05), h + 0.06, z]) as [number, number, number];
  const legs = Math.max(2, Math.ceil(len / 1.6));
  return (
    <group>
      {/* 롤러: 원기둥이 길이 방향에 수직 */}
      <instancedMesh ref={rollers} args={[undefined, undefined, n]} frustumCulled={false}>
        <cylinderGeometry args={[0.035, 0.035, w, 8]} />
        <meshStandardMaterial color={ROLLER} metalness={0.2} roughness={0.4} />
      </instancedMesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={rail(s)}>
          <boxGeometry args={dir === 'x' ? [len, 0.22, 0.08] : [0.08, 0.22, len]} />
          <meshStandardMaterial color={BLUE} />
        </mesh>
      ))}
      {Array.from({ length: legs }, (_, i) => {
        const a = -len / 2 + (i + 0.5) * (len / legs);
        return [-1, 1].map((s) => (
          <mesh key={`${i}${s}`} position={dir === 'x' ? [x + a, h / 2, z + s * (w / 2)] : [x + s * (w / 2), h / 2, z + a]}>
            <boxGeometry args={[0.06, h, 0.06]} />
            <meshStandardMaterial color={BLUE} />
          </mesh>
        ));
      })}
      <mesh position={[x, h - 0.08, z]} visible={false}>
        <boxGeometry args={[sx, 0.02, sz]} />
      </mesh>
    </group>
  );
}

/** 경광등 — 빨강·초록 둘, 돌 때 초록이 밝다 */
function TowerLight({ x, z, busy }: { x: number; z: number; busy: () => boolean }) {
  const green = useRef<THREE.MeshStandardMaterial>(null!);
  const red = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(() => {
    const on = busy();
    green.current.emissiveIntensity = on ? 1.6 : 0.1;
    red.current.emissiveIntensity = on ? 0.1 : 1.2;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 2.4, 8]} />
        <meshStandardMaterial color={STEEL} />
      </mesh>
      <mesh position={[0, 2.55, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.2, 12]} />
        <meshStandardMaterial ref={green} color={0x2ecc71} emissive={0x2ecc71} />
      </mesh>
      <mesh position={[0, 2.76, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.2, 12]} />
        <meshStandardMaterial ref={red} color={0xe74c3c} emissive={0xe74c3c} />
      </mesh>
    </group>
  );
}

/** 롤테이너(이동형 운반 카트) — 파란 철망, cold 면 은색 보냉 커버 + 앞 파란 창 */
export function RollContainer({ x, z, cold = false, rot = 0, fill = 0.6 }: { x: number; z: number; cold?: boolean; rot?: number; fill?: number }) {
  const W = 0.8;
  const D = 0.7;
  const H = 1.7;
  if (cold)
    return (
      <group position={[x, 0, z]} rotation={[0, rot, 0]}>
        <mesh position={[0, H / 2 + 0.12, 0]}>
          <boxGeometry args={[W + 0.04, H, D + 0.04]} />
          <meshStandardMaterial color={0xdde1e6} metalness={0.15} roughness={0.35} />
        </mesh>
        <mesh position={[0, H * 0.62, D / 2 + 0.03]}>
          <planeGeometry args={[0.32, 0.36]} />
          <meshStandardMaterial color={0x2f7fd6} />
        </mesh>
        <Wheels W={W} D={D} />
      </group>
    );
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* 바닥판 + 네 기둥 + 옆 철망 세 면(앞은 열림) */}
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[W, 0.04, D]} />
        <meshStandardMaterial color={BLUE} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[(sx * W) / 2, H / 2 + 0.12, (sz * D) / 2]}>
          <boxGeometry args={[0.035, H, 0.035]} />
          <meshStandardMaterial color={BLUE} />
        </mesh>
      ))}
      {[
        { p: [0, H / 2 + 0.12, -D / 2] as const, s: [W, H, 0.01] as const },
        { p: [-W / 2, H / 2 + 0.12, 0] as const, s: [0.01, H, D] as const },
        { p: [W / 2, H / 2 + 0.12, 0] as const, s: [0.01, H, D] as const },
      ].map((m, i) => (
        <mesh key={i} position={[...m.p]}>
          <boxGeometry args={[...m.s]} />
          <meshStandardMaterial color={BLUE} transparent opacity={0.28} />
        </mesh>
      ))}
      {/* 안에 실린 박스 */}
      {fill > 0 && (
        <mesh position={[0, 0.16 + (H * fill * 0.9) / 2, 0]}>
          <boxGeometry args={[W * 0.86, H * fill * 0.9, D * 0.82]} />
          <meshStandardMaterial color={0xd7b07c} />
        </mesh>
      )}
      <Wheels W={W} D={D} />
    </group>
  );
}

function Wheels({ W, D }: { W: number; D: number }) {
  return (
    <>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[(sx * W) / 2.4, 0.06, (sz * D) / 2.4]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 0.04, 10]} />
          <meshStandardMaterial color={0xe0712c} />
        </mesh>
      ))}
    </>
  );
}

/** 흐르는 박스(컨베이어 위) — 경로 점들을 따라 n 개가 돈다. busy 일 때만 움직이고 보인다 */
function FlowBoxes({ path, n, busy, color = 0xffffff, size = [0.5, 0.32, 0.38] }: { path: THREE.Vector3[]; n: number; busy: () => boolean; color?: number; size?: [number, number, number] }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const t = useRef(0);
  const { lens, total } = useMemo(() => {
    const lens = path.slice(1).map((p, i) => p.distanceTo(path[i]));
    return { lens, total: lens.reduce((a, b) => a + b, 0) };
  }, [path]);
  useFrame((_, dt) => {
    const on = busy();
    if (on) t.current += dt * 1.2;
    for (let i = 0; i < n; i++) {
      let d = (t.current + (i * total) / n) % total;
      let k = 0;
      while (k < lens.length - 1 && d > lens[k]) d -= lens[k++];
      const p = path[k].clone().lerp(path[k + 1], Math.min(1, d / lens[k]));
      tmp.position.set(p.x, p.y + size[1] / 2, p.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} frustumCulled={false}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </instancedMesh>
  );
}

/**
 * 1차 고속분류기(휠소터) — 남북 본선(투입은 남쪽: FC 카트가 오는 북쪽 통로 반대편이 아니라 띠 남쪽 끝), 갈래 5개(MFC 별)를 동서로 번갈아,
 * 갈래 끝에 그 MFC 롤테이너. 분류 작업자가 일하면 박스가 본선 → 갈래로 흐른다.
 */
function WheelSorter({ e, floor }: { e: Equip; floor: FloorNo }) {
  const busy = useBusy(floor);
  const r = e.rect;
  const cx = (r.x0 + r.x1) / 2;
  const z0 = r.z0 + 1.2;
  const z1 = r.z1 - 1.2;
  const lanes = MFCS.map((m, i) => ({ m, z: z0 + ((i + 0.7) * (z1 - z0)) / (MFCS.length + 0.4), side: i % 2 ? 1 : -1 }));
  const laneLen = Math.min(4.2, (r.x1 - r.x0) / 2 - 1.4);
  const paths = useMemo(
    () =>
      lanes.map((l) => [new THREE.Vector3(cx, 0.86, z1), new THREE.Vector3(cx, 0.86, l.z), new THREE.Vector3(cx + l.side * (laneLen + 0.4), 0.86, l.z)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cx, z1, laneLen],
  );
  return (
    <group>
      <Conveyor x={cx} z={(z0 + z1) / 2} len={z1 - z0} dir="z" w={1.0} />
      {lanes.map((l) => (
        <group key={l.m.id}>
          <Conveyor x={cx + l.side * (0.5 + laneLen / 2)} z={l.z} len={laneLen} dir="x" w={0.8} h={0.72} />
          {/* 휠 디버터(본선 위 작은 바퀴 줄) */}
          <mesh position={[cx, 0.9, l.z]}>
            <boxGeometry args={[0.9, 0.04, 0.5]} />
            <meshStandardMaterial color={0x404650} />
          </mesh>
          <RollContainer x={cx + l.side * (laneLen + 1.1)} z={l.z} rot={Math.PI / 2} fill={0.5} />
          <sprite position={[cx + l.side * (laneLen + 1.1), 2.4, l.z]} scale={[1.6, 0.6, 1]}>
            <spriteMaterial map={plateTexture(l.m.name.replace(/^\d호점 /, ''), { w: 256, h: 96 })} depthWrite={false} />
          </sprite>
        </group>
      ))}
      <TowerLight x={cx + 0.9} z={z1 - 0.4} busy={busy} />
      {paths.map((p, i) => (
        <FlowBoxes key={i} path={p} n={3} busy={busy} />
      ))}
    </group>
  );
}

/** 표시등 줄(DAS·DPS 선반 빔) — 돌 때 칸마다 빨강·초록 숫자등이 켜진다 */
function LightStrip({ x, y, z, len, dir, busy }: { x: number; y: number; z: number; len: number; dir: 'x' | 'z'; busy: () => boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const n = Math.max(2, Math.floor(len / 0.7));
  const t = useRef(0);
  const c = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    for (let i = 0; i < n; i++) {
      const a = -len / 2 + (i + 0.5) * (len / n);
      tmp.position.set(dir === 'x' ? x + a : x, y, dir === 'x' ? z : z + a);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [x, y, z, len, dir, n]);
  useFrame((_, dt) => {
    t.current += dt;
    const on = busy();
    for (let i = 0; i < n; i++) {
      const lit = on && Math.sin(t.current * 1.7 + i * 2.3) > 0.55;
      c.setHex(lit ? (i % 3 ? 0x2ecc71 : 0xff4d4d) : 0x3b4250);
      ref.current.setColorAt(i, c);
    }
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} frustumCulled={false}>
      <boxGeometry args={[0.16, 0.08, 0.06]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}

/** 파란 선반 틀(DAS 위·DPS) — 기둥·빔 */
function BlueFrame({ x, z, len, depth, h, dir, levels = 2 }: { x: number; z: number; len: number; depth: number; h: number; dir: 'x' | 'z'; levels?: number }) {
  const posts = Math.max(2, Math.round(len / 1.8) + 1);
  return (
    <group>
      {Array.from({ length: posts }, (_, i) => {
        const a = -len / 2 + (i * len) / (posts - 1);
        return [-1, 1].map((s) => (
          <mesh key={`${i}${s}`} position={dir === 'x' ? [x + a, h / 2, z + (s * depth) / 2] : [x + (s * depth) / 2, h / 2, z + a]}>
            <boxGeometry args={[0.07, h, 0.07]} />
            <meshStandardMaterial color={BLUE} />
          </mesh>
        ));
      })}
      {Array.from({ length: levels }, (_, k) =>
        [-1, 1].map((s) => (
          <mesh key={`b${k}${s}`} position={dir === 'x' ? [x, h * ((k + 1) / levels), z + (s * depth) / 2] : [x + (s * depth) / 2, h * ((k + 1) / levels), z]}>
            <boxGeometry args={dir === 'x' ? [len, 0.08, 0.06] : [0.06, 0.08, len]} />
            <meshStandardMaterial color={BLUE} />
          </mesh>
        )),
      )}
    </group>
  );
}

/**
 * 라인(DAS, 6F 냉장) — 동서로 긴 줄 몇 개: 앞 롤러 작업대(분류 작업자가 박스를 스캔), 뒤에 MFC 별 롤테이너 줄, 위 선반 빔 표시등.
 * 사진: 롤러 작업대 + 파란 철망 롤테이너 + 위 파란 선반.
 */
function DasLines({ e, floor, split }: { e: Equip; floor: FloorNo; split: boolean }) {
  const busy = useBusy(floor);
  const r = e.rect;
  const rows = Math.max(1, Math.floor((r.z1 - r.z0) / 6.5));
  const len = r.x1 - r.x0 - 3;
  const cx = (r.x0 + r.x1) / 2;
  return (
    <group>
      {Array.from({ length: rows }, (_, k) => {
        const z = r.z0 + 3 + k * ((r.z1 - r.z0 - 4) / rows);
        const rts = Math.floor(len / 1.0);
        return (
          <group key={k}>
            <Conveyor x={cx} z={z} len={len} dir="x" w={0.8} h={0.78} />
            {Array.from({ length: rts }, (_, i) => (
              <RollContainer key={i} x={cx - len / 2 + (i + 0.5) * (len / rts)} z={z + 1.35} cold={false} fill={((i * 37) % 10) / 14} />
            ))}
            <BlueFrame x={cx} z={z + 1.35} len={len} depth={1.0} h={2.4} dir="x" levels={1} />
            <LightStrip x={cx} y={2.4} z={z + 0.83} len={len} dir="x" busy={busy} />
            {split && (
              // 분배: 롤러 작업대 위에 야채 크레이트(초록) 몇 개
              <>
                {Array.from({ length: Math.floor(len / 3) }, (_, i) => (
                  <mesh key={`c${i}`} position={[cx - len / 2 + 1.5 + i * 3, 0.98, z]}>
                    <boxGeometry args={[0.55, 0.3, 0.4]} />
                    <meshStandardMaterial color={0x3aa35a} />
                  </mesh>
                ))}
              </>
            )}
            <FlowBoxes path={[new THREE.Vector3(cx - len / 2, 0.84, z), new THREE.Vector3(cx + len / 2, 0.84, z)]} n={Math.max(3, Math.floor(len / 5))} busy={busy} color={split ? 0x3aa35a : 0xd7b07c} />
          </group>
        );
      })}
    </group>
  );
}

/** DPS(냉동) — 흐름 선반 두 줄(표시등) + 사이 빈 박스 컨베이어 */
function Dps({ e, floor }: { e: Equip; floor: FloorNo }) {
  const busy = useBusy(floor);
  const r = e.rect;
  const cx = (r.x0 + r.x1) / 2;
  const len = r.z1 - r.z0 - 2.4;
  const cz = (r.z0 + r.z1) / 2;
  return (
    <group>
      <Conveyor x={cx} z={cz} len={len} dir="z" w={0.7} h={0.8} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <BlueFrame x={cx + s * 2.0} z={cz} len={len} depth={1.2} h={2.0} dir="z" levels={4} />
          {[0.5, 1.0, 1.5, 2.0].map((y) => (
            <mesh key={y} position={[cx + s * 2.0, y - 0.05, cz]}>
              <boxGeometry args={[1.1, 0.03, len]} />
              <meshStandardMaterial color={0xcfe0f5} />
            </mesh>
          ))}
          <LightStrip x={cx + s * 1.35} y={1.0} z={cz} len={len} dir="z" busy={busy} />
        </group>
      ))}
      <FlowBoxes path={[new THREE.Vector3(cx, 0.86, r.z1 - 1.2), new THREE.Vector3(cx, 0.86, r.z0 + 1.2)]} n={Math.max(3, Math.floor(len / 3))} busy={busy} color={0xffffff} size={[0.42, 0.28, 0.32]} />
    </group>
  );
}

/** 오토스토어 — 알루미늄 격자(위), 옥색 옆판, 빨간 로봇들이 격자 위를 오감, 남쪽(앞) 포트 2개 */
function AutoStore({ e }: { e: Equip }) {
  const { sim } = useApp();
  const r = e.rect;
  const H = 4.4;
  const cell = 0.7;
  const nx = Math.floor((r.x1 - r.x0 - 1) / cell);
  const nz = Math.floor((r.z1 - r.z0 - 3) / cell);
  const x0 = r.x0 + 0.5;
  const z0 = r.z0 + 0.5;
  const gw = nx * cell;
  const gd = nz * cell;
  const bars = useRef<THREE.InstancedMesh>(null!);
  const robots = useRef<THREE.InstancedMesh>(null!);
  const nb = nx + 1 + nz + 1;
  const nr = Math.max(4, Math.floor((nx * nz) / 90));
  useLayoutEffect(() => {
    let i = 0;
    for (let k = 0; k <= nx; k++) {
      tmp.position.set(x0 + k * cell, H, z0 + gd / 2);
      tmp.scale.set(0.05, 0.08, gd);
      tmp.updateMatrix();
      bars.current.setMatrixAt(i++, tmp.matrix);
    }
    for (let k = 0; k <= nz; k++) {
      tmp.position.set(x0 + gw / 2, H, z0 + k * cell);
      tmp.scale.set(gw, 0.08, 0.05);
      tmp.updateMatrix();
      bars.current.setMatrixAt(i++, tmp.matrix);
    }
    bars.current.instanceMatrix.needsUpdate = true;
  }, [nx, nz, x0, z0, gw, gd]);
  const t = useRef(0);
  useFrame((_, dt) => {
    if (sim.speed > 0) t.current += dt * Math.min(4, sim.speed / 10 + 0.5);
    for (let i = 0; i < nr; i++) {
      // 로봇마다 격자를 따라 가로·세로로 오간다(연출)
      const ph = t.current * 0.18 + i * 1.7;
      const gx = (Math.sin(ph) * 0.5 + 0.5) * (nx - 1);
      const gz = (Math.sin(ph * 0.7 + i) * 0.5 + 0.5) * (nz - 1);
      const along = Math.floor(ph) % 2 === 0;
      tmp.position.set(x0 + (along ? gx : Math.round(gx)) * cell + cell / 2, H + 0.32, z0 + (along ? Math.round(gz) : gz) * cell + cell / 2);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      robots.current.setMatrixAt(i, tmp.matrix);
    }
    robots.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {/* 옥색 옆판(반투명) */}
      {[
        [x0 + gw / 2, z0, gw, 0.04],
        [x0 + gw / 2, z0 + gd, gw, 0.04],
        [x0, z0 + gd / 2, 0.04, gd],
        [x0 + gw, z0 + gd / 2, 0.04, gd],
      ].map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, H / 2, z]}>
          <boxGeometry args={[sx, H, sz]} />
          <meshStandardMaterial color={0x2ec7d3} transparent opacity={0.55} />
        </mesh>
      ))}
      {/* 안의 빈(bin) 더미 — 회백 덩어리 */}
      <mesh position={[x0 + gw / 2, H / 2 - 0.1, z0 + gd / 2]}>
        <boxGeometry args={[gw - 0.2, H - 0.3, gd - 0.2]} />
        <meshStandardMaterial color={0xe3e6ea} />
      </mesh>
      <instancedMesh ref={bars} args={[undefined, undefined, nb]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={ALU} metalness={0.15} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={robots} args={[undefined, undefined, nr]} frustumCulled={false}>
        <boxGeometry args={[0.62, 0.5, 0.62]} />
        <meshStandardMaterial color={0xe5322d} />
      </instancedMesh>
      {/* 포트(작업자가 빈에서 꺼내 MFC 박스에 담는 자리) */}
      {[0.3, 0.7].map((k) => (
        <group key={k} position={[x0 + gw * k, 0, z0 + gd + 1.0]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1.4, 1.0, 1.2]} />
            <meshStandardMaterial color={0x3a3f4a} />
          </mesh>
          <mesh position={[0, 1.05, 0.2]}>
            <boxGeometry args={[0.6, 0.12, 0.45]} />
            <meshStandardMaterial color={0xe3e6ea} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** 층의 설비 하나를 종류대로 */
export function EquipmentModel({ e, floor }: { e: Equip; floor: FloorNo }) {
  if (e.kind === 'WHEEL_SORTER') return <WheelSorter e={e} floor={floor} />;
  if (e.kind === 'DAS') return <DasLines e={e} floor={floor} split={false} />;
  if (e.kind === 'SPLIT') return <DasLines e={e} floor={floor} split />;
  if (e.kind === 'DPS') return <Dps e={e} floor={floor} />;
  return <AutoStore e={e} />;
}
