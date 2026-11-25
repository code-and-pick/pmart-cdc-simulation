// 설비 모형 — 사용자 사진(2026-11-25)과 우아한청년들 기사 사진대로, MFC 시뮬레이터 모형처럼 단순한 상자·원기둥으로.
//  - 휠소터: 파란 틀·은색 롤러 컨베이어, 바퀴가 박스를 MFC 별 롤테이너 쪽 갈래로 보냄, 경광등(빨강·초록)
//  - 라인(DAS)·분배: 앞 롤러 작업대 + 뒤 파란 철망 롤테이너 + 위 선반 빔의 표시등
//  - DPS(냉동): 흐름 선반(표시등) + 앞 빈 박스 컨베이어
//  - 오토스토어: 알루미늄 격자 + 옥색 옆판 + 빨간 로봇이 격자 위를 다님, 앞 포트
//  - 롤테이너: 파란 철망 카트, 저온은 은색 보냉 커버(앞 창)
// 시뮬레이션과 묶이는 것은 "돌고 있는지"(분류 작업자가 일하는지)뿐 — 수량은 원장·계약에서만.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { FLOW, MFCS } from '../../config';
import type { Equip } from '../../domain/layout';
import type { FloorNo } from '../../domain/sites/chilgok';
import { autostorePorts, dasRows, mfcSlotIndex } from '../../sim/site';
import { boxTexture, palletTexture, plateTexture } from '../sprites';
import { StaticMerge } from './StaticMerge';

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

/**
 * 롤테이너 — MFC 시뮬레이터 RollContainer.tsx 와 같은 모양(사용자 2026-11-25 "MFC 모형 UI 랑 동일하게"):
 * 바퀴 달린 파란 철망 짐수레 0.8 × 0.6 × 1.7m, 바닥판·바퀴 4·기둥 4·옆 3면 가로 살·뒤판 세로 살, 앞은 열림.
 * CDC 만 더한 것: 저온(cold)은 사진처럼 은색 보냉 커버를 씌움, 실린 상자는 fill(0~1) 만큼 MFC 상자 무늬로 쌓음.
 */
