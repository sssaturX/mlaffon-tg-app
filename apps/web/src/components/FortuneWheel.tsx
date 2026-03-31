import { useMemo } from "react";

export type FortuneSegment = {
  index: number;
  type: string;
  value?: number;
  label: string;
};

const WHEEL_COLORS = [
  "#6d28d9",
  "#4c1d95",
  "#7c3aed",
  "#5b21b6",
  "#8b5cf6",
  "#a78bfa",
  "#c4b5fd",
];

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function wedgePath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const p1 = polar(cx, cy, r, startDeg);
  const p2 = polar(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const large = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`;
}

type Props = {
  segments: FortuneSegment[];
  /** Суммарный угол поворота (градусы, по часовой). */
  rotationDeg: number;
  spinning: boolean;
};

/**
 * Колесо: сектор 0 начинается сверху, указатель зафиксирован на 12 часов.
 */
export function FortuneWheel({ segments, rotationDeg, spinning }: Props) {
  const n = segments.length;
  const slice = 360 / n;

  const paths = useMemo(() => {
    return segments.map((seg, i) => {
      const startDeg = -90 + i * slice;
      const endDeg = -90 + (i + 1) * slice;
      const midDeg = (startDeg + endDeg) / 2;
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
      const labelR = 56;
      const lp = polar(0, 0, labelR, midDeg);
      const textRot = midDeg + 90 + (midDeg > 90 && midDeg < 270 ? 180 : 0);
      return {
        key: seg.index,
        d: wedgePath(0, 0, 100, startDeg, endDeg),
        fill: color,
        label: seg.label,
        lx: lp.x,
        ly: lp.y,
        textRot,
      };
    });
  }, [segments, slice, n]);

  return (
    <div className="fortune-wheel-wrap">
      <div className="fortune-wheel-pointer" aria-hidden>
        <div className="fortune-wheel-pointer__tri" />
      </div>
      <div
        className={`fortune-wheel-disk ${spinning ? "fortune-wheel-disk--spinning" : ""}`}
        style={{ transform: `rotate(${rotationDeg}deg)` }}
      >
        <svg
          className="fortune-wheel-svg"
          viewBox="-100 -100 200 200"
          aria-hidden
        >
          <defs>
            <filter id="fortune-wheel-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="3" floodOpacity="0.35" />
            </filter>
          </defs>
          <g filter="url(#fortune-wheel-shadow)">
            {paths.map((p) => (
              <path key={p.key} d={p.d} fill={p.fill} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
            ))}
          </g>
          {paths.map((p) => (
            <text
              key={`t-${p.key}`}
              x={p.lx}
              y={p.ly}
              className="fortune-wheel-label"
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${p.textRot}, ${p.lx}, ${p.ly})`}
            >
              {p.label.length > 12 ? `${p.label.slice(0, 10)}…` : p.label}
            </text>
          ))}
          <circle cx="0" cy="0" r="18" className="fortune-wheel-hub" />
          <circle cx="0" cy="0" r="10" className="fortune-wheel-hub-inner" />
        </svg>
      </div>
    </div>
  );
}

/** Угол центра сектора i от «верха» по часовой стрелке (0..360). */
export function segmentCenterAngleDeg(segmentIndex: number, segmentCount: number): number {
  const slice = 360 / segmentCount;
  return segmentIndex * slice + slice / 2;
}

/** Следующий угол поворота после выпадения segmentIndex (добавляет полные обороты). */
export function nextRotationDeg(
  currentRotation: number,
  segmentIndex: number,
  segmentCount: number,
  fullTurns: number
): number {
  const center = segmentCenterAngleDeg(segmentIndex, segmentCount);
  return currentRotation + 360 * fullTurns + (360 - center);
}
