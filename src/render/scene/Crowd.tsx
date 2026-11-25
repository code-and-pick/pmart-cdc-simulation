// 작업자 무리를 부위별 InstancedMesh 로 한 번에 그린다(성능, 사용자 2026-11-25 "해상도·모형·기능은 그대로 빠르게").
// 모양·색·크기·관절·걷기 흔들림은 Humanoid.tsx 와 같다 — 사람마다 Mesh 15개(그리기 15번) 대신 부위마다 한 번.
// 위치·방향·자세는 useFrame 에서 행렬로 계산한다(React 상태로 올리지 않음). 누르기·카트·지게차는 Agents.Person 이 그대로 한다.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp, useView } from '../../app/context';
import type { Agent } from '../../sim/agent';
import type { HumanoidLook } from './Humanoid';

const HIP_Y = 0.86;
const SHOULDER_Y = 1.36;
const LEG = 0.82;
const ARM = 0.62;
const DEFAULT_SKIN = 0xf1d3b3;
/** 고른 사람 조끼 밝게(Humanoid.highlight 의 emissive 0x3a3a3a 와 같은 양) */
const HIGHLIGHT = new THREE.Color(0x3a3a3a);

type Joint = 'root' | 'legL' | 'legR' | 'armL' | 'armR';
interface Part {
  key: string;
  geo: () => THREE.BufferGeometry;
  mat: () => THREE.Material;
  /** 사람 하나에 몇 개(좌우 2) — 관절 목록 */
  joints: Joint[];
  /** 관절 기준 위치·회전·크기 */
  pos: [number, number, number];
  rotX?: number;
  scale?: [number, number, number];
  /** 이 사람에게 있는지, 색(null = 재질 색 그대로) */
  has: (l: HumanoidLook) => boolean;
  color: (l: HumanoidLook) => number | null;
  vest?: boolean;
}

const std = (o: THREE.MeshStandardMaterialParameters) => () => new THREE.MeshStandardMaterial({ color: 0xffffff, ...o });
const skin = (l: HumanoidLook) => l.skin ?? DEFAULT_SKIN;
const halfSphere = (r: number, w: number, h: number) => () => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);

