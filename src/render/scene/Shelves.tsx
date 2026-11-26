// 피킹 선반 — MFC 시뮬레이터 선반 모양(1.25m 유닛 · 깊이 0.45 · 높이 2.1, 5단 × 3칸).
// 팔레트 랙에서 박스를 뜯어 낱개로 진열해 두는 곳(사용자 2026-11-25). FC 피커가 여기서 MFC 주문(TRF)별로 집는다.
// 칸 재고는 원장(ledger.version)이 바뀔 때만 다시 그린다.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp, useView } from '../../app/context';
import { SHELF } from '../../config';
import type { FloorLayout } from '../../domain/layout';
import { zoneBoxColor } from '../colors';
import { plateTexture, boxTexture } from '../sprites';

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

/**
 * 선반 틀 — MFC 시뮬레이터 흰 랙(Facility.ShipRack) 모양 그대로(사용자 2026-11-25 "피킹랙 모형 모양도 mfc 하얀랙이랑 똑같게"):
 * 흰 기둥(0.06) · 단마다 앞뒤 흰 가로대(0.07 높이) · 옅은 회백 단 판 · 줄 양 끝 옆면 지그재그 가새.
 */
function Frames({ f }: { f: FloorLayout }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const boards = useRef<THREE.InstancedMesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);
  const braces = useRef<THREE.InstancedMesh>(null);
  const BR = 3;
  const counts = useMemo(
    () => ({
      p: f.shelfRows.reduce((s, r) => s + (r.units + 1) * 2, 0),
      b: f.shelfRows.reduce((s, r) => s + r.units * SHELF.levels, 0),
      bm: f.shelfRows.length * SHELF.levels * 2,
      br: f.shelfRows.length * 2 * BR,
    }),
    [f],
  );
  useEffect(() => {
    let i = 0;
    let j = 0;
    let k2 = 0;
    let q = 0;
    const P = 0.06;
    for (const r of f.shelfRows) {
      for (let k = 0; k <= r.units; k++) {
        for (const dx of [-(SHELF.depth - P) / 2, (SHELF.depth - P) / 2]) {
          tmp.position.set(r.cx + dx, SHELF.height / 2, r.z0 + k * SHELF.unitLen);
          tmp.rotation.set(0, 0, 0);
          tmp.scale.set(P, SHELF.height, P);
          tmp.updateMatrix();
          posts.current!.setMatrixAt(i++, tmp.matrix);
        }
      }
      for (let u = 0; u < r.units; u++) {
        for (let lv = 1; lv <= SHELF.levels; lv++) {
          tmp.position.set(r.cx, levelY(lv), r.z0 + (u + 0.5) * SHELF.unitLen);
          tmp.rotation.set(0, 0, 0);
          tmp.scale.set(SHELF.depth - 0.04, 0.025, SHELF.unitLen - 0.04);
          tmp.updateMatrix();
          boards.current!.setMatrixAt(j++, tmp.matrix);
        }
      }
      // 앞뒤 가로대 — 줄 길이 전체
      const len = r.z1 - r.z0;
      for (let lv = 1; lv <= SHELF.levels; lv++) {
        for (const dx of [-(SHELF.depth - 0.05) / 2, (SHELF.depth - 0.05) / 2]) {
          tmp.position.set(r.cx + dx, levelY(lv) - 0.03, (r.z0 + r.z1) / 2);
          tmp.rotation.set(0, 0, 0);
          tmp.scale.set(0.05, 0.07, len);
          tmp.updateMatrix();
          beams.current!.setMatrixAt(k2++, tmp.matrix);
        }
      }
      // 양 끝 옆면 가새(앞뒤 기둥 사이 지그재그)
      const segH = (SHELF.height - 0.3) / BR;
      const d = SHELF.depth - P;
      const ang = Math.atan2(d, segH);
      for (const z of [r.z0, r.z1]) {
        for (let n = 0; n < BR; n++) {
          tmp.position.set(r.cx, 0.15 + segH * (n + 0.5), z);
          tmp.rotation.set(0, 0, n % 2 ? ang : -ang);
          tmp.scale.set(0.02, Math.hypot(d, segH), 0.02);
          tmp.updateMatrix();
          braces.current!.setMatrixAt(q++, tmp.matrix);
        }
      }
    }
    tmp.rotation.set(0, 0, 0);
    for (const m of [posts, boards, beams, braces]) m.current!.instanceMatrix.needsUpdate = true;
  }, [f]);
  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, counts.p]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0xf4f6fa} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={boards} args={[undefined, undefined, counts.b]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0xe9edf3} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={beams} args={[undefined, undefined, counts.bm]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0xffffff} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={braces} args={[undefined, undefined, counts.br]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0xf4f6fa} roughness={0.45} />
      </instancedMesh>
    </>
  );
}

