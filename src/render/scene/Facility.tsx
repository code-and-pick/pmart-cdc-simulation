// 고정 시설 — MFC 시뮬레이터 render/scene/Facility.tsx·ZoneNames.tsx 를 칠곡 DC 층에 맞게 옮김.
//  - 바닥: 건물 바깥 땅 + 층 바닥, 구역마다 불투명 바닥색(ZONE_FLOOR) + 흰 실선 경계(MFC "구역 나눠놓은게 잘 안보여. 하얀 실선으로")
//  - 벽: 높은 투명벽(건물 둘레·5F 냉동 방) — 투명도는 화면 상태(전체 0.32, 구역 확대 0.07 — MFC wallOpacity)
//  - 구역 카드: MFC 알약 판(아이콘 + 이름 + 둘째 말). 랙 구역은 북쪽 끝 랙 위에 세우고, 선반·띠·설비는 그 구역 북쪽에 세운다
//  - 빛: MFC Lights(반구광 + 해) — 그림자는 DC 가 넓어 끈다
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { plateTexture } from '../sprites';
import { useApp } from '../../app/context';
import { RACK } from '../../config';
import type { FloorLayout, Layout, Rect, ZoneArea, Door } from '../../domain/layout';
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
      <Walkways f={f} L={L} />
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

/**
 * 벽 — 건물 둘레 + 온도 방 경계(건물 안쪽 면). 온도 방 벽도 건물 벽과 같은 벽(높이·색·투명도)이고, 바깥쪽 경계는 건물 벽이 그대로 맡는다 —
 * 그래서 방 둘레 전체가 벽으로 닫힌다. "냉동 -20°C"/"냉장 3°C" 는 벽 위에(사용자 2026-11-25 "건물벽이랑 같은 벽, 표시는 벽 위에").
 * 문 자리는 비우고 문 모양만: 지게차 출입문(노란 문틀) · 박스·R/T 반출 에어커튼(투명 띠) · 냉동 전실 문(문틀).
 * 투명도는 controller.wallOpacity — 위 [벽 / 벽 숨김] 토글(MFC 와 같음).
 */
/** 문 높이(m) — 지게차 문 4.2, 사람·에어커튼 2.6 [가정] */
const doorTop = (k: Door['kind']) => (k === 'FORKLIFT' ? 4.2 : 2.6);

