import { useEffect, useState } from 'react';

// Mount expensive content once it approaches the viewport; retain it while scrolling away.
export function useNearViewport() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    if (!element || isNear) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsNear(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setIsNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, isNear]);

  return { ref, isNear };
}
