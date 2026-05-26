/* global React */

// ============================================================
// Dial renderer — pure SVG, black & white.
// Supports: straight, semi-circle, circle, custom arc.
// ============================================================

function fmtNum(v, digits = 2) {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, "");
}

function buildTickValues(min, max, step) {
  const ticks = [];
  if (step <= 0) return ticks;
  // small epsilon to avoid floating-point drift losing the final tick
  const eps = step / 1e6;
  for (let v = min; v <= max + eps; v += step) {
    // clamp tiny FP drift back onto step lattice
    const rounded = Math.round(v / step) * step;
    ticks.push(rounded);
  }
  // dedup last item in case rounding pushed it past max
  return ticks.filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > eps);
}

// ---- Straight dial ----
function StraightDial({ p, ticksMajor, ticksMinor }) {
  const {
    min, max, width, height,
    rim, rimThickness,
    tickColor, majorLen, minorLen, majorWeight, minorWeight,
    showNumbers, numberSize, numberOffset, numberWeight,
    tickSide, // "below" | "above" | "both"
    orientation, // "horizontal" | "vertical"
  } = p;

  const pad = Math.max(36, majorLen + numberOffset + numberSize + 12);

  // Orient as horizontal then optionally rotate via transform group
  const isV = orientation === "vertical";
  const length = isV ? height - pad * 2 : width - pad * 2;
  const axisX0 = pad;
  const axisY0 = isV ? pad : height / 2;
  const axisX1 = isV ? width / 2 : width - pad;
  const axisY1 = isV ? height - pad : height / 2;

  const valueToPos = (v) => {
    const t = (v - min) / (max - min);
    if (isV) return { x: axisX1, y: axisY0 + t * length }; // top -> bottom
    return { x: axisX0 + t * length, y: axisY0 };
  };

  const perp = (len, sign = 1) => (isV ? { dx: sign * len, dy: 0 } : { dx: 0, dy: sign * len });

  const sides = tickSide === "both" ? [-1, 1] : [tickSide === "above" ? -1 : 1];

  // Extend the rim-side endpoint of every tick through the rim's thickness so
  // endpoints visually close the rim instead of leaving a notch.
  const rimExt = rim ? rimThickness / 2 : 0;

  const tickLine = (v, len, weight, key) => {
    const a = valueToPos(v);
    return sides.map((s) => {
      const off = perp(len, s);
      const back = perp(rimExt, -s); // small extension across the axis
      return (
        <line
          key={`${key}-${s}`}
          x1={a.x + back.dx} y1={a.y + back.dy}
          x2={a.x + off.dx} y2={a.y + off.dy}
          stroke={tickColor}
          strokeWidth={weight}
          strokeLinecap="butt"
        />
      );
    });
  };

  return (
    <g>
      {/* Rim (axis line) */}
      {rim && (
        <line
          x1={axisX0} y1={axisY0}
          x2={axisX1} y2={axisY1}
          stroke={tickColor}
          strokeWidth={rimThickness}
          strokeLinecap="butt"
        />
      )}

      {/* Minor ticks */}
      {ticksMinor.map((v, i) => tickLine(v, minorLen, minorWeight, `mi-${i}`))}

      {/* Major ticks */}
      {ticksMajor.map((v, i) => tickLine(v, majorLen, majorWeight, `mj-${i}`))}

      {/* Numbers */}
      {showNumbers && ticksMajor.map((v, i) => {
        const a = valueToPos(v);
        // Numbers go on the "primary" side (below for horizontal, right for vertical)
        const side = tickSide === "above" ? -1 : 1;
        const off = perp(majorLen + numberOffset, side);
        const tx = a.x + off.dx;
        const ty = a.y + off.dy;
        return (
          <text
            key={`n-${i}`}
            x={tx}
            y={ty}
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize={numberSize}
            fontWeight={numberWeight}
            fill={tickColor}
            textAnchor={isV ? "start" : "middle"}
            dominantBaseline={isV ? "middle" : (side === 1 ? "hanging" : "auto")}
            dy={isV ? 0 : (side === 1 ? 2 : -2)}
            dx={isV ? 4 : 0}
          >
            {fmtNum(v)}
          </text>
        );
      })}
    </g>
  );
}

