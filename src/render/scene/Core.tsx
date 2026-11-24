// 장면의 바탕 동작 — MFC 시뮬레이터 render/scene/Core.tsx·render/locationLabels.ts 를 칠곡 DC 에 맞게 옮김.
//  - 카메라: 지도처럼 왼쪽 끌기 = 바닥 따라 이동, 오른쪽 끌기 = 천천히 돌리기, 휠 = 마우스가 가리킨 곳으로 확대, 화살표·WASD = 이동, Esc = 나가기
//  - 클릭 판정(누른 뒤 6px 안에서 뗌): 사람 → 랙·선반 칸(빈 칸 포함, 통로 쪽 앞면 먼저) → 구역 바닥
//    칸: 멀면 그 구역 위에서, 가까우면 그 칸 정면(맞은편 랙은 근접 클리핑) + 왼쪽 칸 카드(위치 코드·재고)
//  - 칸 번호: 가까이 확대하면(보는 점에서 26 m 안) 화면에 보이는 칸 중 카메라 가까운 칸부터 빔 앞에 위치 코드
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useApp } from '../../app/context';
import { RACK, SHELF } from '../../config';
import type { Location } from '../../domain/layout';
import { beamY } from '../rackGeom';

/** 카메라가 보는 점에서 이 거리(m) 안이면 칸 번호를 붙인다 [시뮬 — MFC 26 m] */
const SLOT_LABEL_DIST = 26;
const shelfLevelH = (SHELF.height - 0.25) / SHELF.levels;

/** 칸 상자(클릭 판정) — 팔레트 칸은 그 단 높이 2m·폭 1.3m, 선반 칸은 단 높이·폭 1/3 유닛 */
function cellBox(l: Location, box: THREE.Box3) {
  if (l.type === 'PICK_FACE') {
    const hw = SHELF.unitLen / SHELF.slots / 2;
    box.min.set(l.pos.x - SHELF.depth / 2, l.pos.y - 0.02, l.pos.z - hw);
    box.max.set(l.pos.x + SHELF.depth / 2, l.pos.y + shelfLevelH, l.pos.z + hw);
  } else {
    const hw = RACK.bayW / RACK.slots / 2;
    const y0 = l.level === 1 ? 0 : beamY(l.level);
    box.min.set(l.pos.x - RACK.depth / 2, y0, l.pos.z - hw);
    box.max.set(l.pos.x + RACK.depth / 2, y0 + RACK.levelH, l.pos.z + hw);
  }
  return box;
}

export function CameraRig() {
  const { controller } = useApp();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    // MFC 와 같음(사용자 2026-11-20 MFC 결정): 왼쪽 끌기 = 이동, 오른쪽 = 돌리기, 휠 = 커서 쪽으로 확대
    c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.screenSpacePanning = false;
    c.enableDamping = true;
    c.dampingFactor = 0.15;
    c.rotateSpeed = 0.35;
    c.panSpeed = 1.1;
    c.zoomSpeed = 2.6;
    c.zoomToCursor = true;
    c.minPolarAngle = Math.PI * 0.12;
    c.maxPolarAngle = Math.PI * 0.47;
    c.minDistance = 1.2;
    // DC 층은 120 × 79 m — MFC(130)보다 넓게
    c.maxDistance = 220;
    c.keyPanSpeed = 24;
    c.listenToKeyEvents(window);
    c.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
    return c;
  }, [camera, gl]);
  useEffect(() => {
    controller.cameraNow = () => ({ pos: camera.position.clone(), target: controls.target.clone() });
    const el = gl.domElement;
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('contextmenu', menu);
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        controller.backOut();
        return;
      }
      const map: Record<string, string> = { w: 'ArrowUp', a: 'ArrowLeft', s: 'ArrowDown', d: 'ArrowRight' };
      const k = map[e.key.toLowerCase()];
      if (k) window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k }));
    };
    window.addEventListener('keydown', keys);
    return () => {
      controls.dispose();
      controller.cameraNow = null;
      el.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', keys);
    };
  }, [controls, controller, camera, gl]);

  const tween = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null>(null);
  useFrame((_, dt) => {
    const req = controller.takeCameraRequest();
    if (req) {
      if (!req.animate) {
        camera.position.copy(req.pos);
        controls.target.copy(req.target);
        tween.current = null;
      } else tween.current = { from: camera.position.clone(), to: req.pos, tFrom: controls.target.clone(), tTo: req.target, t: 0 };
    }
    const tw = tween.current;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / 0.8);
      const k = 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.from, tw.to, k);
      controls.target.lerpVectors(tw.tFrom, tw.tTo, k);
      if (tw.t >= 1) tween.current = null;
    }
    controls.update();
    // 칸 정면 보기에서만 맞은편 랙을 잘라 낸다 — 사용자가 크게 물러나거나 다가가면 푼다
    const d = camera.position.distanceTo(controls.target);
    const near = controller.nearCut > 0 && d > controller.nearCut * 0.6 && d < controller.nearCut * 3.5 ? controller.nearCut : 0.1;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/** 클릭 판정 — react-three-fiber 포인터 이벤트 대신 직접 레이캐스트(우선순위: 사람 → 칸 → 구역 바닥) */
