// divergence-icon.mjs — the oscilloscope glyph for a divergence score (WORKLIST D3, operator spec).
// A baseline (0) at the bottom, a peak marker (1) at the top, a trace, and a DOT at the measured value.
//   MEASURED   = accent-green trace (a measured 0.00 is GREEN — a flat trace at the baseline, never grey).
//   UNMEASURED = muted-GREY (disabled, or one side absent) — the WHOLE glyph greys, baseline+peak included.
// The FIELD follows the panel theme (dark field on dark, light on light); state is NEVER carried by
// "black background". The numeric value is rendered by the CALLER beside the icon — the icon never
// carries the value alone. Accessible: role=img + an aria-label giving the number or "not measured".

const TRACE = { green: '#00e05a', grey: '#5a5a5a' }; // measured / unmeasured — both clear 4.5:1 on either field
const FIELD = { dark: '#0f1319', light: '#f6f7f9' };

// oscilloscopeSVG({ score, measured, theme, size }) -> a self-contained <svg> string.
// measured defaults to (score != null); pass measured:false to force the disabled/grey state.
export function oscilloscopeSVG({ score = null, measured = score != null, theme = 'dark', size = 48 } = {}) {
  const on = measured && score != null && Number.isFinite(score);
  const w = size, h = Math.max(12, Math.round(size * 0.5));
  const stroke = on ? TRACE.green : TRACE.grey;
  const field = FIELD[theme] || FIELD.dark;
  const pad = Math.max(2, Math.round(size * 0.09));
  const y0 = h - pad, y1 = pad;                       // baseline (0) at the bottom .. peak (1) at the top
  const clamped = on ? Math.max(0, Math.min(1, score)) : null;
  const dotY = clamped == null ? null : y0 + (y1 - y0) * clamped;
  const label = on ? `divergence ${score.toFixed(2)}` : 'divergence not measured';
  const parts = [
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${field}"/>`,
    `<line x1="${pad}" y1="${y0}" x2="${w - pad}" y2="${y0}" stroke="${stroke}" stroke-width="1.5"/>`,                       // baseline 0
    `<line x1="${pad}" y1="${y1}" x2="${w - pad}" y2="${y1}" stroke="${stroke}" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/>`, // peak 1
  ];
  if (dotY != null) {
    parts.push(`<polyline points="${pad},${y0} ${w / 2},${dotY} ${w - pad},${y0}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`); // the trace, peaking at the value
    parts.push(`<circle cx="${w / 2}" cy="${dotY}" r="${Math.max(2, Math.round(size * 0.07))}" fill="${stroke}"/>`);                     // the dot
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}

// The state token, for callers that render the value + label themselves (colour is never the only signal).
export const iconState = ({ score = null, measured = score != null } = {}) =>
  (measured && score != null && Number.isFinite(score)) ? 'measured' : 'not-measured';
