// 칠곡 피킹면 최소·목표 내보내기 — npx vite-node scripts/export-pick-face-settings.ts → docs/layout/chilgok-pick-face-settings.json
// 백엔드가 LAN 에 POST /internal/pick-face-settings(2,000칸씩)로 넣을 때 쓴다(R-26). 한 줄에 한 칸.
import { writeFileSync } from 'node:fs';
import { buildLayout } from '../src/domain/layout';
import { buildPickFaceSettings } from '../src/domain/pickFaceSettings';

const s = buildPickFaceSettings(buildLayout());
const text = `{\n"centerId": ${JSON.stringify(s.centerId)},\n"rule": ${JSON.stringify(s.rule)},\n"count": ${s.items.length},\n"items": [\n${s.items.map((i) => JSON.stringify(i)).join(',\n')}\n]\n}\n`;
JSON.parse(text);
writeFileSync('docs/layout/chilgok-pick-face-settings.json', text);
console.log('docs/layout/chilgok-pick-face-settings.json', s.items.length, '칸', JSON.stringify(s.rule));
