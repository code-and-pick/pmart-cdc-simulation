// 고정 시설 — MFC 시뮬레이터 render/scene/Facility.tsx·ZoneNames.tsx 를 칠곡 DC 층에 맞게 옮김.
//  - 바닥: 건물 바깥 땅 + 층 바닥, 구역마다 불투명 바닥색(ZONE_FLOOR) + 흰 실선 경계(MFC "구역 나눠놓은게 잘 안보여. 하얀 실선으로")
//  - 벽: 높은 투명벽(건물 둘레·5F 냉동 방) — 투명도는 화면 상태(전체 0.32, 구역 확대 0.07 — MFC wallOpacity)
//  - 구역 카드: MFC 알약 판(아이콘 + 이름 + 둘째 말). 랙 구역은 북쪽 끝 랙 위에 세우고, 선반·띠·설비는 그 구역 북쪽에 세운다
//  - 빛: MFC Lights(반구광 + 해) — 그림자는 DC 가 넓어 끈다
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../app/context';
import { RACK, SHELF } from '../../config';
import type { FloorLayout, Layout, Rect, ZoneArea } from '../../domain/layout';
import { SCENE, ZONE_FLOOR, ZONE_PILL } from '../colors';

/** 층 높이(벽) [가정] — 랙 6m + 맨 위 짐 2m 위로 */
const WALL_H = 10;
/** 랙 맨 위 짐 높이(카드를 그 위에) */
const RACK_TOP = (RACK.levels - 1) * RACK.levelH + RACK.levelH * 0.9;

type FloorKey = keyof typeof ZONE_FLOOR;

/** 구역의 바닥·카드 색 갈래 */
export function zoneStyle(z: ZoneArea): FloorKey {
  if (z.kind === 'BAND') return 'BAND';
  if (z.kind === 'EQUIP') return 'EQUIP';
  if (z.temp === 'FROZEN') return 'FROZEN';
  if (z.temp === 'CHILLED') return 'CHILLED';
  return z.kind === 'RACK' ? 'AMBIENT_STORE' : 'AMBIENT';
}

const ICON: Record<FloorKey, string> = { FROZEN: '❄', CHILLED: '🌡', AMBIENT: '🛒', AMBIENT_STORE: '📦', BAND: '🚚', EQUIP: '⚙' };

export function Lights() {
  return (
    <>
      {/* MFC Lights 와 같은 세기 — 밝은 바닥·벽이 하얗게 날지 않게 */}
      <hemisphereLight args={[0xffffff, 0xd9dce6, 1.25]} />
      <directionalLight color={0xffffff} intensity={1.3} position={[60, 90, 40]} />
    </>
  );
}

export function Facility({ f, L }: { f: FloorLayout; L: Layout }) {
  return (
    <>
      <Ground L={L} />
      <Zones f={f} />
      <Walls f={f} L={L} />
      <ZoneCards f={f} />
    </>
  );
}

function Ground({ L }: { L: Layout }) {
  const flat: [number, number, number] = [-Math.PI / 2, 0, 0];
  return (
    <>
      <mesh rotation={flat} position={[L.width / 2, -0.03, L.depth / 2]}>
        <planeGeometry args={[L.width + 160, L.depth + 160]} />
        <meshStandardMaterial color={SCENE.outside} roughness={1} />
      </mesh>
      <mesh rotation={flat} position={[L.width / 2, -0.01, L.depth / 2]}>
        <planeGeometry args={[L.width, L.depth]} />
        <meshStandardMaterial color={SCENE.floor} roughness={0.95} />
      </mesh>
    </>
  );
}

/** 바닥 흰 실선 사각형(구역 경계) — MFC SolidRect */
function SolidRect({ r, width, y }: { r: Rect; width: number; y: number }) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const sides: [number, number, number, number][] = [
    [r.x0 + w / 2, r.z0, w + width, width],
    [r.x0 + w / 2, r.z1, w + width, width],
    [r.x0, r.z0 + d / 2, width, d],
    [r.x1, r.z0 + d / 2, width, d],
  ];
  return (
    <>
      {sides.map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, y + 0.004, z]}>
          <boxGeometry args={[sx, 0.004, sz]} />
          <meshBasicMaterial color={0xffffff} />
        </mesh>
      ))}
    </>
  );
}

function Zones({ f }: { f: FloorLayout }) {
  // 띠(바탕) → 랙 → 선반·설비 순으로 살짝씩 위에(겹치는 자리는 위 구역 색)
  const order = { BAND: 0, RACK: 1, SHELF: 2, EQUIP: 2 } as const;
  const zones = [...f.zones].sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <>
      {zones.map((z) => {
        const r = z.rect;
        const w = r.x1 - r.x0;
        const d = r.z1 - r.z0;
        const y = 0.004 + order[z.kind] * 0.003;
        return (
          <group key={z.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[r.x0 + w / 2, y, r.z0 + d / 2]}>
              <planeGeometry args={[w, d]} />
              <meshStandardMaterial color={ZONE_FLOOR[zoneStyle(z)]} roughness={0.95} />
            </mesh>
            <SolidRect r={{ x0: r.x0 + 0.15, z0: r.z0 + 0.15, x1: r.x1 - 0.15, z1: r.z1 - 0.15 }} width={z.kind === 'RACK' ? 0.22 : 0.16} y={y} />
          </group>
        );
      })}
    </>
  );
}

