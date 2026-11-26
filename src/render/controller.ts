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
export type RightView = 'logs' | 'trf' | 'transport' | 'admin' | 'api' | 'events' | 'inventory' | 'moves' | 'barcode';
export type LeftView = 'settings' | 'zone' | 'workers' | 'help' | 'perf';
export type Theme = 'dark' | 'light';
export type FloorKey = FloorNo;

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
  /** 카메라가 따라가는 작업자(작업자 흐름 패널 [따라가기], 사용자 2026-11-26) */
  followWorker: string | null = null;
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
    const all: ZoneView = { key: 'ALL', label: '전체', rect: { x0: 0, z0: 0, x1: L.width, z1: L.depth } };
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
    // 전체(층): 남북으로 긴 층(약 81 × 117 m)이 다 들어오게 더 내려다본다 [시뮬]. 북쪽 벽 카드 줄이 위 이상 알림 줄에 가리지 않게 조금 북쪽으로(2026-11-26)
    const target = new THREE.Vector3(cx, 0, key === 'ALL' ? cz - dist * 0.09 : cz - dist * 0.12);
    const pos = key === 'ALL' ? new THREE.Vector3(cx, dist * 0.9, cz + dist * 0.26) : new THREE.Vector3(cx, dist * 0.92, cz + dist * 0.42);
    this.cameraRequest = { pos, target, animate };
    this.emit();
  }

  /** 구역 위에서 보기의 카메라 거리 */
  zoneDist(v: ZoneView): number {
    const w = v.rect.x1 - v.rect.x0;
    const d = v.rect.z1 - v.rect.z0;
    // 전체: 층 전체가 들어오게 [시뮬]
    if (v.key === 'ALL') return Math.max(w * 1.2, d * 1.3);
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
    this.followWorker = null;
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
    if (this.followWorker && this.followWorker !== id) this.followWorker = null;
    if (floor !== undefined && floor !== this.floor) {
      this.floor = floor;
      this.selected = null;
    }
    this.emit();
  }

  /** 벽 투명도 — MFC 와 같음: 전체 보기 0.32, 구역에 들어가면 0.07(안이 보이게), 칸 정면이면 0 */
  /** MFC 필터(위 칩) — 고른 MFC 의 TRF·박스·R/T·출고대기 자리만 강조 [사용자 §6-3] */
  mfcFilter: string | null = null;
  setMfcFilter(id: string | null) {
    this.mfcFilter = id;
    this.emit();
  }

  /** 사용자가 고른 벽 투명도(위 [벽 / 벽 숨김] — MFC 와 같음), null 이면 화면 상태대로 */
  wallUser: number | null = null;
  get wallOpacity(): number {
    if (this.nearCut > 0) return 0;
    return this.wallUser ?? (this.focusedZone === 'ALL' ? 0.32 : 0.07);
  }

  setWallOpacity(o: number) {
    this.wallUser = o;
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

  /** 구역을 고르고 왼쪽 구역 탭을 연다(닫혀 있어도) — 3D 설비(오토스토어)를 눌렀을 때 */
  openZone(key: string) {
    this.leftView = 'zone';
    this.focusZone(key);
  }

  toggleLeft(v: LeftView) {
    this.leftView = this.leftView === v ? null : v;
    this.emit();
  }

  toggleRight(v: RightView) {
    this.rightView = this.rightView === v ? null : v;
    this.emit();
  }

  /** 작업자 따라가기 켜기·끄기 — 켜면 그 사람 위 비스듬히로 옮기고, 그 뒤는 CameraRig 가 매 프레임 같은 거리로 따라간다 */
  setFollow(id: string | null, at?: { x: number; z: number }) {
    this.followWorker = id;
    if (id && at) {
      if (!this.homeView && this.cameraNow) this.homeView = { ...this.cameraNow(), animate: true };
      this.cameraRequest = { pos: new THREE.Vector3(at.x, 26, at.z + 20), target: new THREE.Vector3(at.x, 0, at.z), animate: true };
    }
    this.emit();
  }

  takeCameraRequest(): CameraRequest | null {
    const r = this.cameraRequest;
    this.cameraRequest = null;
    return r;
  }
}
