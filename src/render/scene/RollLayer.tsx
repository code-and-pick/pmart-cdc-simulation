// 롤테이너(R/T) 전부를 부품별 InstancedMesh 로 한 번에 그린다(성능, 사용자 2026-11-26 "여전히 느리다" — FPS 10, 개별 Mesh 991 중 대부분이 R/T 부품).
// 모양·색은 Equipment3D.RollContainer 그대로: 바닥판 · 바퀴 4 · 기둥 4 · 옆 3면 가로 살 · 뒤판 세로 살 · 상자(층마다 2, 두 색) · 저온은 보냉 커버 + 앞 창.
// RollContainer 는 빈 group(자리)만 두고 여기에 등록한다 — 사람이 끄는 것도 부모 group 을 따라 움직이므로 매 프레임 자리 행렬을 읽는다.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxTexture } from '../sprites';

export interface RollEntry {
  obj: THREE.Object3D;
  cold: boolean;
  layers: number;
}
/** 화면에 있는 R/T 자리들 */
export const rolls = new Set<RollEntry>();

const W = 0.8;
const D = 0.6;
const H = 1.7;
const MAX_RT = 1500;

/** 지오메트리 여러 개(각자 위치)를 하나로 */
function merged(parts: { g: THREE.BufferGeometry; x: number; y: number; z: number; rz?: number }[]): THREE.BufferGeometry {
  const gs = parts.map(({ g, x, y, z, rz }) => {
    const c = g.clone().toNonIndexed();
    if (rz) c.rotateZ(rz);
    c.translate(x, y, z);
    c.deleteAttribute('uv');
    return c;
  });
  const out = mergeGeometries(gs)!;
  for (const g of gs) g.dispose();
  return out;
}

function frameGeo(): THREE.BufferGeometry {
  const p: { g: THREE.BufferGeometry; x: number; y: number; z: number }[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push({ g: new THREE.BoxGeometry(0.03, H - 0.18, 0.03), x: sx * (W / 2 - 0.015), y: 0.18 + (H - 0.18) / 2, z: sz * (D / 2 - 0.015) });
  for (const y of [0.45, 0.75, 1.05, 1.35, 1.65]) {
    p.push({ g: new THREE.BoxGeometry(W, 0.02, 0.015), x: 0, y, z: -D / 2 + 0.015 });
    for (const sx of [-1, 1]) p.push({ g: new THREE.BoxGeometry(0.015, 0.02, D), x: sx * (W / 2 - 0.015), y, z: 0 });
  }
  for (const dx of [-0.25, -0.08, 0.08, 0.25]) p.push({ g: new THREE.BoxGeometry(0.012, H - 0.18, 0.012), x: dx, y: 0.18 + (H - 0.18) / 2, z: -D / 2 + 0.015 });
  return merged(p);
}
function wheelGeo(): THREE.BufferGeometry {
  const p: { g: THREE.BufferGeometry; x: number; y: number; z: number; rz: number }[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push({ g: new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), x: sx * (W / 2 - 0.07), y: 0.06, z: sz * (D / 2 - 0.07), rz: Math.PI / 2 });
  return merged(p);
}

const tmp = new THREE.Matrix4();
const off = new THREE.Matrix4();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

export function RollLayer() {
  const geos = useMemo(
    () => ({
      frame: frameGeo(),
      wheel: wheelGeo(),
      base: new THREE.BoxGeometry(W, 0.04, D),
      box: new THREE.BoxGeometry(0.34, 0.35, 0.5),
      cover: new THREE.BoxGeometry(W + 0.05, H - 0.12, D + 0.05),
      window: new THREE.PlaneGeometry(0.32, 0.36),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      frame: new THREE.MeshStandardMaterial({ color: 0x2f6fd6, metalness: 0.5, roughness: 0.35 }),
      wheel: new THREE.MeshStandardMaterial({ color: 0x1f2229 }),
      base: new THREE.MeshStandardMaterial({ color: 0x24569f, metalness: 0.3, roughness: 0.5 }),
      box: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: boxTexture() }),
      cover: new THREE.MeshStandardMaterial({ color: 0xdde1e6, metalness: 0.15, roughness: 0.35 }),
      window: new THREE.MeshStandardMaterial({ color: 0x2f7fd6 }),
    }),
    [],
  );
  const refs = {
    frame: useRef<THREE.InstancedMesh>(null!),
    wheel: useRef<THREE.InstancedMesh>(null!),
    base: useRef<THREE.InstancedMesh>(null!),
    box: useRef<THREE.InstancedMesh>(null!),
    cover: useRef<THREE.InstancedMesh>(null!),
    window: useRef<THREE.InstancedMesh>(null!),
  };
  const colA = useMemo(() => new THREE.Color(0xd2a679), []);
  const colB = useMemo(() => new THREE.Color(0xc99a6b), []);
  useFrame(() => {
    const fr = refs.frame.current;
    if (!fr) return;
    let n = 0;
    let nb = 0;
    let nc = 0;
    for (const e of rolls) {
      if (n >= MAX_RT) break;
      // 숨은 부모(다른 층·접힌 것) 아래면 그리지 않음
      let shown = true;
      for (let p: THREE.Object3D | null = e.obj; p; p = p.parent) if (!p.visible) { shown = false; break; }
      if (!shown || !e.obj.parent) continue;
      const m = e.obj.matrixWorld;
      fr.setMatrixAt(n, m);
      refs.wheel.current.setMatrixAt(n, m);
      off.makeTranslation(0, 0.16, 0);
      tmp.multiplyMatrices(m, off);
      refs.base.current.setMatrixAt(n, tmp);
      n++;
      for (let k = 0; k < e.layers; k++)
        for (const sx of [-1, 1]) {
          if (nb >= MAX_RT * 8) break;
          off.makeTranslation(sx * 0.18, 0.36 + k * 0.37, 0);
          tmp.multiplyMatrices(m, off);
          refs.box.current.setMatrixAt(nb, tmp);
          refs.box.current.setColorAt(nb, (k + (sx > 0 ? 1 : 0)) % 2 ? colB : colA);
          nb++;
        }
      if (e.cold && nc < MAX_RT) {
        off.makeTranslation(0, 0.18 + (H - 0.18) / 2, 0);
        tmp.multiplyMatrices(m, off);
        refs.cover.current.setMatrixAt(nc, tmp);
        off.makeTranslation(0, H * 0.62, D / 2 + 0.03);
        tmp.multiplyMatrices(m, off);
        refs.window.current.setMatrixAt(nc, tmp);
        nc++;
      }
    }
    for (const [r, c] of [
      [refs.frame, n],
      [refs.wheel, n],
      [refs.base, n],
      [refs.box, nb],
      [refs.cover, nc],
      [refs.window, nc],
    ] as const) {
      const im = r.current;
      im.count = c;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    void zero;
  });
  return (
    <group>
      <instancedMesh ref={refs.frame} args={[geos.frame, mats.frame, MAX_RT]} frustumCulled={false} />
      <instancedMesh ref={refs.wheel} args={[geos.wheel, mats.wheel, MAX_RT]} frustumCulled={false} />
      <instancedMesh ref={refs.base} args={[geos.base, mats.base, MAX_RT]} frustumCulled={false} />
      <instancedMesh ref={refs.box} args={[geos.box, mats.box, MAX_RT * 8]} frustumCulled={false} />
      <instancedMesh ref={refs.cover} args={[geos.cover, mats.cover, MAX_RT]} frustumCulled={false} />
      <instancedMesh ref={refs.window} args={[geos.window, mats.window, MAX_RT]} frustumCulled={false} />
    </group>
  );
}