/** 높은 투명벽 — 건물 둘레 + 5F 냉동 방(랙 구역 둘레). 투명도는 controller.wallOpacity */
function Walls({ f, L }: { f: FloorLayout; L: Layout }) {
  const { controller } = useApp();
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  useFrame(() => {
    const o = controller.wallOpacity;
    for (const m of mats.current) {
      if (!m) continue;
      m.opacity = o;
      m.visible = o > 0.01;
    }
  });
  const t = 0.25;
  const walls = useMemo(() => {
    const out: { r: Rect; glass: boolean }[] = [
      { r: { x0: -t, z0: -t, x1: L.width + t, z1: 0 }, glass: false },
      { r: { x0: -t, z0: L.depth, x1: L.width + t, z1: L.depth + t }, glass: false },
      { r: { x0: -t, z0: 0, x1: 0, z1: L.depth }, glass: false },
      { r: { x0: L.width, z0: 0, x1: L.width + t, z1: L.depth }, glass: false },
    ];
    // 냉동 방 — 5F 냉동 랙 구역 둘레(남쪽은 바깥벽). 유리처럼 옅게
    for (const z of f.zones.filter((x) => x.kind === 'RACK' && x.temp === 'FROZEN')) {
      const r = z.rect;
      out.push({ r: { x0: r.x0 - t / 2, z0: r.z0, x1: r.x0 + t / 2, z1: r.z1 }, glass: true });
      out.push({ r: { x0: r.x1 - t / 2, z0: r.z0, x1: r.x1 + t / 2, z1: r.z1 }, glass: true });
      out.push({ r: { x0: r.x0, z0: r.z0 - t / 2, x1: r.x1, z1: r.z0 + t / 2 }, glass: true });
    }
    return out;
  }, [f, L]);
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} position={[(w.r.x0 + w.r.x1) / 2, WALL_H / 2, (w.r.z0 + w.r.z1) / 2]} raycast={() => null}>
          <boxGeometry args={[w.r.x1 - w.r.x0, WALL_H, w.r.z1 - w.r.z0]} />
          <meshStandardMaterial
            ref={(m: THREE.MeshStandardMaterial | null) => {
              if (m) mats.current[i] = m;
            }}
            color={w.glass ? 0xd2e4fa : SCENE.wall}
            transparent
            opacity={0.32}
            roughness={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * 둥근 판 캔버스 → 텍스처(+ 가로세로 비) — MFC ZoneNames.makePill 그대로.
 * 아이콘은 흰 원 안, 이름 굵게 흰 글자, 둘째 말은 반투명 흰 작은 알약 안, 위쪽 반 광택.
 */
export function makePill(title: string, sub: string | null, icon: string | null, bg: string, top: string): { tex: THREE.CanvasTexture; aspect: number } {
  const S = 64;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const fT = `900 ${S}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fS = `700 ${Math.round(S * 0.5)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const fI = `${Math.round(S * 0.62)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.font = fT;
  const wT = ctx.measureText(title).width;
  ctx.font = fS;
  const wS = sub ? ctx.measureText(sub).width : 0;
  const ph = Math.ceil(S * 1.6);
  const iconD = ph - S * 0.36;
  const padL = icon ? S * 0.18 : S * 0.6;
  const padR = S * 0.5;
  const badgeW = sub ? wS + S * 0.6 : 0;
  const gap = S * 0.3;
  const M = S * 0.4;
  const pw = Math.ceil(padL + (icon ? iconD + gap : 0) + wT + (sub ? gap + badgeW : 0) + padR);
  c.width = Math.ceil(pw + M * 2);
  c.height = Math.ceil(ph + M * 2);
  const x0 = M;
  const y0 = M * 0.5;
  const r = ph / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(20,24,60,0.32)';
  ctx.shadowBlur = S * 0.35;
  ctx.shadowOffsetY = S * 0.12;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x0, y0, pw, ph, r);
  ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
  g.addColorStop(0, top);
  g.addColorStop(1, bg);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x0, y0, pw, ph, r);
  ctx.fill();
  const gl = ctx.createLinearGradient(0, y0, 0, y0 + ph * 0.55);
  gl.addColorStop(0, 'rgba(255,255,255,0.28)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.roundRect(x0 + 3, y0 + 3, pw - 6, ph * 0.55, [r - 3, r - 3, 0, 0]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x0 + 1.5, y0 + 1.5, pw - 3, ph - 3, r);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  const cy = y0 + ph / 2;
  let x = x0 + padL;
  if (icon) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + iconD / 2, cy, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = fI;
    ctx.textAlign = 'center';
    ctx.fillText(icon, x + iconD / 2, cy + 3);
    ctx.textAlign = 'left';
    x += iconD + gap;
  }
  ctx.font = fT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, x, cy + 3);
  x += wT + gap;
  if (sub) {
    const bh = S * 0.78;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.roundRect(x, cy - bh / 2, badgeW, bh, bh / 2);
    ctx.fill();
    ctx.font = fS;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sub, x + S * 0.3, cy + 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

interface Card {
  id: string;
  tex: THREE.CanvasTexture;
  pos: [number, number, number];
  w: number;
  h: number;
}

/** 판 하나 만들기 — 높이 h 로, 넓이가 room 을 넘으면 줄인다 */
function card(id: string, title: string, sub: string | null, style: FloorKey, x: number, y: number, z: number, h: number, room: number): Card {
  const [bg, top] = ZONE_PILL[style];
  const { tex, aspect } = makePill(title, sub, ICON[style], bg, top);
  let w = h * aspect;
  if (w > room) {
    w = room;
    h = w / aspect;
  }
  return { id, tex, pos: [x, y + h / 2, z], w, h };
}

/**
 * 구역 카드 내용·자리 — 이름은 짧게(괄호 설명은 둘째 말로), 전체 보기에서 읽히게 크게(MFC 냉동·냉장·상온 큰 카드 2.35 m 처럼, DC 는 랙이 8 m 라 더 크게).
 * 랙 구역: 그 구역 북쪽 끝 랙 위. 피킹 선반: 선반 구역 전체에 카드 하나(통로마다 C61 같은 번호판이 따로 있다). 띠·설비: 북쪽에 세움.
 */
export function zoneCards(f: FloorLayout): Card[] {
  const out: Card[] = [];
  for (const z of f.zones) {
    const r = z.rect;
    const cx = (r.x0 + r.x1) / 2;
    const style = zoneStyle(z);
    if (z.kind === 'RACK') {
      const letter = z.id.split('-')[1];
      const aisles = f.aisles.filter((a) => a.zone === letter).length;
      const m = /^(.*?)\s*\((.*)\)$/.exec(z.label);
      const title = m ? m[1] : z.label;
      const note = m ? `${m[2]} · ` : '';
      out.push(card(z.id, title, `${note}통로 ${aisles} · ${(aisles * RACK.baysPerSide * 2 * RACK.levels * RACK.slots).toLocaleString()}칸`, style, cx, RACK_TOP + 0.4, r.z0 + 0.3, 3.4, (r.x1 - r.x0) * 0.96));
    } else if (z.kind === 'EQUIP') {
      const m = /^(.*?)\s*\((.*)\)$/.exec(z.label);
      out.push(card(z.id, m ? m[1] : z.label, m ? m[2] : null, style, cx, 2.6, r.z0 + 0.3, 2.6, (r.x1 - r.x0) * 0.96));
    }
  }
  // 피킹 선반 — 선반 구역 전체에 하나
  const shelves = f.zones.filter((z) => z.kind === 'SHELF');
  if (shelves.length) {
    const x0 = Math.min(...shelves.map((z) => z.rect.x0));
    const x1 = Math.max(...shelves.map((z) => z.rect.x1));
    const letters = [...new Set(f.shelfAisles.map((a) => a.zone))].join('·');
    const cold = shelves.every((z) => z.temp === shelves[0].temp) ? zoneStyle(shelves[0]) : 'AMBIENT';
    out.push(card(`${f.floor}-SHELVES`, '피킹 선반', `${letters} · ${f.shelves.length.toLocaleString()}칸`, cold, (x0 + x1) / 2, SHELF.height + 0.3, shelves[0].rect.z0 + 0.2, 2.2, Math.max(x1 - x0, 14)));
  }
  // 승강기·출고대기 — 북쪽 벽 위, 승강기·출고대기 줄 가운데
  const band = f.zones.find((z) => z.kind === 'BAND');
  if (band) {
    const xEnd = Math.max(...f.staging.map((s) => s.pos.x)) + 1;
    out.push(card(band.id, '승강기 · 출고대기', `승강기 ${f.lifts.length} · R/T ${f.staging.length}자리`, 'BAND', xEnd / 2, 4.6, 0.15, 2.6, xEnd));
  }
  return out;
}

function ZoneCards({ f }: { f: FloorLayout }) {
  const cards = useMemo(() => zoneCards(f), [f]);
  return (
    <>
      {cards.map((t) => (
        <mesh key={t.id} position={t.pos} renderOrder={5} raycast={() => null}>
          <planeGeometry args={[t.w, t.h]} />
          <meshBasicMaterial map={t.tex} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}