export function Picker() {
  const { controller } = useApp();
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    let down: { x: number; y: number } | null = null;
    const pick = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      // 1) 사람
      const people = [...controller.people.entries()].filter(([, o]) => o.visible);
      const hp = ray.intersectObjects(people.map(([, o]) => o), true)[0];
      if (hp) {
        for (let o: THREE.Object3D | null = hp.object; o; o = o.parent) {
          const id = people.find(([, g]) => g === o)?.[0];
          if (id) {
            controller.selectWorker(id);
            return;
          }
        }
      }
      const f = controller.floorLayout();
      if (!f) return;
      // 2) 칸 — 통로 쪽 앞면이 카메라를 보는 칸 먼저, 없으면(위에서 내려다볼 때 등) 앞뒤 가리지 않고
      const cells = [...f.shelves, ...f.locations];
      let best: { loc: Location; d: number } | null = null;
      for (const anyFace of [false, true]) {
        if (best) break;
        for (const l of cells) {
          if (!anyFace && (camera.position.x - l.pos.x) * (l.face ?? 1) <= 0) continue;
          if (!ray.ray.intersectBox(cellBox(l, box), hit)) continue;
          const d = hit.distanceTo(ray.ray.origin);
          if (d < camera.near || (best && d >= best.d)) continue;
          best = { loc: l, d };
        }
      }
      const now = controller.cameraNow?.();
      if (best) {
        controller.clickCell(best.loc, now ? now.pos.distanceTo(now.target) : 999);
        return;
      }
      // 3) 구역 바닥 → 그 구역으로, 이미 들어온 구역·밖이면 나가기
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
        const v = controller.zoneViews().find((z) => z.key !== 'ALL' && hit.x >= z.rect.x0 && hit.x <= z.rect.x1 && hit.z >= z.rect.z0 && hit.z <= z.rect.z1);
        if (v && v.key !== controller.focusedZone && !controller.selected) {
          controller.focusZone(v.key);
          return;
        }
      }
      controller.backOut();
    };
    const onDown = (e: PointerEvent) => (down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null);
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 6) pick(e);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, controller]);
  return null;
}

/** 칸 번호판 그리기 — MFC drawTag('slot'): 흰 판에 남색 글자 + 왼쪽 파란 띠 */
function drawSlotTag(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, h * 0.18);
  ctx.fill();
  ctx.strokeStyle = '#c9d6ee';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#1f6fe8';
  ctx.fillRect(1, 1, h * 0.22, h - 2);
  ctx.fillStyle = '#16255c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const left = h * 0.22;
  let size = Math.floor(h * 0.62);
  ctx.font = `800 ${size}px "Noto Sans KR", "Malgun Gothic", monospace`;
  while (ctx.measureText(text).width > w - 14 - left && size > 8) {
    size -= 1;
    ctx.font = `800 ${size}px "Noto Sans KR", "Malgun Gothic", monospace`;
  }
  ctx.fillText(text, left + (w - left) / 2, h / 2 + 1);
}

/** 칸 번호(위치 코드) — 가까이 확대했을 때 카메라 주변 칸의 빔(선반판) 앞에 붙인다(재사용 풀 160개) */
export function CellLabels() {
  const { controller } = useApp();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const W = 320;
  const H = 56;
  const pool = useMemo(() => {
    const group = new THREE.Group();
    const items = Array.from({ length: 160 }, () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4 }));
      mesh.renderOrder = 6;
      mesh.visible = false;
      group.add(mesh);
      return { mesh, ctx: c.getContext('2d')!, tex, code: null as string | null };
    });
    return { group, items };
  }, []);
  const timer = useRef(0);
  useFrame((_, dt) => {
    timer.current -= dt;
    if (timer.current > 0) return;
    timer.current = 0.2;
    const now = controller.cameraNow?.();
    const f = controller.floorLayout();
    const show = !!now && !!f && controller.labelMode === 'all' && now.pos.distanceTo(now.target) < SLOT_LABEL_DIST;
    if (!show) {
      for (const p of pool.items) {
        p.mesh.visible = false;
        p.code = null;
      }
      return;
    }
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cam = camera.position;
    const pt = new THREE.Vector3();
    const cand: { loc: Location; d: number }[] = [];
    for (const l of [...f!.shelves, ...f!.locations]) {
      const y = l.type === 'PICK_FACE' ? l.pos.y : beamY(l.level);
      if (!frustum.containsPoint(pt.set(l.pos.x, y, l.pos.z))) continue;
      if ((cam.x - l.pos.x) * (l.face ?? 1) <= 0) continue; // 카메라가 칸 앞(통로) 쪽일 때만
      const d = cam.distanceTo(pt);
      if (d < camera.near + 0.1) continue; // 근접 클리핑으로 잘린 맞은편 칸
      cand.push({ loc: l, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const want = new Map(cand.slice(0, pool.items.length).map((c) => [c.loc.code, c.loc]));
    const free: typeof pool.items = [];
    for (const p of pool.items) {
      if (p.code && want.has(p.code)) {
        want.delete(p.code);
        p.mesh.visible = true;
      } else free.push(p);
    }
    const rest = [...want.values()];
    for (const p of free) {
      const l = rest.shift();
      if (!l) {
        p.mesh.visible = false;
        p.code = null;
        continue;
      }
      p.code = l.code;
      drawSlotTag(p.ctx, W, H, l.code.replace(/^CDC01-/, ''));
      p.tex.needsUpdate = true;
      const face = l.face ?? 1;
      const shelf = l.type === 'PICK_FACE';
      // 빔(선반판) 앞면보다 조금 앞 — 빔이 번호를 가리지 않게
      const x = l.pos.x + face * ((shelf ? SHELF.depth : RACK.depth) / 2 + 0.04);
      const y = shelf ? l.pos.y - 0.04 : beamY(l.level);
      p.mesh.position.set(x, y, l.pos.z);
      p.mesh.lookAt(x + face, y, l.pos.z);
      const w = shelf ? Math.min(0.4, (SHELF.unitLen / SHELF.slots) * 0.98) : Math.min(1.15, (RACK.bayW / RACK.slots) * 0.9);
      p.mesh.scale.set(w, w * (H / W), 1);
      p.mesh.visible = true;
    }
  });
  return <primitive object={pool.group} />;
}
