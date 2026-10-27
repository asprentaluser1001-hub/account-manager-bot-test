import {useEffect, useRef} from 'react';

// Animate the mounted content without remounting forms or issuing extra requests.
export function useTabMotion<T extends HTMLElement = HTMLDivElement>(tab: string, ready = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!ready || !node || reduced.matches || typeof node.animate !== 'function') return;
    const animation = node.animate([
      {opacity: .65, transform: 'translateY(9px)'},
      {opacity: 1, transform: 'translateY(0)'},
    ], {duration: 230, easing: 'cubic-bezier(.2,.75,.25,1)'});
    const stop = () => { if (reduced.matches) animation.cancel(); };
    reduced.addEventListener('change', stop);
    return () => {
      animation.cancel();
      reduced.removeEventListener('change', stop);
    };
  }, [tab, ready]);
  return ref;
}
