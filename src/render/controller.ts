// 화면 상태(층·구역·선택·테마·패널)와 카메라 요청. React UI 와 3D 장면이 함께 본다 — MFC 시뮬레이터 render/controller.ts 와 같은 틀.
import * as THREE from 'three';
import { RACK, SHELF } from '../config';
import type { FloorLayout, Layout, Location, Rect } from '../domain/layout';
import type { FloorNo } from '../domain/sites/chilgok';

/** useSyncExternalStore 로 구독하는 변경 알림 */
export class Emitter {
  private readonly listeners = new Set<() => void>();
  private version = 0;
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  readonly getVersion = () => this.version;
  protected emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** 패널 갱신 박자(약 4Hz) */
export class Ticker extends Emitter {
  bump() {
    this.emit();
  }
}

export interface ZoneView {
  key: string;
  label: string;
  rect: Rect;
}

export interface CameraRequest {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  animate: boolean;
}

/** all = 랙 번호판 + 가까이 확대하면 칸 번호 · rack = 랙 번호판만 · off = 끔 (MFC 와 같음) */
export type LabelMode = 'all' | 'rack' | 'off';
export type RightView = 'logs' | 'transport' | 'api' | 'events' | 'inventory';
export type LeftView = 'settings' | 'zone' | 'workers' | 'help';
export type Theme = 'dark' | 'light';
export type FloorKey = FloorNo | 'B1';

const THEME_KEY = 'pmart-cdc-sim-theme';
function loadTheme(): Theme {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export class ViewController extends Emitter {
  floor: FloorKey = 5;
  focusedZone = 'ALL';
  labelMode: LabelMode = 'all';
  theme: Theme = loadTheme();
  leftView: LeftView | null = 'settings';
  rightView: RightView | null = 'logs';
  /** 누른 칸 */
  selected: Location | null = null;
  /** 누른 작업자(PDA 카드) */
  selectedWorker: string | null = null;
  cameraRequest: CameraRequest | null = null;
  /** 칸 정면 보기 중 근접 클리핑 거리 — 맞은편 랙을 잘라 낸다(MFC focusLocation 과 같은 방법) */
  nearCut = 0;
  /** 확대하기 전 시야(Esc·빈 곳 클릭으로 돌아감) */
  private homeView: CameraRequest | null = null;
  /** 카메라 담당(CameraRig)이 채운다 — 지금 카메라 위치·보는 점 */
  cameraNow: (() => { pos: THREE.Vector3; target: THREE.Vector3 }) | null = null;
  /** 사람 3D 묶음(클릭 판정용, 화면 갱신 없음) */
  readonly people = new Map<string, THREE.Object3D>();

  constructor(readonly layout: Layout) {
    super();
  }

  floorLayout(): FloorLayout | null {
    return this.layout.floors.find((f) => f.floor === this.floor) ?? null;
  }

  /** 층 안 구역 버튼 — 전체 · 랙 구역 · 승강기·출고대기 띠 · 설비 */
  zoneViews(): ZoneView[] {
    const L = this.layout;
    // B1 은 승강기 착지(z −9)~차 끝(z 15), 접안 14자리 폭만 — 층 바닥 전체를 잡으면 너무 멀었다
    const b1Right = Math.max(6 + L.docks.length * 4.5 + 4, ...L.floors[0].lifts.map((x) => x.rect.x1 + 4));
    const all: ZoneView = { key: 'ALL', label: '전체', rect: this.floor === 'B1' ? { x0: 0, z0: -9, x1: b1Right, z1: 15 } : { x0: 0, z0: 0, x1: L.width, z1: L.depth } };
    const f = this.floorLayout();
    if (!f) return [all];
    return [all, ...f.zones.map((z) => ({ key: z.id, label: z.kind === 'BAND' && z.id.endsWith('-BAND') ? '출고대기·승강기' : z.label, rect: z.rect }))];
  }

  setFloor(fl: FloorKey) {
    this.floor = fl;
    this.selected = null;
    this.focusZone('ALL');
  }

  /**
   * 구역 위에서 보기 — MFC 시뮬레이터 focusZone 과 같은 각도·거리 공식(약 63° 비스듬히, 거리 = 크기 × 0.7 + 2.5).
   * 전체는 층 전체가 들어오게 더 멀리서.
   */
  focusZone(key: string, animate = true) {
    if (key === 'ALL') this.homeView = null;
    this.focusedZone = key;
    if (key !== 'ALL' && this.leftView !== null) this.leftView = 'zone';
    this.nearCut = 0;
    const v = this.zoneViews().find((z) => z.key === key) ?? this.zoneViews()[0];
    const r = v.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const dist = this.zoneDist(v);
    // 전체(층): 남북으로 긴 층(약 81 × 117 m)이 다 들어오게 더 내려다본다 [시뮬]. B1 은 예전 각도
    const b1 = this.floor === 'B1';
    const target = new THREE.Vector3(cx, 0, key === 'ALL' ? (b1 ? cz + 1 : cz + dist * 0.03) : cz - dist * 0.12);
    const pos = key === 'ALL' ? (b1 ? new THREE.Vector3(cx, dist * 0.78, cz + dist * 0.72) : new THREE.Vector3(cx, dist * 0.9, cz + dist * 0.38)) : new THREE.Vector3(cx, dist * 0.92, cz + dist * 0.42);
    this.cameraRequest = { pos, target, animate };
    this.emit();
  }

  /** 구역 위에서 보기의 카메라 거리 */
  zoneDist(v: ZoneView): number {
    const w = v.rect.x1 - v.rect.x0;
    const d = v.rect.z1 - v.rect.z0;
    // 전체: 층 전체가 들어오게 [시뮬]. B1 은 좁아 더 가깝게
    if (v.key === 'ALL') return this.floor === 'B1' ? Math.max(w, d) * 0.75 : Math.max(w * 1.2, d * 1.3);
    return Math.max(w, d * 1.3) * 0.7 + 2.5;
  }

  private rememberHome() {
    if (this.homeView || !this.cameraNow) return;
    const now = this.cameraNow();
    this.homeView = { pos: now.pos.clone(), target: now.target.clone(), animate: true };
  }

  /**
   * 칸 정면으로 붙는다 — 그 단 높이에서 칸 앞면을 마주 보고, 카메라는 맞은편 랙 뒤에 두고 그 사이(맞은편 랙)는 근접 클리핑으로 잘라 낸다.
   * (MFC focusLocation: 통로가 좁아 정면에서 물러서면 맞은편 랙이 가린다)
   */
  focusLocation(loc: Location) {
    const face = loc.face ?? 1;
    const shelf = loc.type === 'PICK_FACE';
    const depth = shelf ? SHELF.depth : RACK.depth;
    const aisle = shelf ? SHELF.aisleW : RACK.aisleW;
    const levelMid = shelf ? loc.pos.y + ((SHELF.height - 0.25) / SHELF.levels) / 2 : (loc.level === 1 ? 0.15 : (loc.level - 1) * RACK.levelH) + RACK.levelH * 0.45;
    const target = new THREE.Vector3(loc.pos.x, levelMid, loc.pos.z);
    // 칸 중심 → 칸 앞면(depth/2) → 통로 → 맞은편 랙(depth) → 조금 뒤
    const back = depth / 2 + aisle + depth + (shelf ? 0.5 : 1.2);
    const pos = target.clone().add(new THREE.Vector3(face * back, shelf ? 0.15 : 0.4, 0));
    this.cameraRequest = { pos, target, animate: true };
    // 카메라에서 맞은편 랙 통로 쪽 면까지 = back − depth/2 − aisle
    this.nearCut = back - depth / 2 - aisle + 0.08;
    this.emit();
  }

  /**
   * 3D 에서 칸을 누름 — 카메라가 멀면 그 칸이 있는 구역 위에서 보기, 가까우면 그 칸 정면 + 왼쪽 칸 카드(MFC clickCell 과 같음).
   */
  clickCell(loc: Location, camDist: number) {
    const v = this.zoneViews().find((z) => z.key !== 'ALL' && loc.pos.x >= z.rect.x0 && loc.pos.x <= z.rect.x1 && loc.pos.z >= z.rect.z0 && loc.pos.z <= z.rect.z1);
    this.selected = loc;
    if (this.leftView !== 'zone') this.leftView = 'zone';
    if (v && camDist > this.zoneDist(v) * 1.25) {
      this.rememberHome();
      this.focusZone(v.key);
      return;
    }
    this.rememberHome();
    this.focusLocation(loc);
  }

  /** 나가기(Esc·빈 곳 클릭) — 칸 정면이면 확대하기 전 시야로, 아니면 층 전체로 */
  backOut() {
    this.selected = null;
    this.selectedWorker = null;
    if (this.homeView) {
      this.cameraRequest = this.homeView;
      this.homeView = null;
      this.nearCut = 0;
      this.emit();
      return;
    }
    this.focusZone('ALL');
  }

  select(loc: Location | null) {
    this.selected = loc;
    if (loc && this.leftView !== 'zone') this.leftView = 'zone';
    this.emit();
  }

  selectWorker(id: string | null, floor?: FloorKey) {
    this.selectedWorker = id;
    if (floor !== undefined && floor !== this.floor) {
      this.floor = floor;
      this.selected = null;
    }
    this.emit();
  }

  /** 벽 투명도 — MFC 와 같음: 전체 보기 0.32, 구역에 들어가면 0.07(안이 보이게), 칸 정면이면 0 */
  get wallOpacity(): number {
    if (this.nearCut > 0) return 0;
    return this.focusedZone === 'ALL' ? 0.32 : 0.07;
  }

  setLabelMode(m: LabelMode) {
    this.labelMode = m;
    this.emit();
  }

  setTheme(t: Theme) {
    this.theme = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* 저장 못 하면 이번만 */
    }
    this.emit();
  }

  toggleLeft(v: LeftView) {
    this.leftView = this.leftView === v ? null : v;
    this.emit();
  }

  toggleRight(v: RightView) {
    this.rightView = this.rightView === v ? null : v;
    this.emit();
  }

  takeCameraRequest(): CameraRequest | null {
    const r = this.cameraRequest;
    this.cameraRequest = null;
    return r;
  }
}
