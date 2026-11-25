// 글자 판 텍스처(랙 번호판·구역 이름표). 같은 글자는 한 번만 만든다.
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

/** 흰 판에 검은 글자 — 사진의 랙 끝 번호판(A10, A11 …) 모양 */
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
  g.fillStyle = opts.bg ?? '#ffffff';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#22262e';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = opts.fg ?? '#111318';
  // 줄바꿈(\n)이 있으면 여러 줄로
  const lines = text.split('\n');
  const lh = h / lines.length;
  g.font = `700 ${Math.floor(lh * 0.62)}px 'Noto Sans KR', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((ln, i) => g.fillText(ln, w / 2, lh * (i + 0.5) + 2, w - 12));
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