function Walls({ f, L }: { f: FloorLayout; L: Layout }) {
  const { controller } = useApp();
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  const groups = useRef<THREE.Object3D[]>([]);
  useFrame(() => {
    const o = controller.wallOpacity;
    for (const m of mats.current) {
      if (!m) continue;
      m.opacity = o; // 온도 방 벽도 건물 벽과 같은 투명도
      m.visible = o > 0.01;
    }
    for (const g of groups.current) if (g) g.visible = o > 0.01;
  });
  const t = 0.25;
  const { walls, doors, labels } = useMemo(() => {
    const walls: { r: Rect; cold: boolean; h: number; y0?: number }[] = [
      { r: { x0: -t, z0: -t, x1: L.width + t, z1: 0 }, cold: false, h: WALL_H },
      { r: { x0: -t, z0: L.depth, x1: L.width + t, z1: L.depth + t }, cold: false, h: WALL_H },
      { r: { x0: -t, z0: 0, x1: 0, z1: L.depth }, cold: false, h: WALL_H },
      { r: { x0: L.width, z0: 0, x1: L.width + t, z1: L.depth }, cold: false, h: WALL_H },
    ];
    const doors: { d: Door; h: number }[] = [];
    const labels: { text: string; x: number; z: number; temp: 'FROZEN' | 'CHILLED' }[] = [];
    for (const room of f.coldRooms) {
      const H = WALL_H; // 건물 벽과 같은 높이
      for (const s of room.walls) {
        // 문 자리를 비우고 벽 조각들로
        const along = s.z0 === s.z1 ? 'x' : 'z';
        const a0 = along === 'x' ? s.x0 : s.z0;
        const a1 = along === 'x' ? s.x1 : s.z1;
        const cuts = room.doors
          .filter((d) => (along === 'x' ? d.z0 === d.z1 && Math.abs(d.z0 - s.z0) < 0.01 : d.x0 === d.x1 && Math.abs(d.x0 - s.x0) < 0.01))
          .map((d) => (along === 'x' ? [d.x0, d.x1] : [d.z0, d.z1]) as [number, number])
          .filter(([c0, c1]) => c1 > a0 && c0 < a1)
          .sort((p, q) => p[0] - q[0]);
        let cur = a0;
        for (const [c0, c1] of [...cuts, [a1, a1] as [number, number]]) {
          if (c0 > cur + 0.05)
            walls.push({ r: along === 'x' ? { x0: cur, z0: s.z0 - t / 2, x1: c0, z1: s.z0 + t / 2 } : { x0: s.x0 - t / 2, z0: cur, x1: s.x0 + t / 2, z1: c0 }, cold: true, h: H });
          cur = Math.max(cur, c1);
        }
        // 문 위는 벽으로 막는다(문 높이까지만 뚫림)
        for (const d of room.doors) {
          const on = along === 'x' ? d.z0 === d.z1 && Math.abs(d.z0 - s.z0) < 0.01 : d.x0 === d.x1 && Math.abs(d.x0 - s.x0) < 0.01;
          const [c0, c1] = along === 'x' ? [d.x0, d.x1] : [d.z0, d.z1];
          if (!on || c1 <= a0 || c0 >= a1) continue;
          walls.push({ r: along === 'x' ? { x0: c0, z0: s.z0 - t / 2, x1: c1, z1: s.z0 + t / 2 } : { x0: s.x0 - t / 2, z0: c0, x1: s.x0 + t / 2, z1: c1 }, cold: true, h: H, y0: doorTop(d.kind) });
        }
        // 벽 위 온도 표시 — 긴 벽마다 하나(문이 가운데면 조금 비켜서)
        if (a1 - a0 > 8) labels.push({ text: room.label, x: along === 'x' ? (a0 + a1) / 2 : s.x0, z: along === 'x' ? s.z0 : (a0 + a1) / 2, temp: room.temp });
      }
      // 긴 벽이 없는 방도 표시 하나는 — 가장 긴 벽 위
      if (!labels.some((l) => l.text === room.label) && room.walls.length) {
        const w = [...room.walls].sort((a, b) => Math.hypot(b.x1 - b.x0, b.z1 - b.z0) - Math.hypot(a.x1 - a.x0, a.z1 - a.z0))[0];
        labels.push({ text: room.label, x: (w.x0 + w.x1) / 2, z: (w.z0 + w.z1) / 2, temp: room.temp });
      }
      for (const d of room.doors) doors.push({ d, h: H });
    }
    return { walls, doors, labels };
  }, [f, L]);
  let mi = 0;
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} position={[(w.r.x0 + w.r.x1) / 2, ((w.y0 ?? 0) + w.h) / 2, (w.r.z0 + w.r.z1) / 2]} raycast={() => null}>
          <boxGeometry args={[w.r.x1 - w.r.x0, w.h - (w.y0 ?? 0), w.r.z1 - w.r.z0]} />
          <meshStandardMaterial
            ref={(m: THREE.MeshStandardMaterial | null) => {
              if (m) {
                m.userData.cold = w.cold;
                mats.current[mi++] = m;
              }
            }}
            color={SCENE.wall}
            transparent
            opacity={0.32}
            roughness={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
      {doors.map(({ d }, i) => {
        const alongX = d.z0 === d.z1;
        const len = alongX ? d.x1 - d.x0 : d.z1 - d.z0;
        const cx = (d.x0 + d.x1) / 2;
        const cz = (d.z0 + d.z1) / 2;
        const color = d.kind === 'FORKLIFT' ? 0xf2c94c : d.kind === 'AIR_CURTAIN' ? 0x7fc4f5 : 0xb0bccc;
        return (
          <group
            key={`d${i}`}
            ref={(g) => {
              if (g) groups.current[i] = g;
            }}
          >
            {/* 문틀(양 기둥 + 윗틀) */}
            {[-1, 1].map((sgn) => (
              <mesh key={sgn} position={alongX ? [cx + (sgn * len) / 2, doorTop(d.kind) / 2, cz] : [cx, doorTop(d.kind) / 2, cz + (sgn * len) / 2]} raycast={() => null}>
                <boxGeometry args={[0.18, doorTop(d.kind), 0.18]} />
                <meshStandardMaterial color={color} />
              </mesh>
            ))}
            <mesh position={[cx, (d.kind === 'FORKLIFT' ? 4.2 : 2.6) + 0.1, cz]} raycast={() => null}>
              <boxGeometry args={alongX ? [len, 0.2, 0.25] : [0.25, 0.2, len]} />
              <meshStandardMaterial color={color} />
            </mesh>
            {d.kind === 'AIR_CURTAIN' && (
              // 에어커튼 — 늘어진 투명 띠
              <mesh position={[cx, 1.3, cz]} raycast={() => null}>
                <boxGeometry args={alongX ? [len * 0.96, 2.6, 0.04] : [0.04, 2.6, len * 0.96]} />
                <meshStandardMaterial color={0xbfe3ff} transparent opacity={0.35} depthWrite={false} />
              </mesh>
            )}
            <sprite position={[cx, (d.kind === 'FORKLIFT' ? 4.2 : 2.6) + 0.7, cz]} scale={[2.6, 0.62, 1]}>
              <spriteMaterial map={plateTexture(d.kind === 'FORKLIFT' ? '지게차 문' : d.kind === 'AIR_CURTAIN' ? '에어커튼 (박스·R/T)' : '냉동 전실 문', { w: 384, h: 92 })} depthWrite={false} />
            </sprite>
          </group>
        );
      })}
      {labels.map((l, i) => (
        <sprite
          key={`l${i}`}
          ref={(g) => {
            if (g) groups.current[doors.length + i] = g;
          }}
          position={[l.x, WALL_H + 0.9, l.z]}
          scale={[5.2, 1.3, 1]}
        >
          <spriteMaterial map={plateTexture(l.text, { bg: l.temp === 'FROZEN' ? '#2f6fd6' : '#2aa36b', fg: '#ffffff', w: 384, h: 96 })} depthWrite={false} />
        </sprite>
      ))}
    </>
  );
}