export function RollContainer({ x, z, cold = false, rot = 0, fill = 0.6 }: { x: number; z: number; cold?: boolean; rot?: number; fill?: number }) {
  const W = 0.8;
  const D = 0.6;
  const H = 1.7;
  const frame = 0x2f6fd6; // MFC 파랑
  const bar = { color: frame, metalness: 0.5, roughness: 0.35 };
  const layers = Math.round(Math.max(0, Math.min(1, fill)) * 4); // 상자 층 0~4(층마다 2개)
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <StaticMerge>
        <mesh position={[0, 0.16, 0]}>
          <boxGeometry args={[W, 0.04, D]} />
          <meshStandardMaterial color={0x24569f} metalness={0.3} roughness={0.5} />
        </mesh>
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`w${sx}${sz}`} position={[sx * (W / 2 - 0.07), 0.06, sz * (D / 2 - 0.07)]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.06, 0.06, 0.04, 12]} />
              <meshStandardMaterial color={0x1f2229} />
            </mesh>
          )),
        )}
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`p${sx}${sz}`} position={[sx * (W / 2 - 0.015), 0.18 + (H - 0.18) / 2, sz * (D / 2 - 0.015)]}>
              <boxGeometry args={[0.03, H - 0.18, 0.03]} />
              <meshStandardMaterial {...bar} />
            </mesh>
          )),
        )}
        {[0.45, 0.75, 1.05, 1.35, 1.65].flatMap((y) => [
          <mesh key={`b${y}`} position={[0, y, -D / 2 + 0.015]}>
            <boxGeometry args={[W, 0.02, 0.015]} />
            <meshStandardMaterial {...bar} />
          </mesh>,
          ...[-1, 1].map((sx) => (
            <mesh key={`s${y}${sx}`} position={[sx * (W / 2 - 0.015), y, 0]}>
              <boxGeometry args={[0.015, 0.02, D]} />
              <meshStandardMaterial {...bar} />
            </mesh>
          )),
        ])}
        {[-0.25, -0.08, 0.08, 0.25].map((dx) => (
          <mesh key={`v${dx}`} position={[dx, 0.18 + (H - 0.18) / 2, -D / 2 + 0.015]}>
            <boxGeometry args={[0.012, H - 0.18, 0.012]} />
            <meshStandardMaterial {...bar} />
          </mesh>
        ))}
        {Array.from({ length: layers }, (_, k) =>
          [-1, 1].map((sx) => (
            <mesh key={`c${k}${sx}`} position={[sx * 0.18, 0.18 + 0.18 + k * 0.37, 0]}>
              <boxGeometry args={[0.34, 0.35, 0.5]} />
              <meshStandardMaterial color={(k + (sx > 0 ? 1 : 0)) % 2 ? 0xc99a6b : 0xd2a679} roughness={0.85} map={boxTexture()} />
            </mesh>
          )),
        )}
      </StaticMerge>
      {cold && (
        // 보냉 커버(사진: 은색 덮개, 앞에 파란 창) — 철망 위에 씌움
        <>
          <mesh position={[0, 0.18 + (H - 0.18) / 2, 0]}>
            <boxGeometry args={[W + 0.05, H - 0.12, D + 0.05]} />
            <meshStandardMaterial color={0xdde1e6} metalness={0.15} roughness={0.35} />
          </mesh>
          <mesh position={[0, H * 0.62, D / 2 + 0.03]}>
            <planeGeometry args={[0.32, 0.36]} />
            <meshStandardMaterial color={0x2f7fd6} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * 화물 승강기 — MFC 시뮬레이터 FreightLifts 와 같은 모양: 닫힌 밝은 콘크리트 코어 + 지붕 테두리, 스테인리스 문틀·문 두 짝(가운데서 열림)·
 * 층 표시등·호출 버튼, 문 앞 노랑/검정 안전 띠, 위에 "화물 승강기" 이름표. 문은 앞(+z)을 본다. open() 이 1 이면 문이 열린다.
 */
export function FreightLift({ cx, w, zBack, zFront, label, open }: { cx: number; w: number; zBack: number; zFront: number; label: string; open: () => number }) {
  const doors = useRef<THREE.Group[]>([]);
  const lamp = useRef<THREE.MeshStandardMaterial>(null!);
  const o = useRef(0);
  useFrame((_, dt) => {
    const want = open();
    o.current += Math.sign(want - o.current) * Math.min(Math.abs(want - o.current), dt * 0.8);
    doors.current.forEach((g, i) => {
      if (g) g.position.x = (i === 0 ? -1 : 1) * o.current * (dw / 2 + 0.02);
    });
    if (lamp.current) lamp.current.emissiveIntensity = 0.6 + o.current * 1.4;
  });
  const H = 3.4;
  const DH = 2.4;
  const d = zFront - zBack;
  const dw = Math.min(2.6, w - 0.9);
  const steel = { color: 0xe3e7ed, metalness: 0.55, roughness: 0.3 };
  const zc = (zBack + zFront) / 2;
  return (
    <group>
      <mesh position={[cx, H / 2, zc - 0.05]}>
        <boxGeometry args={[w - 0.04, H, d - 0.1]} />
        <meshStandardMaterial color={0xf1f3f6} roughness={0.85} />
      </mesh>
      <mesh position={[cx, H + 0.04, zc - 0.05]}>
        <boxGeometry args={[w + 0.06, 0.08, d]} />
        <meshStandardMaterial color={0xd5dae2} roughness={0.6} />
      </mesh>
      {[cx - dw / 2 - 0.07, cx + dw / 2 + 0.07].map((x) => (
        <mesh key={x} position={[x, DH / 2 + 0.05, zFront + 0.04]}>
          <boxGeometry args={[0.14, DH + 0.1, 0.1]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
      <mesh position={[cx, DH + 0.2, zFront + 0.04]}>
        <boxGeometry args={[dw + 0.28, 0.3, 0.1]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[cx, DH + 0.2, zFront + 0.1]}>
        <boxGeometry args={[0.34, 0.14, 0.02]} />
        <meshStandardMaterial ref={lamp} color={0x0b1a2a} emissive={0x22c3ee} emissiveIntensity={0.6} />
      </mesh>
      {[0, 1].map((k) => (
        <group
          key={k}
          ref={(g) => {
            if (g) doors.current[k] = g;
          }}
        >
          <mesh position={[cx + (k === 0 ? -dw / 4 : dw / 4), DH / 2, zFront + 0.02]}>
            <boxGeometry args={[dw / 2 - 0.01, DH, 0.05]} />
            <meshStandardMaterial color={0xe0e4ea} metalness={0.55} roughness={0.25} />
          </mesh>
          <mesh position={[cx + (k === 0 ? -dw / 4 : dw / 4), DH / 2, zFront + 0.05]}>
            <boxGeometry args={[0.02, DH * 0.9, 0.01]} />
            <meshStandardMaterial color={0xbcc3ce} metalness={0.5} roughness={0.3} />
          </mesh>
        </group>
      ))}
      <mesh position={[cx + dw / 2 + 0.32, 1.15, zFront + 0.06]}>
        <boxGeometry args={[0.12, 0.26, 0.03]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[cx + dw / 2 + 0.32, 1.15, zFront + 0.08]}>
        <circleGeometry args={[0.035, 16]} />
        <meshStandardMaterial color={0x16a34a} emissive={0x22c55e} emissiveIntensity={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.012, zFront + 0.32]} raycast={() => null}>
        <planeGeometry args={[dw + 0.4, 0.4]} />
        <meshStandardMaterial map={stripeTexture()} roughness={0.8} />
      </mesh>
      <sprite position={[cx, H + 0.7, zc]} scale={[3.0, 0.75, 1]}>
        <spriteMaterial map={plateTexture(label, { bg: '#1f2a44', fg: '#ffffff', w: 384, h: 96 })} depthWrite={false} />
      </sprite>
    </group>
  );
}

let stripeTex: THREE.CanvasTexture | null = null;
/** 노랑/검정 안전 띠 — MFC FreightLifts 와 같은 그림 */
function stripeTexture(): THREE.CanvasTexture {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1f2229';
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#f5c518';
  for (let x = -32; x < 256 + 32; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x + 16, 32);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 16, 0);
    ctx.fill();
  }
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  return stripeTex;
}

/** 흐르는 박스(컨베이어 위) — 경로 점들을 따라 n 개가 돈다. busy 일 때만 움직이고 보인다 */
function FlowBoxes({ path, n, busy, color = 0xd2a679, size = [0.5, 0.32, 0.38] }: { path: THREE.Vector3[]; n: number; busy: () => boolean; color?: number; size?: [number, number, number] }) {
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
      <meshStandardMaterial color={color} roughness={0.8} map={boxTexture()} />
    </instancedMesh>
  );
}

/**
 * 휠소터 줄 [사용자 §9 — 배민 인천기지 구조] — 출고대기 바로 앞을 동서로 지나는 본선, PPC-01~05 출고대기 롤테이너 자리로 북쪽 슈트(짧은 갈래).
 * 박스째 가는 상품은 슈트로 롤테이너에 바로, 낱개로 나눌 상품은 남쪽 DAS 존으로. 실제로 투입된 때만(최근 90초) 박스가 흐른다.
 */
/** 흰 출고 박스(MFC 박스) 색 */
const OUT_BOX = 0xf3f4f1;

function WheelSorter({ e, floor }: { e: Equip; floor: FloorNo }) {
  const { sim, layout } = useApp();
  const f = layout.floors.find((x) => x.floor === floor)!;
  const letter = e.temp === 'FROZEN' ? 'H' : e.temp === 'CHILLED' ? 'G' : floor === 7 ? 'E' : 'A';
  const slots = f.staging.filter((s) => s.zone === letter && s.bay <= MFCS.length);
  const busy = () => sim.speed > 0 && sim.sorterLog.some((x) => x.floor === floor && x.temp === e.temp && x.kind === 'IN' && sim.time - x.at < 90);
  const r = e.rect;
  const cz = (r.z0 + r.z1) / 2;
  const len = r.x1 - r.x0;
  return (
    <group>
      {/* 본선·슈트 틀은 움직이지 않음 → 같은 재질끼리 합쳐 그림(성능, StaticMerge — 롤러·흐르는 박스·경광등은 그대로) */}
      <StaticMerge>
      <Conveyor x={(r.x0 + r.x1) / 2} z={cz} len={len} dir="x" w={0.9} h={0.8} />
      {slots.map((s) => {
        const cl = r.z0 - (s.pos.z + 0.6);
        return (
          <group key={s.code}>
            {/* 슈트(갈래) — 본선에서 그 PPC 롤테이너로 */}
            <Conveyor x={s.pos.x} z={(r.z0 + s.pos.z + 0.6) / 2} len={Math.max(0.6, cl)} dir="z" w={0.6} h={0.7} />
            <mesh position={[s.pos.x, 0.86, cz]}>
              <boxGeometry args={[0.8, 0.04, 0.5]} />
              <meshStandardMaterial color={0x404650} />
            </mesh>
          </group>
        );
      })}
      </StaticMerge>
      <TowerLight x={r.x1 - 0.4} z={r.z1 + 0.3} busy={busy} />
      {/* 휠소터 위는 닫은 흰 출고 박스(기사 사진 — 손잡이 구멍 있는 흰 박스) */}
      <FlowBoxes path={[new THREE.Vector3(r.x1 - 0.5, 0.86, cz), new THREE.Vector3(r.x0 + 0.5, 0.86, cz)]} n={Math.max(4, Math.floor(len / 4))} busy={busy} color={OUT_BOX} />
    </group>
  );
}

/** DPS 구역 표시 — 컨베이어 위 구역 판(1~N) + 지금 그 구역에 있는 PPC 박스 [사용자 §9 DPS] */
function DpsZones({ floor }: { floor: FloorNo }) {
  const { sim } = useApp();
  const site = sim.sites.get(floor)!;
  const e = site.f.equipment.find((x) => x.kind === 'DPS');
  const boxes = useRef<THREE.InstancedMesh>(null!);
  useFrame(() => {
    if (!e || !boxes.current) return;
    let i = 0;
    for (const b of sim.dps.boxes) {
      if (i >= 40) break;
      const x = b.zone < 0 ? e.rect.x1 - 1 : site.dpsZoneX(b.zone);
      const n = sim.dps.queues[b.zone]?.indexOf(b) ?? 0;
      tmp.position.set(x + Math.max(0, n) * 0.5, 1.0, (e.rect.z0 + e.rect.z1) / 2);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      boxes.current.setMatrixAt(i++, tmp.matrix);
    }
    for (; i < 40; i++) {
      tmp.scale.set(0, 0, 0);
      tmp.updateMatrix();
      boxes.current.setMatrixAt(i, tmp.matrix);
    }
    boxes.current.instanceMatrix.needsUpdate = true;
  });
  if (!e) return null;
  return (
    <group>
      {Array.from({ length: FLOW.dps.zones }, (_, i) => (
        <sprite key={i} position={[site.dpsZoneX(i), 2.4, (e.rect.z0 + e.rect.z1) / 2]} scale={[1.8, 0.6, 1]}>
          <spriteMaterial map={plateTexture(`DPS ${i + 1}구역`, { bg: '#2f6fd6', fg: '#ffffff', w: 256, h: 84 })} depthWrite={false} />
        </sprite>
      ))}
      <instancedMesh ref={boxes} args={[undefined, undefined, 40]} frustumCulled={false}>
        <boxGeometry args={[0.42, 0.3, 0.34]} />
        <meshStandardMaterial color={OUT_BOX} roughness={0.85} map={boxTexture()} />
      </instancedMesh>
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
  const off = () => false;
  return (
    <group>
      {dasRows(e.rect).map((row, k) => {
        const { z, cx, len, slots } = row;
        const mfcAt = new Map(MFCS.map((m, i) => [mfcSlotIndex(i, slots.length), m]));
        return (
          <group key={k}>
            {/* 컨베이어 틀·크레이트·R/T 선반 틀은 움직이지 않음 → 합쳐 그림(성능) */}
            <StaticMerge>
            <Conveyor x={cx} z={z} len={len} dir="x" w={0.8} h={0.78} />
            {slots.map((x, i) =>
              split ? (
                // 분배: MFC 별 초록 크레이트(LPN = MFC 하나) — MFC 칸만
                mfcAt.has(i) && (
                  <mesh key={i} position={[x, 0.98, z + 1.0]}>
                    <boxGeometry args={[0.6, 0.32, 0.42]} />
                    <meshStandardMaterial color={0x3aa35a} />
                  </mesh>
                )
              ) : (
                <RollContainer key={i} x={x} z={z + 1.35} cold={false} fill={mfcAt.has(i) ? 0.5 : 0} />
              ),
            )}
            {!split && <BlueFrame x={cx} z={z + 1.35} len={len} depth={1.0} h={2.4} dir="x" levels={1} />}
            </StaticMerge>
            {/* 표시등 줄(꺼진 상태) — 켜지는 불은 WorkLights 가 실제 작업대로 그린다 */}
            {!split && <LightStrip x={cx} y={2.4} z={z + 0.83} len={len} dir="x" busy={off} />}
            {/* MFC 칸 이름(PPC 번호·MFC) */}
            {[...mfcAt].map(([i, m]) => (
              <sprite key={m.id} position={[slots[i], split ? 1.7 : 3.0, z + (split ? 1.0 : 1.35)]} scale={[1.5, 0.56, 1]}>
                <spriteMaterial map={plateTexture(`PPC-${String(m.staging).padStart(2, '0')}\n${m.name.replace(/^\d호점 /, '')}`, { w: 256, h: 96 })} depthWrite={false} />
              </sprite>
            ))}
            <FlowBoxes path={[new THREE.Vector3(cx - len / 2, 0.84, z), new THREE.Vector3(cx + len / 2, 0.84, z)]} n={Math.max(3, Math.floor(len / 5))} busy={busy} color={split ? 0x3aa35a : 0xd7b07c} />
          </group>
        );
      })}
    </group>
  );
}

/** 켜진 작업 표시등 — DPS 선반 칸·라인 칸에 그 작업자 색 불 + 숫자(시뮬레이션 lights) [현장 "스캐너 색과 같은 불이 켜진 칸에 숫자만큼"] */
export function WorkLights({ floor }: { floor: FloorNo }) {
  const { sim } = useApp();
  const [, force] = useState(0);
  const sig = useRef('');
  useFrame(() => {
    const s = sim.lights
      .filter((l) => l.floor === floor)
      .map((l) => `${l.x.toFixed(2)},${l.z.toFixed(2)},${l.color},${l.qty}`)
      .join('|');
    if (s !== sig.current) {
      sig.current = s;
      force((n) => n + 1);
    }
  });
  return (
    <>
      {sim.lights
        .filter((l) => l.floor === floor)
        .map((l, i) => (
          <group key={`${l.who}-${i}`} position={[l.x, l.y, l.z]}>
            <mesh>
              <boxGeometry args={[0.22, 0.12, 0.08]} />
              <meshStandardMaterial color={l.color} emissive={l.color} emissiveIntensity={2.2} toneMapped={false} />
            </mesh>
            <sprite position={[0, 0.42, 0]} scale={[0.7, 0.52, 1]} renderOrder={6}>
              <spriteMaterial map={qtyTexture(l.qty, l.color)} depthTest={false} depthWrite={false} />
            </sprite>
          </group>
        ))}
    </>
  );
}

const qtyCache = new Map<string, THREE.CanvasTexture>();
function qtyTexture(qty: number, color: string): THREE.CanvasTexture {
  const key = `${qty}|${color}`;
  let t = qtyCache.get(key);
  if (!t) {
    t = plateTexture(String(qty), { bg: color, fg: '#ffffff', w: 128, h: 96 });
    qtyCache.set(key, t);
  }
  return t;
}

/** DPS 박스 컨베이어 — 냉동 전실 안에서 박스를 받아 에어커튼을 지나 방 밖 출고대기 쪽으로(동 → 서). 길쭉한 쪽으로 뻗는다 */
function DpsConveyor({ e, floor }: { e: Equip; floor: FloorNo }) {
  const { sim } = useApp();
  const busy = () => sim.speed > 0 && sim.lights.some((l) => l.floor === floor && l.kind === 'DPS');
  const r = e.rect;
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const len = (alongX ? r.x1 - r.x0 : r.z1 - r.z0) - 0.6;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const path = alongX ? [new THREE.Vector3(r.x1 - 0.4, 0.86, cz), new THREE.Vector3(r.x0 + 0.4, 0.86, cz)] : [new THREE.Vector3(cx, 0.86, r.z1 - 0.4), new THREE.Vector3(cx, 0.86, r.z0 + 0.4)];
  return (
    <group>
      <StaticMerge>
        <Conveyor x={cx} z={cz} len={len} dir={alongX ? 'x' : 'z'} w={0.8} h={0.8} />
      </StaticMerge>
      <FlowBoxes path={path} n={Math.max(4, Math.floor(len / 3))} busy={busy} color={OUT_BOX} size={[0.42, 0.3, 0.32]} />
    </group>
  );
}

/** 야채 바닥 적치 레인(6F 냉장) — 자리마다 나무 팔레트 + 초록 크레이트 더미(현물만큼 높이). 크레이트는 입고 용기, 분배 크레이트(MFC 별)는 출고 용기 */
function VegLanes({ e, floor }: { e: Equip; floor: FloorNo }) {
  const { backend, layout, sim } = useApp();
  const f = layout.floors.find((x) => x.floor === floor)!;
  const cells = useMemo(() => f.shelves.filter((l) => l.lane), [f]);
  const pal = useRef<THREE.InstancedMesh>(null!);
  const crates = useRef<THREE.InstancedMesh>(null!);
  const ver = useRef(-1);
  useLayoutEffect(() => {
    cells.forEach((l, i) => {
      tmp.position.set(l.pos.x, 0.07, l.pos.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1.0, 0.14, 1.0);
      tmp.updateMatrix();
      pal.current.setMatrixAt(i, tmp.matrix);
    });
    pal.current.instanceMatrix.needsUpdate = true;
  }, [cells]);
  useFrame(() => {
    if (ver.current === backend.ledger.version) return;
    ver.current = backend.ledger.version;
    const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
    cells.forEach((l, i) => {
      const q = stock.get(l.code) ?? 0;
      const h = q ? 0.3 + 1.1 * Math.min(1, q / l.capacity) : 0;
      tmp.position.set(l.pos.x, 0.14 + h / 2, l.pos.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(q ? 0.95 : 0, q ? h : 0, q ? 0.95 : 0);
      tmp.updateMatrix();
      crates.current.setMatrixAt(i, tmp.matrix);
    });
    crates.current.instanceMatrix.needsUpdate = true;
  });
  void e;
  return (
    <group>
      <instancedMesh ref={pal} args={[undefined, undefined, cells.length]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0xd9b98a} roughness={0.85} map={palletTexture()} />
      </instancedMesh>
      <instancedMesh ref={crates} args={[undefined, undefined, cells.length]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0x3aa35a} roughness={0.7} />
      </instancedMesh>
    </group>
  );
}

/** 오토스토어 포트 앞 MFC 박스 다섯(PPC-01~05) — 숫자(통·포트 가동률)는 3D 에 띄우지 않고 왼쪽 구역 패널에(사용자 2026-11-25) [사용자 §5] */
function PortBoxes({ e }: { e: Equip }) {
  const ports = autostorePorts(e.rect);
  return (
    <group>
      {ports.map((px, p) =>
        MFCS.map((m, i) => (
          <group key={`${p}${m.id}`} position={[px + (i - (MFCS.length - 1) / 2) * 0.42, 0, e.rect.z1 - 0.3]}>
            <mesh position={[0, 0.95, 0]}>
              <boxGeometry args={[0.36, 0.26, 0.3]} />
              <meshStandardMaterial color={OUT_BOX} roughness={0.85} map={boxTexture()} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/**
 * 입고 검수 — 온도대마다(사용자 2026-11-25 "입고 검수 구역 … 온도별로 각각"). 승강기로 올라온 입고 팔레트를 내려놓고 수량·기한·온도를 확인하는 자리.
 * 입고 업무 자체는 시뮬레이션 범위 밖(scope S-3) — 자리·모형만. 저온은 랩 위 은색 보냉 덮개.
 */
export function Inbound({ e }: { e: Equip }) {
  const r = e.rect;
  const cold = e.temp && e.temp !== 'AMBIENT';
  const cols = Math.max(2, Math.floor((r.x1 - r.x0 - 3) / 1.6));
  return (
    <group>
      {/* 바닥 노란 칸선(팔레트 자리) */}
      {Array.from({ length: cols }, (_, i) => (
        <group key={i} position={[r.x0 + 1.2 + i * 1.6, 0, r.z0 + 2.2]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]}>
            <ringGeometry args={[0.72, 0.78, 4, 1, Math.PI / 4]} />
            <meshBasicMaterial color={0xf2c94c} />
          </mesh>
          {i % 3 !== 2 && (
            <>
              <mesh position={[0, 0.07, 0]}>
                <boxGeometry args={[1.1, 0.14, 1.1]} />
                <meshStandardMaterial color={0xd9b98a} roughness={0.85} map={palletTexture()} />
              </mesh>
              <mesh position={[0, 0.14 + 0.55, 0]}>
                <boxGeometry args={[1.0, 1.1, 1.0]} />
                <meshStandardMaterial color={cold ? 0xdde2e8 : 0xd2a679} roughness={cold ? 0.35 : 0.85} map={cold ? null : boxTexture()} />
              </mesh>
            </>
          )}
        </group>
      ))}
      {/* 검수대(스캐너·모니터) */}
      <group position={[(r.x0 + r.x1) / 2, 0, r.z1 - 1.6]}>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[2.4, 0.9, 0.8]} />
          <meshStandardMaterial color={0xf3f4f6} roughness={0.6} />
        </mesh>
        <mesh position={[0.6, 1.15, -0.2]}>
          <boxGeometry args={[0.5, 0.36, 0.04]} />
          <meshStandardMaterial color={0x1f2430} emissive={0x274b7a} emissiveIntensity={0.5} />
        </mesh>
        <mesh position={[-0.5, 0.95, 0.1]}>
          <boxGeometry args={[0.12, 0.1, 0.2]} />
          <meshStandardMaterial color={0xf2c94c} />
        </mesh>
      </group>
    </group>
  );
}

/** DC 관리자 사무실 — 유리 칸막이·책상·의자·모니터·화이트보드(사용자 2026-11-25 "7층에 dc 관리자 사무실") */
function Office({ e }: { e: Equip }) {
  const r = e.rect;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const desks = Math.max(2, Math.floor((d - 3) / 2.4));
  return (
    <group>
      {/* 유리 칸막이(서쪽·북쪽·남쪽) — 서쪽 가운데 문 */}
      {[
        [r.x0, r.z0 + (d / 2 - 0.8) / 2, 0.06, d / 2 - 0.8],
        [r.x0, r.z1 - (d / 2 - 0.8) / 2, 0.06, d / 2 - 0.8],
        [cx, r.z0, w, 0.06],
        [cx, r.z1, w, 0.06],
      ].map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, 1.25, z]} raycast={() => null}>
          <boxGeometry args={[sx, 2.5, sz]} />
          <meshStandardMaterial color={0xcfe3f7} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
      {Array.from({ length: desks }, (_, i) => {
        const z = r.z0 + 2 + i * 2.4;
        return (
          <group key={i} position={[cx + 0.3, 0, z]}>
            <mesh position={[0, 0.74, 0]}>
              <boxGeometry args={[1.4, 0.05, 0.75]} />
              <meshStandardMaterial color={0xe8e2d6} />
            </mesh>
            {[-0.62, 0.62].map((dx) => (
              <mesh key={dx} position={[dx, 0.37, 0]}>
                <boxGeometry args={[0.05, 0.74, 0.7]} />
                <meshStandardMaterial color={0x9aa1ab} />
              </mesh>
            ))}
            <mesh position={[0.35, 1.02, 0]} rotation-y={-Math.PI / 2}>
              <boxGeometry args={[0.55, 0.34, 0.03]} />
              <meshStandardMaterial color={0x1f2430} emissive={0x2a5a9a} emissiveIntensity={0.45} />
            </mesh>
            {/* 의자 */}
            <mesh position={[-0.75, 0.45, 0]}>
              <boxGeometry args={[0.45, 0.08, 0.45]} />
              <meshStandardMaterial color={0x2f3542} />
            </mesh>
            <mesh position={[-0.97, 0.75, 0]}>
              <boxGeometry args={[0.06, 0.55, 0.45]} />
              <meshStandardMaterial color={0x2f3542} />
            </mesh>
          </group>
        );
      })}
      {/* 화이트보드(동쪽 벽) */}
      <mesh position={[r.x1 - 0.08, 1.4, r.z1 - 2]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[2.2, 1.1]} />
        <meshStandardMaterial color={0xffffff} />
      </mesh>
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
  const nz = Math.floor((r.z1 - r.z0 - 2.8) / cell);
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
      {autostorePorts(r).map((px) => (
        <group key={px} position={[px, 0, r.z1 - 0.9]}>
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
  if (e.kind === 'DPS')
    return (
      <>
        <DpsConveyor e={e} floor={floor} />
        <DpsZones floor={floor} />
      </>
    );
  if (e.kind === 'INBOUND') return <Inbound e={e} />;
  if (e.kind === 'VEG_LANES') return <VegLanes e={e} floor={floor} />;
  if (e.kind === 'OFFICE') return <Office e={e} />;
  return (
    <>
      <AutoStore e={e} />
      <PortBoxes e={e} />
    </>
  );
}
