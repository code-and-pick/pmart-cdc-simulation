// 피킹 선반 — MFC 시뮬레이터 선반 모양(1.25m 유닛 · 깊이 0.45 · 높이 2.1, 5단 × 3칸).
// 팔레트 랙에서 박스를 뜯어 낱개로 진열해 두는 곳(사용자 2026-11-25). FC 피커가 여기서 MFC 주문(TRF)별로 집는다.
// 칸 재고는 원장(ledger.version)이 바뀔 때만 다시 그린다.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp, useView } from '../../app/context';
import { SHELF } from '../../config';
import type { FloorLayout } from '../../domain/layout';
import { SCENE } from '../colors';
import { plateTexture } from '../sprites';

const tmp = new THREE.Object3D();
const BOARD = 0.03;
const levelY = (lv: number) => 0.15 + ((lv - 1) * (SHELF.height - 0.25)) / SHELF.levels;

export function Shelves({ f }: { f: FloorLayout }) {
  return (
    <>
      <Frames f={f} />
      <ShelfStock f={f} />
      <ShelfPlates f={f} />
    </>
  );
}

/** 선반 기둥·단 판 */
function Frames({ f }: { f: FloorLayout }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const boards = useRef<THREE.InstancedMesh>(null);
  const counts = useMemo(
    () => ({ p: f.shelfRows.reduce((s, r) => s + (r.units + 1) * 2, 0), b: f.shelfRows.reduce((s, r) => s + r.units * SHELF.levels, 0) }),
    [f],
  );
  useEffect(() => {
    let i = 0;
    let j = 0;
    for (const r of f.shelfRows) {
      for (let k = 0; k <= r.units; k++) {
        for (const dx of [-SHELF.depth / 2, SHELF.depth / 2]) {
          tmp.position.set(r.cx + dx, SHELF.height / 2, r.z0 + k * SHELF.unitLen);
          tmp.scale.set(0.04, SHELF.height, 0.04);
          tmp.updateMatrix();
          posts.current!.setMatrixAt(i++, tmp.matrix);
        }
      }
      for (let u = 0; u < r.units; u++) {
        for (let lv = 1; lv <= SHELF.levels; lv++) {
          tmp.position.set(r.cx, levelY(lv), r.z0 + (u + 0.5) * SHELF.unitLen);
          tmp.scale.set(SHELF.depth, BOARD, SHELF.unitLen - 0.04);
          tmp.updateMatrix();
          boards.current!.setMatrixAt(j++, tmp.matrix);
        }
      }
    }
    posts.current!.instanceMatrix.needsUpdate = true;
    boards.current!.instanceMatrix.needsUpdate = true;
  }, [f]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, counts.p]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={SCENE.shelfPost} />
      </instancedMesh>
      <instancedMesh ref={boards} args={[undefined, undefined, counts.b]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={SCENE.shelfBoard} />
      </instancedMesh>
    </>
  );
}

/** 칸마다 진열한 낱개 상품(작은 상자 묶음) — 높이 = 칸 용량 대비 현물. 누르기는 Core.Picker(빈 칸 포함) */
function ShelfStock({ f }: { f: FloorLayout }) {
  const { backend } = useApp();
  const ref = useRef<THREE.InstancedMesh>(null);
  const seen = useRef(-1);
  const slotW = SHELF.unitLen / SHELF.slots;
  const maxH = (SHELF.height - 0.25) / SHELF.levels - 0.08;
  useFrame(() => {
    if (seen.current === backend.ledger.version) return;
    seen.current = backend.ledger.version;
    const stock = backend.ledger.onHandByLocation();
    const color = new THREE.Color();
    f.shelves.forEach((l, i) => {
      const q = stock.get(l.code) ?? 0;
      const h = q ? maxH * (0.25 + 0.75 * Math.min(1, q / l.capacity)) : 0;
      tmp.position.set(l.pos.x, l.pos.y + BOARD / 2 + h / 2, l.pos.z);
      tmp.scale.set(q ? SHELF.depth * 0.85 : 0, h, q ? slotW * 0.8 : 0);
      tmp.updateMatrix();
      ref.current!.setMatrixAt(i, tmp.matrix);
      color.setHSL(((i * 47) % 360) / 360, 0.45, 0.62);
      ref.current!.setColorAt(i, color);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, f.shelves.length]} frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}

/** 선반 통로 번호판(예 C61) — 통로 북쪽 끝 위 */
function ShelfPlates({ f }: { f: FloorLayout }) {
  const view = useView();
  if (view.labelMode === 'off') return null;
  const z0 = f.shelfRows[0]?.z0 ?? 0;
  return (
    <>
      {f.shelfAisles.map((a) => (
        <sprite key={a.plate} position={[a.cx, SHELF.height + 0.6, z0 - 0.3]} scale={[1.6, 0.8, 1]}>
          <spriteMaterial map={plateTexture(a.plate)} depthWrite={false} />
        </sprite>
      ))}
    </>
  );
}