// ---- Arc dial (covers semi-circle, circle, custom arc) ----
function ArcDial({ p, ticksMajor, ticksMinor }) {
  const {
    min, max, width, height,
    rim, rimThickness,
    tickColor, majorLen, minorLen, majorWeight, minorWeight,
    showNumbers, numberSize, numberOffset,
    startAngle, // degrees, 0 = right, 90 = bottom (SVG convention will be adjusted)
    sweepAngle, // degrees, positive = clockwise
    tickDirection, // "inward" | "outward"
    numberPlacement, // "inside" | "outside"
    radiusOverride, // optional override
    closedRing, // boolean — when sweep===360, draw full circle
  } = p;

  const cx = width / 2;
  // For arcs that aren't full circle, push center down a bit so semi-circles read well
  const isFullCircle = Math.abs(sweepAngle) >= 360 - 0.001;
  let cy = height / 2;

  // Compute usable radius given padding for ticks + numbers
  const ringExtra = rim ? rimThickness / 2 : 0;
  const outerExtra = (tickDirection === "outward" ? majorLen : 0)
    + (showNumbers && numberPlacement === "outside" ? numberOffset + numberSize + 4 : 0)
    + ringExtra + 8;
  const innerExtra = (tickDirection === "inward" ? majorLen : 0)
    + (showNumbers && numberPlacement === "inside" ? numberOffset + numberSize + 4 : 0);

  // For semi/quarter arcs we want to fit the visible bounding box
  // Simpler approach: compute radius from min(width,height)/2 minus paddings
  let r = Math.min(width, height) / 2 - outerExtra;
  if (radiusOverride && radiusOverride > 0) r = radiusOverride;
  r = Math.max(20, r);

  // Adjust vertical center for semi-circle so the arc isn't pinned to top
  if (!isFullCircle) {
    // Center the visible bounding box of the arc.
    // Compute bounding box for sampled arc.
    const samples = 64;
    let xs = [], ys = [];
    for (let i = 0; i <= samples; i++) {
      const a = startAngle + (sweepAngle * i) / samples;
      const rad = (a * Math.PI) / 180;
      xs.push(Math.cos(rad) * r);
      ys.push(Math.sin(rad) * r);
    }
    // Account for outer extension at endpoints + outward ticks
    const extOut = outerExtra;
    const extIn = innerExtra;
    const minX = Math.min(...xs) - extOut;
    const maxX = Math.max(...xs) + extOut;
    const minY = Math.min(...ys) - extOut;
    const maxY = Math.max(...ys) + extOut;
    const bbW = maxX - minX;
    const bbH = maxY - minY;
    // Choose r so bbox fits in width/height
    const sx = (width - 8) / bbW;
    const sy = (height - 8) / bbH;
    const scale = Math.min(1, Math.min(sx, sy));
    if (scale < 1) {
      // Re-derive r at smaller scale
      r = r * scale;
      // recompute extents
      for (let i = 0; i <= samples; i++) {
        const a = startAngle + (sweepAngle * i) / samples;
        const rad = (a * Math.PI) / 180;
        xs[i] = Math.cos(rad) * r;
        ys[i] = Math.sin(rad) * r;
      }
    }
    const newMinX = Math.min(...xs) - outerExtra;
    const newMaxX = Math.max(...xs) + outerExtra;
    const newMinY = Math.min(...ys) - outerExtra;
    const newMaxY = Math.max(...ys) + outerExtra;
    const cxBbox = (newMinX + newMaxX) / 2;
    const cyBbox = (newMinY + newMaxY) / 2;
    // shift so bbox is centered
    const shiftX = width / 2 - cxBbox;
    const shiftY = height / 2 - cyBbox;
    // We'll apply via translate
    return (
      <g transform={`translate(${shiftX} ${shiftY})`}>
        <ArcDialBody
          p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor}
          cx={0} cy={0} r={r}
        />
      </g>
    );
  }

  return (
    <ArcDialBody
      p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor}
      cx={cx} cy={cy} r={r}
    />
  );
}

