import { useEffect, useState } from 'react';

/**
 * The rendered width of a chart's container.
 *
 * Charts here are drawn at measured pixel size rather than scaled to fit with a
 * `viewBox`, because a scaled viewBox scales the *type* with it: an axis label
 * set at 12px on a 1100px desktop plot arrives at 4px on a 375px phone. That is
 * the single most common way a "responsive" chart stops being readable, and it
 * would land straight on #18.
 *
 * Measuring costs a render — the first pass draws at `fallback`, the observer
 * then reports the real width — which is why the fallback is a plausible
 * desktop width rather than 0. A chart that flashed at zero width would be a
 * layout jump on every mount.
 */
export function useChartWidth(fallback = 640) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    if (!node) return;
    // jsdom implements no ResizeObserver, so the test suite renders every chart
    // at `fallback`. That is the right behaviour rather than a gap: the tests
    // assert structure, labels and the table view, none of which depend on the
    // measured width, and a stubbed observer would only be asserting the stub.
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref: setNode, width };
}
