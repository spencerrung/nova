export class Hud {
  readonly el: HTMLElement;
  private fields = new Map<string, HTMLElement>();
  private fpsEma = 0;
  private simEma = 0;

  constructor(host: HTMLElement, labels: string[]) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    for (const label of labels) {
      const row = document.createElement('div');
      row.className = 'hud-row';
      const l = document.createElement('span');
      l.className = 'hud-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'hud-value';
      v.textContent = '—';
      row.append(l, v);
      this.el.append(row);
      this.fields.set(label, v);
    }
    host.append(this.el);
  }

  set(label: string, value: string): void {
    const f = this.fields.get(label);
    if (f) f.textContent = value;
  }

  /** Call once per animation frame; smooths fps and sim time. */
  frame(dt: number, simMs: number): void {
    const fps = 1 / Math.max(dt, 1e-4);
    this.fpsEma = this.fpsEma === 0 ? fps : this.fpsEma * 0.95 + fps * 0.05;
    this.simEma = this.simEma === 0 ? simMs : this.simEma * 0.9 + simMs * 0.1;
    this.set('fps', this.fpsEma.toFixed(0));
    this.set('sim', `${this.simEma.toFixed(2)} ms`);
  }
}