function ArcDialBody({ p, ticksMajor, ticksMinor, cx, cy, r }) {
  const {
    min, max,
    rim, rimThickness,
    tickColor, majorLen, minorLen, majorWeight, minorWeight,
    showNumbers, numberSize, numberOffset, numberWeight,
    startAngle, sweepAngle,
    tickDirection, // "inward" | "outward"
    numberPlacement,
  } = p;

  const isFullCircle = Math.abs(sweepAngle) >= 360 - 0.001;
  const valueToAngle = (v) => {
    const t = (v - min) / (max - min);
    return startAngle + t * sweepAngle;
  };
  const polar = (angleDeg, radius) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
  };

  // Extend the rim-side endpoint of each tick across the rim's thickness so
  // arc endpoints close cleanly instead of leaving a corner notch.
  const rimExt = rim ? rimThickness / 2 : 0;

  const tickAt = (v, len, weight, key) => {
    const a = valueToAngle(v);
    const inner = tickDirection === "inward" ? r - len : r - rimExt;
    const outer = tickDirection === "inward" ? r + rimExt : r + len;
    const p1 = polar(a, inner);
    const p2 = polar(a, outer);
    return (
      <line
        key={key}
        x1={p1.x} y1={p1.y}
        x2={p2.x} y2={p2.y}
        stroke={tickColor}
        strokeWidth={weight}
        strokeLinecap="butt"
      />
    );
  };

  // Rim path
  let rimEl = null;
  if (rim) {
    if (isFullCircle) {
      rimEl = (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={tickColor} strokeWidth={rimThickness} />
      );
    } else {
      const a0 = startAngle;
      const a1 = startAngle + sweepAngle;
      const p0 = polar(a0, r);
      const p1 = polar(a1, r);
      const largeArc = Math.abs(sweepAngle) > 180 ? 1 : 0;
      const sweepFlag = sweepAngle >= 0 ? 1 : 0;
      const d = `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${p1.x} ${p1.y}`;
      rimEl = (
        <path d={d} fill="none" stroke={tickColor} strokeWidth={rimThickness} strokeLinecap="butt" />
      );
    }
  }

  return (
    <g>
      {rimEl}
      {ticksMinor.map((v, i) => tickAt(v, minorLen, minorWeight, `mi-${i}`))}
      {ticksMajor.map((v, i) => tickAt(v, majorLen, majorWeight, `mj-${i}`))}
      {showNumbers && ticksMajor.map((v, i) => {
        const a = valueToAngle(v);
        let rText;
        if (numberPlacement === "outside") {
          rText = r + (tickDirection === "outward" ? majorLen : 0) + numberOffset + numberSize * 0.55;
        } else {
          rText = r - (tickDirection === "inward" ? majorLen : 0) - numberOffset - numberSize * 0.55;
        }
        const pt = polar(a, rText);
        return (
          <text
            key={`n-${i}`}
            x={pt.x} y={pt.y}
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize={numberSize}
            fontWeight={numberWeight}
            fill={tickColor}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {fmtNum(v)}
          </text>
        );
      })}
    </g>
  );
}

// ---- Top-level dial ----
function Dial({ params, asExport = false }) {
  const p = params;
  const { min, max, majorStep, minorStep } = p;

  const ticksMajor = React.useMemo(() => buildTickValues(min, max, majorStep), [min, max, majorStep]);
  const ticksMinorAll = React.useMemo(() => buildTickValues(min, max, minorStep), [min, max, minorStep]);
  // Filter minor ticks that coincide with major ticks
  const ticksMinor = React.useMemo(() => {
    const eps = Math.min(majorStep, minorStep) / 1e3;
    return ticksMinorAll.filter((v) => !ticksMajor.some((m) => Math.abs(m - v) < eps));
  }, [ticksMinorAll, ticksMajor, majorStep, minorStep]);

  const inner = p.shape === "straight"
    ? <StraightDial p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor} />
    : <ArcDial p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor} />;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${p.width} ${p.height}`}
      width={asExport ? p.width : undefined}
      height={asExport ? p.height : undefined}
      style={asExport ? undefined : { width: "100%", height: "auto", maxHeight: "100%" }}
      shapeRendering="geometricPrecision"
    >
      {p.bg !== "transparent" && (
        <rect x="0" y="0" width={p.width} height={p.height} fill={p.bg} />
      )}
      {inner}
    </svg>
  );
}

window.Dial = Dial;
window.buildTickValues = buildTickValues;