/**
 * 둥근 판 캔버스 → 텍스처(+ 가로세로 비) — MFC ZoneNames.makePill 그대로.
 * 아이콘은 흰 원 안, 이름 굵게 흰 글자, 둘째 말은 반투명 흰 작은 알약 안, 위쪽 반 광택.
 */
export function makePill(title: string, sub: string | null, icon: string | null, bg: string, top: string, fixedW = 0): { tex: THREE.CanvasTexture; aspect: number; naturalW: number } {
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
  const naturalW = Math.ceil(padL + (icon ? iconD + gap : 0) + wT + (sub ? gap + badgeW : 0) + padR);
  // 모든 카드 같은 크기(사용자 2026-11-25) — 넓이를 맞추고 내용은 가운데로
  const pw = Math.max(naturalW, Math.ceil(fixedW));
  const extra = (pw - naturalW) / 2;
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
  let x = x0 + padL + extra;
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
  return { tex, aspect: c.width / c.height, naturalW };
}

interface Card {
  id: string;
  tex: THREE.CanvasTexture;
  pos: [number, number, number];
  w: number;
  h: number;
}

/** 카드 높이(m)·세우는 높이 — 모든 구역 카드가 같은 크기·같은 높이(사용자 2026-11-25 "크기·높낮이 다 다름, 일직선으로") */
const CARD_H = 2.6;
const CARD_Y = RACK_TOP + 0.4 + CARD_H / 2;
/** 설비 줄은 랙 줄 바로 위 한 줄 — 두 줄 모두 곧은 줄(같은 높이끼리) */
const CARD_Y_BAND = CARD_Y + CARD_H + 0.5;
const CARD_GAP = 0.5;

