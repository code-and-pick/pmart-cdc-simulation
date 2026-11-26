// 5톤 탑차 — MFC 시뮬레이터 Agents.Truck 과 같은 모양(사용자 2026-11-26 "트럭 UI" — 참고 그림: 흰 탑 + 파란 띠 두 줄, 파란 운전칸·짙은 앞유리, 회색 차대·범퍼, 바퀴).
// DC 는 북쪽 벽 도크에 뒷문을 대고(뒷문 = 도크 쪽 +z), 운전칸은 바깥(-z). 저온 차는 탑 색을 바꾸고 운전칸 위 탑 앞에 냉동기.
import type { ReactNode } from 'react';

function B({ size, color, position, metal }: { size: [number, number, number]; color: number; position: [number, number, number]; metal?: boolean }) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} {...(metal ? { metalness: 0.5, roughness: 0.1 } : {})} />
    </mesh>
  );
}

const BODY = { AMBIENT: 0xf7f8fb, CHILLED: 0xe6f1ff, FROZEN: 0xd9e8fb } as const;

/** rearZ = 뒷문 z(도크 쪽), 차 길이 약 7m. children = 위에 띄울 이름표 등 */
export function DcTruck({ x, rearZ, temp, cabColor = 0x1f5fd6, children }: { x: number; rearZ: number; temp: keyof typeof BODY; cabColor?: number; children?: ReactNode }) {
  // MFC 모형은 로컬 +x 가 앞(운전칸), 뒷문이 x = -3.2. y 축으로 +90° 돌리면 +x → -z(바깥쪽)
  const s = 1.1;
  return (
    <group position={[x, 0, rearZ - 3.2 * s]} rotation={[0, Math.PI / 2, 0]} scale={[s, s, s]}>
      <B size={[5.0, 2.5, 2.3]} color={BODY[temp]} position={[-0.7, 1.55, 0]} />
      <B size={[5.02, 0.22, 2.32]} color={0x1f5fd6} position={[-0.7, 1.05, 0]} />
      <B size={[5.02, 0.08, 2.32]} color={0x5b9bff} position={[-0.7, 1.28, 0]} />
      {temp !== 'AMBIENT' && <B size={[0.5, 0.7, 1.6]} color={0xc8ced8} position={[1.95, 2.45, 0]} />}
      <B size={[6.4, 0.25, 2.0]} color={0x5b6472} position={[0, 0.42, 0]} />
      <B size={[1.8, 1.9, 2.25]} color={cabColor} position={[2.75, 1.4, 0]} />
      <B size={[1.2, 0.5, 2.27]} color={0x1849ad} position={[2.95, 2.25, 0]} />
      <B size={[0.05, 0.75, 1.95]} color={0x1c2a44} position={[3.66, 1.75, 0]} metal />
      <B size={[0.12, 0.25, 2.2]} color={0xb8c0cc} position={[3.7, 0.6, 0]} />
      {[-0.75, 0.75].map((z) => (
        <B key={z} size={[0.04, 0.14, 0.32]} color={0xfff5c2} position={[3.71, 0.95, z]} />
      ))}
      {/* 뒷문 두 짝 선 */}
      <B size={[0.02, 2.3, 0.03]} color={0xb8c0cc} position={[-3.21, 1.55, 0]} />
      {[-2.4, -1.2, 2.6].flatMap((wx) =>
        [-1.0, 1.0].map((wz) => (
          <group key={`${wx}:${wz}`} position={[wx, 0.42, wz]}>
            <mesh rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.42, 0.42, 0.3, 18]} />
              <meshStandardMaterial color={0x1c1f26} roughness={0.8} />
            </mesh>
            <mesh rotation-x={Math.PI / 2} position={[0, 0, wz > 0 ? 0.16 : -0.16]}>
              <cylinderGeometry args={[0.2, 0.2, 0.02, 14]} />
              <meshStandardMaterial color={0xc8ced8} metalness={0.5} roughness={0.3} />
            </mesh>
          </group>
        )),
      )}
      {/* 이름표는 돌리지 않은 채(위로) — 부모 회전을 되돌림 */}
      <group position={[-0.7, 0, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[1 / s, 1 / s, 1 / s]}>
        {children}
      </group>
    </group>
  );
}
