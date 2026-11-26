// 같은 모양·같은 재질 Mesh 를 매 프레임 InstancedMesh 하나로 모아 그린다(그리기 호출 줄이기, 사용자 2026-11-26 "여전히 느리다" — 개별 Mesh 약 1,200개 = 그리기 1,150번).
// 지게차·상자·팔레트·표시등처럼 컴포넌트마다 따로 만든 Mesh 가 같은 크기·색으로 수십 개씩 있다 → 모양(지오메트리 종류·치수)+재질 값으로 묶는다.
// 원본은 그대로 두고(움직임·숨김·누르기는 원본이 한다) 레이어만 31 로 옮겨 카메라가 안 그리게 한다 — 원본이 숨으면(visible=false) 묶음에서도 빠진다.
// 묶지 않는 것: 투명 재질, 배열 재질, 스프라이트, 이미 InstancedMesh, 치수 정보 없는 지오메트리(합친 것 등), 같은 묶음이 MIN 개 미만.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const HIDDEN_LAYER = 31;
const MIN = 3;

function matKey(m: THREE.Material): string | null {
  if (m.transparent) return null;
  const a = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
  return [m.type, a.color?.getHex(), a.roughness, a.metalness, a.emissive?.getHex(), a.emissiveIntensity, a.map?.uuid ?? '', m.side, m.depthWrite, m.depthTest, a.flatShading, m.vertexColors, m.opacity].join('|');
}
function geoKey(g: THREE.BufferGeometry): string | null {
  const p = (g as THREE.BufferGeometry & { parameters?: Record<string, unknown> }).parameters;
  if (!p) return null;
  return `${g.type}${JSON.stringify(p)}`;
}

interface Batch {
  im: THREE.InstancedMesh;
  cap: number;
  used: boolean;
}

export function AutoBatch() {
  const scene = useThree((s) => s.scene);
  const root = useRef<THREE.Group>(null!);
  const batches = useRef(new Map<string, Batch>());
  const geoCache = useRef(new WeakMap<THREE.BufferGeometry, string | null>());
  useEffect(
    () => () => {
      for (const b of batches.current.values()) b.im.dispose();
    },
    [],
  );
  useFrame(() => {
    const groups = new Map<string, THREE.Mesh[]>();
    const mine = root.current;
    scene.traverseVisible((o) => {
      if (o === mine) return;
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.parent === mine) return;
      let gk = geoCache.current.get(m.geometry);
      if (gk === undefined) geoCache.current.set(m.geometry, (gk = geoKey(m.geometry)));
      if (!gk) return;
      const mk = matKey(m.material as THREE.Material);
      if (!mk) {
        if (m.layers.mask === 1 << HIDDEN_LAYER) m.layers.set(0);
        return;
      }
      const k = `${gk}#${mk}`;
      const list = groups.get(k);
      if (list) list.push(m);
      else groups.set(k, [m]);
    });
    for (const b of batches.current.values()) b.used = false;
    for (const [k, list] of groups) {
      if (list.length < MIN) {
        for (const m of list) if (m.layers.mask === 1 << HIDDEN_LAYER) m.layers.set(0);
        continue;
      }
      let b = batches.current.get(k);
      if (!b || b.cap < list.length) {
        if (b) {
          mine.remove(b.im);
          b.im.dispose();
        }
        const cap = Math.max(16, Math.ceil(list.length * 1.5));
        const im = new THREE.InstancedMesh(list[0].geometry, list[0].material as THREE.Material, cap);
        im.frustumCulled = false;
        im.matrixAutoUpdate = false;
        mine.add(im);
        b = { im, cap, used: true };
        batches.current.set(k, b);
      }
      b.used = true;
      b.im.material = list[0].material as THREE.Material;
      for (let i = 0; i < list.length; i++) {
        b.im.setMatrixAt(i, list[i].matrixWorld);
        list[i].layers.set(HIDDEN_LAYER);
      }
      b.im.count = list.length;
      b.im.instanceMatrix.needsUpdate = true;
    }
    for (const b of batches.current.values()) if (!b.used) b.im.count = 0;
  });
  // 묶음 InstancedMesh 는 장면 원점(행렬 = 원본의 세계 행렬)
  return <group ref={root} />;
}