/** 괄호 설명 중 첫 구절만 짧게 — "생활용품 — 박스째 → …" → "생활용품" */
function shortSub(s: string | null): string | null {
  if (!s) return null;
  const t = s.split(/\s[—–-]\s|·|,/)[0].trim();
  return t.length > 14 ? t.slice(0, 13) + '…' : t;
}

/**
 * 구역 카드 — 두 줄: 랙 구역은 랙 북쪽 끝 한 줄, 그 밖(설비·피킹 선반·승강기·출고대기)은 그 위(작업장 남쪽 끝) 한 줄. 높이·크기는 모두 같고, 겹치면 옆으로 민다.
 * 이름은 짧게(괄호 설명은 둘째 말로 한 구절만).
 */
export function zoneCards(f: FloorLayout): Card[] {
  type Spec = { id: string; title: string; sub: string | null; style: FloorKey; x: number; row: 'rack' | 'band' };
  const specs: Spec[] = [];
  for (const z of f.zones) {
    const r = z.rect;
    const cx = (r.x0 + r.x1) / 2;
    const style = zoneStyle(z);
    const m = /^(.*?)\s*\((.*)\)$/.exec(z.label);
    if (z.kind === 'RACK') {
      const letter = z.id.split('-')[1];
      specs.push({ id: z.id, title: m ? m[1] : z.label, sub: `${f.locations.filter((l) => l.zone === letter).length.toLocaleString()}칸`, style, x: cx, row: 'rack' });
    } else if (z.kind === 'EQUIP') {
      if (z.id.endsWith('AUTOSTORE')) {
        const bins = Math.max(0, ...f.shelves.filter((l) => l.bin).map((l) => l.binNo ?? 0));
        specs.push({ id: z.id, title: '오토스토어', sub: `통 ${bins.toLocaleString()}`, style, x: cx, row: 'band' });
      } else specs.push({ id: z.id, title: m ? m[1] : z.label, sub: shortSub(m ? m[2] : null), style, x: cx, row: 'band' });
    }
  }
  const shelves = f.zones.filter((z) => z.kind === 'SHELF');
  if (shelves.length) {
    const x0 = Math.min(...shelves.map((z) => z.rect.x0));
    const x1 = Math.max(...shelves.map((z) => z.rect.x1));
    const cold = shelves.every((z) => z.temp === shelves[0].temp) ? zoneStyle(shelves[0]) : 'AMBIENT';
    specs.push({ id: `${f.floor}-SHELVES`, title: '피킹 선반', sub: `${f.shelves.filter((l) => !l.bin).length.toLocaleString()}칸`, style: cold, x: (x0 + x1) / 2, row: 'band' });
  }
  const band = f.zones.find((z) => z.kind === 'BAND');
  if (band) {
    const xEnd = Math.max(...f.staging.map((s) => s.pos.x)) + 1;
    specs.push({ id: band.id, title: '승강기 · 출고대기', sub: `R/T ${f.staging.length}자리`, style: 'BAND', x: xEnd / 2, row: 'band' });
  }
  // 같은 넓이: 가장 넓은 카드에 맞춘다
  const natural = specs.map((sp) => makePill(sp.title, sp.sub, ICON[sp.style], ZONE_PILL[sp.style][0], ZONE_PILL[sp.style][1]));
  const maxW = Math.max(...natural.map((n) => n.naturalW));
  for (const n of natural) n.tex.dispose();
  const out: Card[] = [];
  const rackZ = Math.min(...f.rows.map((w) => w.z0)) - 0.6;
  const width = Math.max(...f.zones.map((z) => z.rect.x1));
  for (const row of ['rack', 'band'] as const) {
    const list = specs.filter((sp) => sp.row === row).sort((p, q) => p.x - q.x);
    const made = list.map((sp) => ({ sp, ...makePill(sp.title, sp.sub, ICON[sp.style], ZONE_PILL[sp.style][0], ZONE_PILL[sp.style][1], maxW) }));
    const w = CARD_H * (made[0]?.aspect ?? 1);
    // 겹치지 않게 왼쪽부터 밀고, 오른쪽 벽을 넘으면 줄 전체를 왼쪽으로
    const xs: number[] = [];
    for (const m of made) xs.push(Math.max(m.sp.x, xs.length ? xs[xs.length - 1] + w + CARD_GAP : -Infinity));
    const over = xs.length ? xs[xs.length - 1] + w / 2 - width : 0;
    if (over > 0) for (let i = xs.length - 1; i >= 0; i--) xs[i] = Math.min(xs[i] - over, i < xs.length - 1 ? xs[i + 1] - w - CARD_GAP : Infinity);
    made.forEach((m, i) => out.push({ id: m.sp.id, tex: m.tex, pos: [xs[i], row === 'rack' ? CARD_Y : CARD_Y_BAND, row === 'rack' ? rackZ : f.walk.roomZ], w, h: CARD_H }));
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

/**
 * 걷는 길 표시 — MFC Decor.Walkways 와 같은 모양(흰 점선 + 화살표). 사람·카트·지게차가 실제로 다니는 통로망(WalkNet)을 그린다:
 * 북쪽 통로(승강기·출고대기 ↔ 선반·설비) · 랙 앞 가로 통로 · 서쪽 벽 연결 통로.
 */
export function Walkways({ f, L }: { f: FloorLayout; L: Layout }) {
  const dashes = useRef<THREE.InstancedMesh>(null!);
  const arrows = useRef<THREE.InstancedMesh>(null!);
  const { segs, heads } = useMemo(() => {
    const { northZ, roomZ, rackZ, westX } = f.walk;
    const lines: [number, number, number, number][] = [
      [westX, northZ, L.width - 1, northZ],
      [westX, roomZ, L.width - 1, roomZ],
      [westX, rackZ, L.width - 1, rackZ],
      [westX, northZ, westX, rackZ],
    ];
    const segs: { x: number; z: number; len: number; alongX: boolean }[] = [];
    const heads: { x: number; z: number; rot: number }[] = [];
    for (const [x0, z0, x1, z1] of lines) {
      const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      for (let a = a0; a < a1; a += 0.9) {
        const len = Math.min(0.5, a1 - a);
        segs.push(alongX ? { x: a + len / 2, z: z0, len, alongX } : { x: x0, z: a + len / 2, len, alongX });
      }
      for (let a = a0 + 2.2; a < a1 - 1; a += 5.4) heads.push(alongX ? { x: a, z: z0 + 0.45, rot: 0 } : { x: x0 + 0.45, z: a, rot: Math.PI / 2 });
    }
    return { segs, heads };
  }, [f, L]);
  const tri = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.28, 0);
    s.lineTo(-0.18, 0.2);
    s.lineTo(-0.08, 0);
    s.lineTo(-0.18, -0.2);
    s.closePath();
    return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    segs.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0.02, s.z), q, s.alongX ? new THREE.Vector3(s.len, 0.004, 0.1) : new THREE.Vector3(0.1, 0.004, s.len));
      dashes.current.setMatrixAt(i, m);
    });
    heads.forEach((h, i) => {
      m.compose(new THREE.Vector3(h.x, 0.022, h.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h.rot), new THREE.Vector3(1.4, 1, 1.4));
      arrows.current.setMatrixAt(i, m);
    });
    dashes.current.instanceMatrix.needsUpdate = true;
    arrows.current.instanceMatrix.needsUpdate = true;
  }, [segs, heads]);
  return (
    <>
      <instancedMesh ref={dashes} args={[undefined, undefined, segs.length]} raycast={() => null} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={0xffffff} />
      </instancedMesh>
      <instancedMesh ref={arrows} args={[tri, undefined, heads.length]} raycast={() => null} frustumCulled={false}>
        <meshBasicMaterial color={0xffffff} side={THREE.DoubleSide} />
      </instancedMesh>
    </>
  );
}