/** 칸마다 진열한 낱개 상품(작은 상자 묶음) — 높이 = 칸 용량 대비 현물. 누르기는 Core.Picker(빈 칸 포함) */
function ShelfStock({ f }: { f: FloorLayout }) {
  const { backend, sim } = useApp();
  const ref = useRef<THREE.InstancedMesh>(null);
  const seen = useRef(-1);
  const at = useRef(0);
  const slotW = SHELF.unitLen / SHELF.slots;
  const maxH = (SHELF.height - 0.25) / SHELF.levels - 0.08;
  useFrame(({ clock }) => {
    // 원장이 바뀌어도 0.5초에 한 번만 다시 그린다 — 120배속에선 거의 매 프레임 바뀌어 칸 수천 개를 매번 다시 계산했다(성능)
    if (seen.current === backend.ledger.version || (seen.current >= 0 && clock.elapsedTime - at.current < 0.5)) return;
    seen.current = backend.ledger.version;
    at.current = clock.elapsedTime;
    const stock = sim.live('stock', 500, () => backend.ledger.onHandByLocation());
    const color = new THREE.Color();
    f.shelves.forEach((l, i) => {
      if (l.bin || l.lane) {
        // 오토스토어 칸·야채 레인 — 선반에 그리지 않음(각자 모형이 그림)
        tmp.scale.set(0, 0, 0);
        tmp.position.set(0, -10, 0);
        tmp.updateMatrix();
        ref.current!.setMatrixAt(i, tmp.matrix);
        return;
      }
      const q = stock.get(l.code) ?? 0;
      const h = q ? maxH * (0.25 + 0.75 * Math.min(1, q / l.capacity)) : 0;
      tmp.position.set(l.pos.x, l.pos.y + BOARD / 2 + h / 2, l.pos.z);
      tmp.scale.set(q ? SHELF.depth * 0.85 : 0, h, q ? slotW * 0.8 : 0);
      tmp.updateMatrix();
      ref.current!.setMatrixAt(i, tmp.matrix);
      // MFC 선반 상품 색: 상온 흰 상자, 저온은 구역 바닥색을 진하게 + 조금씩 다르게
      zoneBoxColor(l.temp, color);
      color.offsetHSL(0, 0, (((i * 13) % 7) - 3) / 120);
      ref.current!.setColorAt(i, color);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, f.shelves.length]} frustumCulled={false}>
      <boxGeometry />
      <meshStandardMaterial roughness={0.7} map={boxTexture()} />
    </instancedMesh>
  );
}

/** 선반 통로 번호판(예 C61) — 그 통로의 북쪽 끝 위. 전엔 층 첫 선반 블록의 북쪽 끝 하나로 둬서, 블록이 남북 둘인 5F 냉동 H·6F 냉장 G 는 두 블록 번호판이 한 줄에 겹쳤음(2026-11-26) */
function ShelfPlates({ f }: { f: FloorLayout }) {
  const view = useView();
  if (view.labelMode === 'off') return null;
  return (
    <>
      {f.shelfAisles.map((a) => (
        <sprite key={a.plate} position={[a.cx, SHELF.height + 0.6, (a.z0 ?? f.shelfRows[0]?.z0 ?? 0) - 0.3]} scale={[1.6, 0.8, 1]}>
          <spriteMaterial map={plateTexture(a.plate)} depthWrite={false} />
        </sprite>
      ))}
    </>
  );
}
