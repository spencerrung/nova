import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import './styles/main.css';

import { initWasm, bootStats } from './lib/wasm';
import { setupParticles } from './demos/particles';
import { setupFractal } from './demos/fractal';
import { setupFluid } from './demos/fluid';

// ---- tab navigation ----
// Panels are display:none when inactive; each demo's IntersectionObserver
// (src/lib/lifecycle.ts) sees that and pauses its loop automatically.
const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')];
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabbar [data-tab]')];
const names = panels.map((p) => p.dataset.panel!);

function activate(name: string, updateHash = true): void {
  if (!names.includes(name)) name = 'galaxy';
  for (const p of panels) p.classList.toggle('active', p.dataset.panel === name);
  for (const t of tabs) t.classList.toggle('active', t.dataset.tab === name);
  if (updateHash) history.replaceState(null, '', name === 'galaxy' ? '#' : `#${name}`);
}

for (const t of tabs) t.addEventListener('click', () => activate(t.dataset.tab!));
window.addEventListener('hashchange', () => activate(location.hash.slice(1), false));
activate(location.hash.slice(1) || 'galaxy', false);

// ---- wasm + demos ----
function formatBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

const nova = await initWasm();

setupParticles(nova, document.getElementById('hero')!);
setupFractal(nova, document.getElementById('fractal')!);
setupFluid(nova, document.getElementById('fluid')!);

document.getElementById('stat-size')!.textContent = formatBytes(bootStats.bytes);
document.getElementById('stat-init')!.textContent = `${bootStats.initMs.toFixed(1)} ms`;
