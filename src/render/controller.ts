// 화면 상태(층·구역·선택·테마·패널)와 카메라 요청. React UI 와 3D 장면이 함께 본다 — MFC 시뮬레이터 render/controller.ts 와 같은 틀.
import * as THREE from 'three';
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

export type LabelMode = 'all' | 'rack' | 'off';
export type RightView = 'summary' | 'inventory' | 'logs';
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
  labelMode: LabelMode = 'rack';
  theme: Theme = loadTheme();
  leftView: LeftView | null = 'settings';
  rightView: RightView | null = 'summary';
  /** 누른 칸 */
  selected: Location | null = null;
  /** 누른 작업자(PDA 카드) */
  selectedWorker: string | null = null;
  cameraRequest: CameraRequest | null = null;

  constructor(readonly layout: Layout) {
    super();
  }

  floorLayout(): FloorLayout | null {
    return this.layout.floors.find((f) => f.floor === this.floor) ?? null;
  }

  /** 층 안 구역 버튼 — 전체 · 랙 구역 · 승강기·출고대기 띠 · 설비 */
  zoneViews(): ZoneView[] {
    const L = this.layout;
    const all: ZoneView = { key: 'ALL', label: '전체', rect: { x0: 0, z0: 0, x1: L.width, z1: L.depth } };
    const f = this.floorLayout();
    if (!f) return [all];
    return [all, ...f.zones.map((z) => ({ key: z.id, label: z.kind === 'BAND' ? '출고대기·승강기' : z.label, rect: z.rect }))];
  }

  setFloor(fl: FloorKey) {
    this.floor = fl;
    this.selected = null;
    this.focusZone('ALL');
  }

  focusZone(key: string) {
    this.focusedZone = key;
    const v = this.zoneViews().find((z) => z.key === key) ?? this.zoneViews()[0];
    const r = v.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const span = Math.max(r.x1 - r.x0, r.z1 - r.z0);
    this.cameraRequest = { pos: new THREE.Vector3(cx, span * 0.75 + 8, cz + span * 0.55 + 6), target: new THREE.Vector3(cx, 0, cz), animate: true };
    this.emit();
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
