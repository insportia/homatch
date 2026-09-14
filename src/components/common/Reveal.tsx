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
  children, delayIndex = 0, className, style, as: Tag = 'div', ...rest
}: {
  children: React.ReactNode;
  /** Position within a group, for staggering. No effect where stagger is 0. */
  delayIndex?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
  /**
   * Anything else is forwarded to the element.
   *
   * Site Studio marks the element that renders a repeated child so it can be
   * found and given its own controls. Without this, a card wrapped in Reveal
   * would be the one kind of content the editor could not address — the
   * attributes would be accepted here and silently dropped.
   */
} & React.HTMLAttributes<HTMLElement>) {
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

    /*
     * Already on screen at mount, so there is nothing to wait for and waiting
     * would delay the content of the first paint.
     *
     * The threshold is 60% of the viewport, not 100%. At 100% anything merely
     * POKING into the bottom edge counted as "already visible" and was shown
     * final immediately -- and on a phone, where sections are tall and stack
     * one per screen, that was most of them. The reveal ran for nobody: by
     * the time the reader scrolled down, every section had already arrived.
     */
    if (el.getBoundingClientRect().top < window.innerHeight * 0.6) { setShown(true); return; }

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        setShown(true);
        io.disconnect();
      }
      /*
       * WHERE THE TRIGGER LINE SITS, AND WHY IT MOVED.
       *
       * It was -10%, which puts the line 90% of the way down the viewport.
       * On a phone that fires when roughly eighty pixels of a section has
       * appeared above the bottom edge — and the animation then runs for
       * 480ms on a strip of the section the reader has not arrived at yet.
       * By the time the words are in front of them, the reveal is over.
       * Technically it ran. Nobody saw it, which is the complaint.
       *
       * -30% puts the line at 70% of the viewport, so roughly a third of a
       * screen of the section is showing before it starts. The reveal then
       * plays across content the eye is actually on. The 0.6 shortcut above
       * is the same idea from the other direction, and the two agree.
       */
    }, { rootMargin: '0px 0px -30% 0px', threshold: 0.02 });

    io.observe(el);
    return () => io.disconnect();
  }, [animated]);

  if (!animated) return createElement(Tag, { className, style, ...rest }, children);

  /*
   * createElement rather than <Tag …>: with a polymorphic tag, JSX resolves
   * the ref's type to the INTERSECTION of every element it could be, which
   * no single ref can satisfy. This keeps one honest HTMLElement ref.
   */
  return createElement(
    Tag,
    {
      ...rest,
      ref,
      className,
      style: {
        /*
         * The caller's own properties first, the motion's on top.
         *
         * Reveal used to replace `style` outright, which was invisible until
         * something needed to pass one: a Site Studio style preset sets
         * --hm-measure on the same element, and dropping it silently made
         * the width control do nothing on the public site while working in
         * the editor. Opacity, transform and transition stay Reveal's —
         * those ARE the reveal, and nothing else may set them.
         */
        ...style,
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
