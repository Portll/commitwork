// Renders an SVG oscilloscope trace whose peak height maps the divergence score (monitor/divergence-icon.mjs oscilloscopeSVG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oscilloscopeSVG } from '../divergence-icon.mjs';

test('renders a green trace with a dot when score is measured', () => {
  const svg = oscilloscopeSVG({ score: 0.5 });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence 0.50"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#00e05a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="4,20 24,12 44,20" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="24" cy="12" r="3" fill="#00e05a"/></svg>');
});

test('renders a grey trace without a dot when measured is false', () => {
  const svg = oscilloscopeSVG({ score: 0.5, measured: false });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence not measured"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#5a5a5a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#5a5a5a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/></svg>');
});

test('renders a grey trace without a dot when score is null', () => {
  const svg = oscilloscopeSVG({ score: null });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence not measured"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#5a5a5a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#5a5a5a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/></svg>');
});

test('renders a grey trace without a dot when score is not finite', () => {
  const svg = oscilloscopeSVG({ score: Infinity });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence not measured"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#5a5a5a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#5a5a5a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/></svg>');
});

test('clamps a score above one to the peak line', () => {
  const svg = oscilloscopeSVG({ score: 1.5 });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence 1.50"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#00e05a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="4,20 24,4 44,20" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="24" cy="4" r="3" fill="#00e05a"/></svg>');
});

test('clamps a negative score to the baseline', () => {
  const svg = oscilloscopeSVG({ score: -0.5 });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence -0.50"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#00e05a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="4,20 24,20 44,20" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="24" cy="20" r="3" fill="#00e05a"/></svg>');
});

test('uses the light field color when theme is light', () => {
  const svg = oscilloscopeSVG({ score: 0.5, theme: 'light' });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence 0.50"><rect x="0" y="0" width="48" height="24" fill="#f6f7f9"/><line x1="4" y1="20" x2="44" y2="20" stroke="#00e05a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="4,20 24,12 44,20" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="24" cy="12" r="3" fill="#00e05a"/></svg>');
});

test('falls back to the dark field color for an unknown theme', () => {
  const svg = oscilloscopeSVG({ score: 0.5, theme: 'blue' });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48" height="24" role="img" aria-label="divergence 0.50"><rect x="0" y="0" width="48" height="24" fill="#0f1319"/><line x1="4" y1="20" x2="44" y2="20" stroke="#00e05a" stroke-width="1.5"/><line x1="4" y1="4" x2="44" y2="4" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="4,20 24,12 44,20" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="24" cy="12" r="3" fill="#00e05a"/></svg>');
});

test('scales the viewBox and padding for a custom size', () => {
  const svg = oscilloscopeSVG({ score: 0.5, size: 100 });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50" role="img" aria-label="divergence 0.50"><rect x="0" y="0" width="100" height="50" fill="#0f1319"/><line x1="9" y1="41" x2="91" y2="41" stroke="#00e05a" stroke-width="1.5"/><line x1="9" y1="9" x2="91" y2="9" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="9,41 50,25 91,41" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="50" cy="25" r="7" fill="#00e05a"/></svg>');
});

test('uses the minimum height of twelve for a very small size', () => {
  const svg = oscilloscopeSVG({ score: 0.5, size: 10 });
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 12" width="10" height="12" role="img" aria-label="divergence 0.50"><rect x="0" y="0" width="10" height="12" fill="#0f1319"/><line x1="2" y1="10" x2="8" y2="10" stroke="#00e05a" stroke-width="1.5"/><line x1="2" y1="2" x2="8" y2="2" stroke="#00e05a" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/><polyline points="2,10 5,6 8,10" fill="none" stroke="#00e05a" stroke-width="1.5"/><circle cx="5" cy="6" r="2" fill="#00e05a"/></svg>');
});