const PARTS: Part[] = [
  { key: 'leg', geo: () => new THREE.CapsuleGeometry(0.075, LEG - 0.15, 3, 8), mat: std({ roughness: 0.8 }), joints: ['legL', 'legR'], pos: [0, -LEG / 2, 0], has: () => true, color: (l) => l.pants },
  { key: 'foot', geo: () => new THREE.BoxGeometry(0.13, 0.08, 0.26), mat: std({ color: 0x2b2b2b, roughness: 0.9 }), joints: ['legL', 'legR'], pos: [0, -LEG + 0.02, 0.05], has: () => true, color: () => null },
  { key: 'torso', geo: () => new THREE.CapsuleGeometry(0.19, 0.36, 4, 10), mat: std({ roughness: 0.7 }), joints: ['root'], pos: [0, 1.12, 0], has: () => true, color: (l) => l.shirt },
  { key: 'vest', geo: () => new THREE.CylinderGeometry(0.215, 0.205, 0.46, 12, 1, true), mat: std({ roughness: 0.6, side: THREE.DoubleSide }), joints: ['root'], pos: [0, 1.13, 0], has: (l) => l.vest !== null, color: (l) => l.vest, vest: true },
  { key: 'arm', geo: () => new THREE.CapsuleGeometry(0.06, ARM - 0.12, 3, 8), mat: std({ roughness: 0.7 }), joints: ['armL', 'armR'], pos: [0, -ARM / 2, 0], has: () => true, color: (l) => l.vest ?? l.shirt },
  { key: 'hand', geo: () => new THREE.SphereGeometry(0.055, 8, 6), mat: std({}), joints: ['armL', 'armR'], pos: [0, -ARM + 0.02, 0], has: () => true, color: skin },
  { key: 'pda', geo: () => new THREE.BoxGeometry(0.08, 0.16, 0.025), mat: std({ color: 0x222831, emissive: 0x1d4ed8, emissiveIntensity: 0.25 }), joints: ['armR'], pos: [0, -ARM + 0.02, 0.06], rotX: 0.4, has: (l) => !!l.pda, color: () => null },
  { key: 'neck', geo: () => new THREE.CylinderGeometry(0.055, 0.06, 0.08, 8), mat: std({}), joints: ['root'], pos: [0, 1.47, 0], has: () => true, color: skin },
  { key: 'head', geo: () => new THREE.SphereGeometry(0.125, 14, 10), mat: std({ roughness: 0.6 }), joints: ['root'], pos: [0, 1.6, 0], has: () => true, color: skin },
  { key: 'hair', geo: halfSphere(0.125, 14, 8), mat: std({ roughness: 0.9 }), joints: ['root'], pos: [0, 1.64, -0.015], scale: [1.04, 0.85, 1.06], has: (l) => l.head === 'hair', color: (l) => l.headColor },
  { key: 'cap', geo: halfSphere(0.132, 14, 8), mat: std({ roughness: 0.7 }), joints: ['root'], pos: [0, 1.655, 0], has: (l) => l.head === 'cap', color: (l) => l.headColor },
  { key: 'brim', geo: () => new THREE.BoxGeometry(0.2, 0.015, 0.11), mat: std({ roughness: 0.7 }), joints: ['root'], pos: [0, 1.66, 0.13], rotX: 0.15, has: (l) => l.head === 'cap', color: (l) => l.headColor },
  { key: 'helmet', geo: () => new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mat: std({ roughness: 0.35, metalness: 0.1 }), joints: ['root'], pos: [0, 1.63, 0], has: (l) => l.head === 'helmet', color: (l) => l.headColor },
  {
    key: 'visor',
    geo: () => new THREE.SphereGeometry(0.15, 14, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.35, Math.PI * 0.25),
    mat: std({ color: 0x1f2937, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    joints: ['root'],
    pos: [0, 1.6, 0.02],
    has: (l) => l.head === 'helmet',
    color: () => null,
  },
];

const JOINT_AT: Record<Joint, [number, number, number]> = { root: [0, 0, 0], legL: [-0.11, HIP_Y, 0], legR: [0.11, HIP_Y, 0], armL: [-0.26, SHOULDER_Y, 0], armR: [0.26, SHOULDER_Y, 0] };

/** 관절 각(x 축) — Humanoid.animate 와 같은 식 */
interface Pose {
  phase: number;
  amp: number;
  last: { x: number; z: number } | null;
}

export function Crowd({ lookOf }: { lookOf: (a: Agent) => HumanoidLook }) {
  const { sim } = useApp();
  const view = useView();
  const cap = Math.max(1, sim.agents.length);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const poses = useRef(new Map<string, Pose>());
  const looks = useMemo(() => new Map<string, HumanoidLook>(), []);
  const geos = useMemo(() => PARTS.map((p) => p.geo()), []);
  const mats = useMemo(() => PARTS.map((p) => p.mat()), []);
  const tmp = useMemo(
    () => ({ person: new THREE.Matrix4(), joint: new THREE.Matrix4(), part: new THREE.Matrix4(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }),
    [],
  );
  // 부위 자체 변환(관절 기준) — 고정
  const local = useMemo(
    () =>
      PARTS.map((p) => {
        const m = new THREE.Matrix4();
        m.compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotX ?? 0, 0, 0)), new THREE.Vector3(...(p.scale ?? [1, 1, 1])));
        return m;
      }),
    [],
  );

  useFrame((_, dt) => {
    const { person, joint, part, m, q, e, v, s, c } = tmp;
    const used = PARTS.map(() => 0);
    for (const a of sim.agents) {
      if (a.floor !== view.floor) continue;
      let look = looks.get(a.id);
      if (!look) looks.set(a.id, (look = lookOf(a)));
      let st = poses.current.get(a.id);
      if (!st) poses.current.set(a.id, (st = { phase: 0, amp: 0, last: null }));
      // Agents.Person 과 같은 판단: 지게차를 타면 운전석으로, 카트·롤테이너를 밀면 팔을 앞으로
      const truck = a.role === 'REPL';
      const riding = truck && !a.parked;
      const moved0 = st.last ? Math.hypot(a.pos.x - st.last.x, a.pos.z - st.last.z) : 0;
      st.last = { x: a.pos.x, z: a.pos.z };
      const moved = riding || moved0 > 0.5 ? 0 : moved0;
      const pushing = !truck && a.carrying !== null;
      st.phase += moved * 4.5;
      const target = moved > 1e-4 ? 0.55 : 0;
      st.amp += (target - st.amp) * Math.min(1, dt * 8);
      const sw = Math.sin(st.phase) * st.amp;
      const ang: Record<Joint, number> = {
        root: 0,
        legL: sw,
        legR: -sw,
        armL: pushing ? -1.15 + sw * 0.1 : -sw * 0.9,
        armR: pushing ? -1.15 - sw * 0.1 : look.pda ? -0.75 : sw * 0.9,
      };
      // 사람 기준: 위치·방향 + (지게차 운전석 자리)
      q.setFromAxisAngle(v.set(0, 1, 0), a.heading);
      person.compose(v.set(a.pos.x, 0, a.pos.z), q, s.set(1, 1, 1));
      if (riding) person.multiply(m.makeTranslation(0, 0.22, -0.55));
      const selected = view.selectedWorker === a.id;
      PARTS.forEach((p, pi) => {
        if (!p.has(look!)) return;
        const im = meshes.current[pi];
        if (!im) return;
        for (const j of p.joints) {
          const [jx, jy, jz] = JOINT_AT[j];
          joint.compose(v.set(jx, jy, jz), q.setFromEuler(e.set(ang[j], 0, 0)), s.set(1, 1, 1));
          part.multiplyMatrices(person, joint).multiply(local[pi]);
          const i = used[pi]++;
          im.setMatrixAt(i, part);
          const col = p.color(look!);
          if (col !== null && im.instanceColor !== undefined) {
            c.setHex(col);
            if (p.vest && selected) c.add(HIGHLIGHT);
            im.setColorAt(i, c);
          }
        }
      });
    }
    PARTS.forEach((_p, pi) => {
      const im = meshes.current[pi];
      if (!im) return;
      // 지금 층 사람 수만큼만 그린다(남는 자리는 그리지 않음)
      im.count = used[pi];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  });

  return (
    <>
      {PARTS.map((p, pi) => (
        <instancedMesh
          key={p.key}
          ref={(r) => {
            meshes.current[pi] = r;
            // 색이 사람마다 다른 부위는 instanceColor 를 미리 만든다(처음 그릴 때부터 있어야 셰이더가 쓴다)
            if (r && p.color({ shirt: 0, pants: 0, vest: 0, head: 'hair', headColor: 0 }) !== null && !r.instanceColor) r.setColorAt(0, new THREE.Color(1, 1, 1));
          }}
          args={[geos[pi], mats[pi], cap * p.joints.length]}
          count={0}
          frustumCulled={false}
          raycast={() => undefined}
        />
      ))}
    </>
  );
}
