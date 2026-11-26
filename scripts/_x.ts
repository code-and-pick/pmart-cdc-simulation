import { building, buildLayout } from '../src/domain/layout';
import { buildLocationExport } from '../src/domain/locationExport';
const B = building();
console.log('building', B.width.toFixed(1), 'x', B.depth.toFixed(1), 'band', B.bandDepth.toFixed(1));
const L = buildLayout();
const c = L.capacity;
const P = 3.3058;
console.log(JSON.stringify(buildLocationExport(L).counts), 'cap', c.total, 'sku', c.skuSlots, 'auto', JSON.stringify({ nx: L.autostore!.nx, nz: L.autostore!.nz, fit: L.autostore!.binsFit, bins: L.autostore!.bins }));
for (const f of L.floors) {
  console.log(`== ${f.floor}F docks`, f.docks.map((d) => `${d.short}@${d.pos.x.toFixed(0)}`).join(' '), 'staging', f.staging.length);
  for (const z of f.zones.filter((z) => z.kind !== 'RACK')) console.log(' ', z.id, z.rect.x0.toFixed(1), z.rect.x1.toFixed(1), z.rect.z0.toFixed(1), z.rect.z1.toFixed(1), Math.round((z.rect.x1 - z.rect.x0) * (z.rect.z1 - z.rect.z0) / P) + '평');
}
console.log('5F docks', L.floors[0].docks.map((d) => `${d.short}${d.temp[0]}@${d.pos.x.toFixed(0)}`).join(' '));
