// Annotated fixture for manifests/semgrep-classes/html-sink-from-state.yaml.
import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';

declare function renderDiagram(source: string): Promise<string>;
declare function sanitizeSvg(svg: string): string;

export function Stage({ source }: { source: string }) {
  const [state, setState] = useState<{ status: string; svg?: string }>({ status: 'idle' });
  useEffect(() => {
    renderDiagram(source).then((svg) => setState({ status: 'ready', svg }));
  }, [source]);
  // ruleid: cw-html-sink-from-state-js
  return <div dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

export function Thumb({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    renderDiagram(source).then(setSvg);
  }, [source]);
  // ruleid: cw-html-sink-from-state-js
  return <span dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Sanitised({ source }: { source: string }) {
  const [svg, setSvg] = useState<string>('');
  useEffect(() => {
    renderDiagram(source).then(setSvg);
  }, [source]);
  // ok: cw-html-sink-from-state-js
  return <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svg) }} />;
}

export function Helper({ source }: { source: string }) {
  const [svg, setSvg] = useState<string>('');
  useEffect(() => {
    renderDiagram(source).then(setSvg);
  }, [source]);
  // ok: cw-html-sink-from-state-js
  return <span dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />;
}

export function Constant() {
  const [n, setN] = useState(0);
  // ok: cw-html-sink-from-state-js
  return <span onClick={() => setN(n + 1)} dangerouslySetInnerHTML={{ __html: '<b>fixed</b>' }} />;
}

export function PlainState() {
  const [open, setOpen] = useState(false);
  // ok: cw-html-sink-from-state-js
  return <button onClick={() => setOpen(!open)}>{open ? 'on' : 'off'}</button>;
}

export function Imperative(source: string, host: HTMLElement) {
  renderDiagram(source).then((svg) => {
    // ruleid: cw-html-sink-from-state-js
    host.innerHTML = svg;
  });
  renderDiagram(source).then((svg) => {
    // ok: cw-html-sink-from-state-js
    host.innerHTML = DOMPurify.sanitize(svg);
  });
}

export async function Awaited(source: string, host: HTMLElement) {
  const svg = await renderDiagram(source);
  // ruleid: cw-html-sink-from-state-js
  host.insertAdjacentHTML('beforeend', svg);
}
