// 글자 판 텍스처(랙 번호판·구역 이름표). 같은 글자는 한 번만 만든다.
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

/** 둥근 사각형 경로 */
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 글자가 폭에 들어가게 글꼴 크기를 줄인다 */
function fitFont(g: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number): number {
  let px = size;
  for (; px > 8; px -= 1) {
    g.font = `${weight} ${px}px 'Noto Sans KR', 'Pretendard', sans-serif`;
    if (g.measureText(text).width <= maxW) break;
  }
  return px;
}

/**
 * 이름판 — 흰 둥근 카드(옅은 그림자·가는 테두리), 첫 줄 굵게·둘째 줄부터 작고 옅게(사용자 2026-11-25 "하양 좋은데 모양이 못생겼어").
 * 랙 통로 번호판(A01…)·선반 번호·PPC·문 이름·설비 정보판이 같이 쓴다. 색 판(bg)도 같은 모양.
 */
export function plateTexture(text: string, opts: { bg?: string; fg?: string; w?: number; h?: number } = {}): THREE.CanvasTexture {
  const key = `${text}|${opts.bg}|${opts.fg}|${opts.w}|${opts.h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = opts.w ?? 256;
  const h = opts.h ?? 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = opts.bg ?? '#ffffff';
  const white = bg.toLowerCase() === '#ffffff';
  const m = Math.max(3, Math.round(h * 0.06));
  const r = Math.min(h * 0.24, 22);
  g.save();
  g.shadowColor = 'rgba(15, 23, 42, 0.28)';
  g.shadowBlur = m * 1.4;
  g.shadowOffsetY = m * 0.4;
  roundRect(g, m, m, w - 2 * m, h - 2 * m - m * 0.4, r);
  g.fillStyle = bg;
  g.fill();
  g.restore();
  if (white) {
    g.lineWidth = Math.max(1.5, h * 0.018);
    g.strokeStyle = 'rgba(15, 23, 42, 0.14)';
    roundRect(g, m, m, w - 2 * m, h - 2 * m - m * 0.4, r);
    g.stroke();
  }
  const lines = text.split('\n');
  const innerW = w - 2 * m - r;
  const top = m;
  const avail = h - 2 * m - m * 0.4;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (lines.length === 1) {
    g.fillStyle = opts.fg ?? '#1f2937';
    fitFont(g, lines[0], 800, Math.floor(avail * 0.62), innerW);
    g.fillText(lines[0], w / 2, top + avail / 2 + 1);
  } else {
    // 제목 줄 크게, 나머지 작게
    const unit = avail / (1.35 + (lines.length - 1) * 0.95);
    let y = top + unit * 0.7;
    lines.forEach((ln, k) => {
      const big = k === 0;
      g.fillStyle = big ? (opts.fg ?? '#1f2937') : white ? '#64748b' : 'rgba(255,255,255,0.86)';
      fitFont(g, ln, big ? 800 : 600, Math.floor(unit * (big ? 0.92 : 0.66)), innerW);
      g.fillText(ln, w / 2, y + 1);
      y += big ? unit * 1.15 : unit * 0.95;
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

// ── 아래 두 무늬는 MFC 시뮬레이터 src/render/sprites.ts 그대로(2026-11-25 사용자 "박스 모형 MFC 와 동일하게") ──
let boxTex: THREE.CanvasTexture | null = null;
/**
 * 골판지 상자 무늬(사용자 2026-11-20 참고 그림 — 상자 디자인도 그림처럼): 가운데 테이프 띠·작은 흰 라벨·모서리 선.
 * 회색조 무늬라 인스턴스 색(갈색 골판지·냉장 흰 상자)과 곱해져 같은 무늬로 보인다. 모든 상자가 하나를 같이 쓴다.
 */
export function boxTexture(): THREE.CanvasTexture {
  if (boxTex) return boxTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 0, n, n);
  // 위쪽이 조금 밝게(빛)
  const sh = g.createLinearGradient(0, 0, 0, n);
  sh.addColorStop(0, 'rgba(255,255,255,0.18)');
  sh.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = sh;
  g.fillRect(0, 0, n, n);
  // 테이프 띠(가운데 세로)
  g.fillStyle = '#bdbdbd';
  g.fillRect(n * 0.43, 0, n * 0.14, n);
  // 라벨(왼쪽 아래 흰 사각)
  g.fillStyle = '#ffffff';
  g.fillRect(n * 0.12, n * 0.58, n * 0.22, n * 0.18);
  g.strokeStyle = '#cfcfcf';
  g.lineWidth = 2;
  g.strokeRect(n * 0.12, n * 0.58, n * 0.22, n * 0.18);
  // 모서리 선
  g.strokeStyle = '#a9a9a9';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, n - 3, n - 3);
  boxTex = new THREE.CanvasTexture(c);
  boxTex.colorSpace = THREE.SRGBColorSpace;
  boxTex.anisotropy = 4;
  return boxTex;
}


let palletTex: THREE.CanvasTexture | null = null;
/** 나무 팔레트 무늬 — 판자 사이 틈(어두운 줄). 회색조라 팔레트 색과 곱해진다 */
export function palletTexture(): THREE.CanvasTexture {
  if (palletTex) return palletTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#9a9a9a';
  for (let i = 1; i < 5; i++) g.fillRect((i * n) / 5 - 2, 0, 4, n);
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, n - 3, n - 3);
  palletTex = new THREE.CanvasTexture(c);
  palletTex.colorSpace = THREE.SRGBColorSpace;
  return palletTex;
}
