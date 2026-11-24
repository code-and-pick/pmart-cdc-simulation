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
  g.font = `700 ${Math.floor(h * 0.62)}px 'Noto Sans KR', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
