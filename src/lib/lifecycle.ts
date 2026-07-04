const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export interface LoopHandle {
  destroy(): void;
}

/**
 * Runs `tick` on requestAnimationFrame only while `section` is on screen and
 * the tab is visible. Under prefers-reduced-motion the loop starts paused
 * behind a play button. This is what keeps three sims on one page cheap.
 */
export function runWhenVisible(section: HTMLElement, tick: (dt: number) => void): LoopHandle {
  let raf = 0;
  let last = 0;
  let visible = false;
  let userPaused = reducedMotion.matches;

  if (userPaused) {
    const btn = document.createElement('button');
    btn.className = 'demo-play';
    btn.type = 'button';
    btn.textContent = '▶ Run simulation';
    btn.addEventListener('click', () => {
      userPaused = false;
      btn.remove();
      update();
    });
    section.append(btn);
  }

  const frame = (t: number) => {
    raf = 0;
    const dt = last === 0 ? 1 / 60 : Math.min((t - last) / 1000, 1 / 30);
    last = t;
    tick(dt);
    schedule();
  };

  const schedule = () => {
    if (visible && !document.hidden && !userPaused && raf === 0) {
      raf = requestAnimationFrame(frame);
    }
  };

  const update = () => {
    if (visible && !document.hidden && !userPaused) {
      last = 0;
      schedule();
    } else if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      update();
    },
    { threshold: 0.15 },
  );
  io.observe(section);
  document.addEventListener('visibilitychange', update);

  return {
    destroy() {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
      if (raf !== 0) cancelAnimationFrame(raf);
    },
  };
}
