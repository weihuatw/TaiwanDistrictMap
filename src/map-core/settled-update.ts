import type { Map } from 'maplibre-gl';

/** Keep only the newest update and run it in a frame after camera movement ends. */
export function createSettledUpdate(map: Pick<Map, 'isMoving' | 'on' | 'off'>) {
  let pending: (() => void) | null = null;
  let frame = 0;
  let alive = true;
  const flush = () => {
    frame = 0;
    if (!alive || map.isMoving() || !pending) return;
    const update = pending; pending = null;
    update();
  };
  const schedule = () => {
    if (alive && pending && !frame && !map.isMoving()) frame = requestAnimationFrame(flush);
  };
  const cancel = () => {
    pending = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  map.on('moveend', schedule);
  return {
    get pending() { return pending !== null; },
    queue(update: () => void) { if (alive) { pending = update; schedule(); } },
    cancel,
    destroy() { alive = false; cancel(); map.off('moveend', schedule); },
  };
}
