import {useLayoutEffect, useRef} from 'react';

// One persistent pill moves between the selected buttons; content stays mounted.
export function useSlidingIndicator(selection: string) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const measure = () => {
      const selected = nav.querySelector<HTMLButtonElement>('button[aria-current="page"]');
      if (!selected || !selected.offsetWidth || !selected.offsetHeight) {
        nav.style.setProperty('--pill-visible', '0');
        return;
      }
      nav.style.setProperty('--pill-x', `${selected.offsetLeft}px`);
      nav.style.setProperty('--pill-y', `${selected.offsetTop}px`);
      nav.style.setProperty('--pill-width', `${selected.offsetWidth}px`);
      nav.style.setProperty('--pill-height', `${selected.offsetHeight}px`);
      nav.style.setProperty('--pill-visible', '1');
    };
    measure();
    // Place the first pill immediately; subsequent selections glide from there.
    const frame = requestAnimationFrame(() => { nav.dataset.pillReady = 'true'; });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(nav);
    nav.querySelectorAll('button').forEach(button => observer?.observe(button));
    window.addEventListener('resize', measure);
    let disposed = false;
    document.fonts?.ready.then(() => { if (!disposed) measure(); });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [selection]);
  return ref;
}
