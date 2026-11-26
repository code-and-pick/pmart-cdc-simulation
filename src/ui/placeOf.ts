// 작업자 자리 → 사람이 읽는 이름(작업자 흐름 패널). 통로도 이름으로.
import type { FloorLayout } from '../domain/layout';

type R4 = { x0: number; z0: number; x1: number; z1: number };
const shortLabel = (label: string) => label.replace(/\s*\(.*\)$/, '');

/**
 * 자리 → 사람이 읽는 이름. 통로도 이름으로(사용자 2026-11-26 "통로로만 나오는 것 해결해"):
 * 승강기 앞 · 도크 앞 · 출고대기 칸 · 선반 통로(통로 번호) · 설비 안 · 랙 통로(번호판) · 랙 앞 가로 통로 · 묶음 사이 가로 통로 · 북쪽/남쪽 가로 통로(가까운 설비 옆)
 */
export function placeOf(f: FloorLayout | undefined, x: number, z: number): string {
  if (!f) return '';
  const inR = (r: R4, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
  const area = (r: R4) => (r.x1 - r.x0) * (r.z1 - r.z0);
  const dist = (r: R4) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  const lift = f.lifts.find((l) => inR(l.rect, 0.8));
  if (lift) return `승강기 ${lift.no}호기 앞`;
  // 북쪽 벽 쪽 — 도크·출고대기
  if (z < f.walk.northZ + 0.6) {
    const dock = f.docks.filter((d) => Math.abs(d.pos.x - x) < 2.4).sort((p, q) => Math.abs(p.pos.x - x) - Math.abs(q.pos.x - x))[0];
    if (dock && z < 4) return `도크 ${dock.short} 앞`;
    const st = f.staging.find((c) => Math.abs(c.pos.x - x) < 1.2 && Math.abs(c.pos.z - z) < 1.6);
    if (st) return `출고대기 ${st.short}`;
  }
  // 설비·선반 구역 안(작은 것 먼저)
  const hit = f.zones.filter((q) => q.kind !== 'BAND' && q.kind !== 'RACK' && inR(q.rect)).sort((p, q) => area(p.rect) - area(q.rect))[0];
  const sa = f.shelfAisles
    .filter((q) => Math.abs(q.cx - x) < 1.4 && (q.z0 === undefined || (z >= q.z0 - 0.6 && z <= (q.z1 ?? q.z0) + 0.6)))
    .sort((p, q) => Math.abs(p.cx - x) - Math.abs(q.cx - x))[0];
  if (sa) return `${shortLabel(hit?.label ?? '피킹 선반')} · 통로 ${sa.plate}`;
  if (hit) return shortLabel(hit.label);
  // 랙 구역(남쪽)
  if (z >= f.walk.rackZ - 1.2) {
    const ra = [...f.aisles].sort((p, q) => Math.abs(p.cx - x) - Math.abs(q.cx - x))[0];
    const rackZone = f.zones.find((q) => q.kind === 'RACK' && inR(q.rect, 0.5));
    const zn = rackZone ? `${shortLabel(rackZone.label)} ` : '';
    if (Math.abs(z - f.walk.rackZ) < 1.6) return `랙 앞 가로 통로${ra ? ` (${ra.plate} 앞)` : ''}`;
    const inRow = f.rows.some((r) => z >= r.z0 && z <= r.z1);
    if (!inRow) return `${zn}랙 묶음 사이 가로 통로${ra ? ` (${ra.plate} 근처)` : ''}`;
    if (ra && Math.abs(ra.cx - x) < 1.8) return `${zn}랙 통로 ${ra.plate}`;
    return `${zn}랙 사이`;
  }
  // 띠 안 통로 — 가까운 설비·구역 옆
  const near = f.zones.filter((q) => q.kind !== 'BAND' && q.kind !== 'RACK').sort((p, q) => dist(p.rect) - dist(q.rect))[0];
  const where = z < f.walk.northZ + 1.2 ? '북쪽 통로' : Math.abs(z - f.walk.roomZ) < 1.2 ? '랙 앞쪽 남쪽 가로 통로' : '띠 안 통로';
  return near && dist(near.rect) < 6 ? `${where} · ${shortLabel(near.label)} 옆` : where;
}
