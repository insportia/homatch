import React from 'react';
import { motion, type Variants } from 'motion/react';

interface MotionRevealProps {
  children: React.ReactNode;
  className?: string;
  /** Extra delay in the stagger sequence, seconds. */
  delay?: number;
  /** 'inView' (default) plays once when scrolled into view; 'mount' plays immediately. */
  mode?: 'inView' | 'mount';
  /** Slightly larger travel/blur for section headings vs body content. */
  distance?: number;
  as?: keyof typeof motion;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Restrained, reusable scroll/mount reveal: opacity + small Y + a touch of
 * blur, nothing that flies across the screen. Transform/opacity/filter only
 * (filter is applied on a small, short-lived transition per element, never
 * on a huge continuously-animated surface, so it stays compositor-cheap).
 */
export function MotionReveal({ children, className, delay = 0, mode = 'inView', distance = 16 }: MotionRevealProps) {
  const variants: Variants = {
    hidden: { opacity: 0, y: distance, filter: 'blur(6px)' },
    shown: { opacity: 1, y: 0, filter: 'blur(0px)' },
  };

  const shared = {
    className,
    variants,
    initial: 'hidden',
    transition: { duration: 0.6, ease: EASE, delay },
  } as const;

  if (mode === 'mount') {
    return (
      <motion.div {...shared} animate="shown">
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      {...shared}
      whileInView="shown"
      viewport={{ once: true, margin: '-10% 0px -10% 0px' }}
    >
      {children}
    </motion.div>
  );
}
