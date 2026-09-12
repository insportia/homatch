import React, { createElement, useEffect, useRef, useState } from 'react';
import { useMotion } from '@/hooks/useMotion';
import { EASING, revealShape } from '@/lib/motion';

/**
 * Something that arrives as you reach it.
 *
 * WHY IT IS SAFE TO WRAP ANYTHING IN THIS
 *
 * The failure mode of scroll-reveal is content that never appears: the
 * observer does not fire, or fires before layout, or the element starts life
 * inside an ancestor that was hidden, and the page is left with a blank space
 * where a paragraph should be. Nobody notices in development, because
 * development scrolls.
 *
 * So this is built to fail visible rather than fail hidden:
 *
 *   - At motion level 'none' it renders its children in a plain wrapper with
 *     no opacity, no transform and no observer at all. Reduced motion and
 *     data-saver therefore cannot produce an invisible page.
 *   - When IntersectionObserver is missing, it shows immediately.
 *   - Anything already on screen at mount shows immediately, rather than
 *     waiting for a scroll that may never come on a short page.
 *   - It reveals once and stops observing. Content does not un-reveal when
 *     scrolled past, which would mean a page that flickers on the way back.
 *
 * `delayIndex` staggers a group. It has no effect on phones, where the
 * stagger is zero — the last card of a staggered list on a small screen
 * arrives late enough to read as a bug.
 */
export function Reveal({
  children, delayIndex = 0, className, as: Tag = 'div',
}: {
  children: React.ReactNode;
  /** Position within a group, for staggering. No effect where stagger is 0. */
  delayIndex?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const level = useMotion();
  const shape = revealShape(level);
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  const animated = shape.duration > 0;

  useEffect(() => {
    if (!animated) return;
    const el = ref.current;
    // No element, or a browser without the API: show it and move on.
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return; }

    // Already on screen at mount — above the fold — so there is nothing to
    // wait for, and waiting would delay the content of the first paint.
    if (el.getBoundingClientRect().top < window.innerHeight) { setShown(true); return; }

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        setShown(true);
        io.disconnect();
      }
      // A negative bottom margin so the element finishes arriving as it comes
      // into view, rather than starting only once it is already fully visible.
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });

    io.observe(el);
    return () => io.disconnect();
  }, [animated]);

  if (!animated) return createElement(Tag, { className }, children);

  /*
   * createElement rather than <Tag …>: with a polymorphic tag, JSX resolves
   * the ref's type to the INTERSECTION of every element it could be, which
   * no single ref can satisfy. This keeps one honest HTMLElement ref.
   */
  return createElement(
    Tag,
    {
      ref,
      className,
      style: {
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${shape.distance}px)`,
        transition: `opacity ${shape.duration}ms ${EASING.enter} ${delayIndex * shape.stagger}ms, `
          + `transform ${shape.duration}ms ${EASING.enter} ${delayIndex * shape.stagger}ms`,
        // Dropped once the element has arrived: a permanent will-change keeps
        // a compositor layer alive for every revealed block on the page.
        willChange: shown ? undefined : 'opacity, transform',
      } as React.CSSProperties,
    },
    children,
  );
}
