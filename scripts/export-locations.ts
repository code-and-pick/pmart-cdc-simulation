// 칠곡 DC 위치 목록 내보내기 — npm run export:locations → docs/layout/chilgok-locations.json
// 백엔드가 칠곡 전체 시드(POST /internal/location-batches, 2,000행씩)를 만들 때 쓴다(2026-11-25 부탁).
// 한 줄에 한 위치 — diff 로 바뀐 칸이 보이게.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildLayout } from '../src/domain/layout';
import { buildLocationExport } from '../src/domain/locationExport';

const out = buildLocationExport(buildLayout());
const lines = (xs: string[]) => xs.join(',\n');
const text =
  '{\n' +
  `"centerId": ${JSON.stringify(out.centerId)},\n` +
  `"source": ${JSON.stringify(out.source)},\n` +
  `"counts": ${JSON.stringify(out.counts)},\n` +
  `"items": [\n${lines(out.items.map((i) => JSON.stringify(i)))}\n],\n` +
  `"geometry": {\n${lines(Object.entries(out.geometry).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`))}\n}\n` +
  '}\n';
JSON.parse(text);
mkdirSync('docs/layout', { recursive: true });
writeFileSync('docs/layout/chilgok-locations.json', text);
console.log('docs/layout/chilgok-locations.json', JSON.stringify(out.counts));
