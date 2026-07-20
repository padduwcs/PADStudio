import {useLayoutEffect, useRef, type ReactNode} from 'react';

type HeadingLevel = 'h1' | 'h2';

export function AdaptiveHeading({
  as: Tag,
  children,
  className,
  singleLineMinRatio = 0.88,
}: {
  as: HeadingLevel;
  children: ReactNode;
  className?: string;
  singleLineMinRatio?: number;
}) {
  const elementRef = useRef<HTMLHeadingElement | null>(null);

  useLayoutEffect(() => {
    const heading = elementRef.current!;
    if (!heading) return;

    const container = heading.parentElement;
    if (!container) return;

    let animationFrame = 0;

    function resetStyles() {
      heading.style.removeProperty('font-size');
      heading.style.removeProperty('white-space');
    }

    function fitText() {
      resetStyles();

      const availableWidth = heading.clientWidth;
      const preferredSize = Number.parseFloat(
        window.getComputedStyle(heading).fontSize,
      );

      if (!availableWidth || !preferredSize) return;

      // Narrow layouts read better with a deliberate natural wrap. Trying to
      // force a single line here can also leave a heading clipped for one
      // frame while a responsive panel or the mobile viewport is resizing.
      if (availableWidth < 560) return;

      heading.style.whiteSpace = 'nowrap';
      heading.style.fontSize = `${preferredSize}px`;

      if (heading.scrollWidth <= availableWidth + 1) return;

      const minimumSize = preferredSize * singleLineMinRatio;
      heading.style.fontSize = `${minimumSize}px`;

      if (heading.scrollWidth > availableWidth + 1) {
        resetStyles();
        return;
      }

      let lowerBound = minimumSize;
      let upperBound = preferredSize;

      for (let index = 0; index < 8; index += 1) {
        const candidate = (lowerBound + upperBound) / 2;
        heading.style.fontSize = `${candidate}px`;

        if (heading.scrollWidth <= availableWidth + 1) {
          lowerBound = candidate;
        } else {
          upperBound = candidate;
        }
      }

      heading.style.fontSize = `${lowerBound}px`;
    }

    function scheduleFit() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(fitText);
    }

    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);
    scheduleFit();
    void document.fonts?.ready.then(scheduleFit);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      resetStyles();
    };
  }, [children, singleLineMinRatio]);

  return (
    <Tag
      className={`adaptive-text${className ? ` ${className}` : ''}`}
      ref={(element) => {
        elementRef.current = element;
      }}
    >
      {children}
    </Tag>
  );
}
