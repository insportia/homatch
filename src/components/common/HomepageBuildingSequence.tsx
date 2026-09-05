import React, { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { Building2, FileCheck2, ScanSearch, ShieldCheck } from 'lucide-react';

const FLOOR_COUNT = 9;

function Floor({ index, progress, reduced }: { index: number; progress: any; reduced: boolean | null }) {
  const center = (FLOOR_COUNT - 1) / 2;
  const distance = index - center;
  const y = useTransform(progress, [0, 0.18, 0.62, 1], [0, 0, distance * 23, distance * 38]);
  const x = useTransform(progress, [0, 0.62, 1], [0, index % 2 === 0 ? distance * 2.4 : distance * -2.1, distance * 3.2]);
  const rotateZ = useTransform(progress, [0, 0.62, 1], [0, distance * 0.18, distance * 0.35]);
  const opacity = useTransform(progress, [0, 0.08, 0.82, 1], [0.72, 1, 1, 0.78]);
  const ry = reduced ? 0 : y;
  const rx = reduced ? 0 : x;
  const rr = reduced ? 0 : rotateZ;

  return (
    <motion.div
      className="absolute left-1/2 w-[250px] sm:w-[330px] md:w-[410px] -translate-x-1/2"
      style={{ top: `${64 + index * 29}px`, y: ry, x: rx, rotateZ: rr, opacity }}
    >
      <div className="relative h-[28px] md:h-[34px] rounded-[3px] border border-primary/55 bg-card/95 shadow-[0_8px_30px_hsl(var(--background)/0.7),0_0_18px_hsl(var(--primary)/0.05)] overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
        <div className="absolute inset-0 grid grid-cols-7 gap-[3px] px-3 py-1.5">
          {Array.from({ length: 7 }).map((_, j) => (
            <div key={j} className="rounded-[1px] border border-primary/10 bg-primary/[0.035] relative overflow-hidden">
              {(j + index) % 3 === 0 && <div className="absolute inset-0 bg-primary/[0.10]" />}
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto h-[5px] w-[94%] bg-gradient-to-b from-primary/20 to-transparent opacity-60" />
    </motion.div>
  );
}

export const HomepageBuildingSequence: React.FC = () => {
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 28, mass: 0.35 });

  const buildingScale = useTransform(progress, [0, 0.18, 0.62, 1], [0.88, 1, 1.03, 0.92]);
  const buildingRotateX = useTransform(progress, [0, 0.22, 0.7, 1], [5, 0, -2, -4]);
  const buildingY = useTransform(progress, [0, 0.55, 1], [35, 0, -18]);
  const haloScale = useTransform(progress, [0, 0.45, 1], [0.72, 1.05, 1.24]);
  const haloOpacity = useTransform(progress, [0, 0.3, 0.78, 1], [0.12, 0.42, 0.26, 0.05]);
  const scanY = useTransform(progress, [0.08, 0.78], [80, 430]);
  const scanOpacity = useTransform(progress, [0, 0.1, 0.78, 0.9], [0, 0.9, 0.9, 0]);
  const chipOpacity = useTransform(progress, [0.28, 0.45, 0.82, 0.94], [0, 1, 1, 0]);
  const chipScale = useTransform(progress, [0.28, 0.45], [0.86, 1]);

  if (location.pathname !== '/') return null;

  return (
    <section ref={sectionRef} aria-label="Homatch property intelligence visualization" className="relative h-[185vh] md:h-[220vh] border-y border-border bg-background">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] min-h-[560px] overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 pointer-events-none">
          <motion.div style={{ scale: haloScale, opacity: haloOpacity }} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[76vw] max-w-[920px] aspect-square rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.18)_0%,hsl(var(--primary)/0.05)_32%,transparent_68%)]" />
          <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(hsl(var(--primary)/0.22)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--primary)/0.22)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />
        </div>

        <motion.div
          className="relative w-[330px] h-[500px] sm:w-[430px] md:w-[560px] md:h-[560px] [perspective:1100px]"
          style={{ scale: reduced ? 1 : buildingScale, y: reduced ? 0 : buildingY, rotateX: reduced ? 0 : buildingRotateX }}
        >
          <motion.div className="absolute left-1/2 top-[44px] -translate-x-1/2 w-[270px] sm:w-[350px] md:w-[430px] h-[360px] rounded-[10px] border border-primary/15" style={{ opacity: haloOpacity }} />
          <motion.div className="absolute left-1/2 top-0 -translate-x-1/2 w-[2px] h-[470px] bg-gradient-to-b from-transparent via-primary/35 to-transparent" style={{ opacity: haloOpacity }} />

          {Array.from({ length: FLOOR_COUNT }).map((_, i) => (
            <Floor key={i} index={i} progress={progress} reduced={reduced} />
          ))}

          <motion.div
            className="absolute left-1/2 -translate-x-1/2 w-[300px] sm:w-[390px] md:w-[470px] h-px bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_16px_hsl(var(--primary)/0.75)] z-20"
            style={{ y: reduced ? 250 : scanY, opacity: reduced ? 0 : scanOpacity }}
          />

          <motion.div style={{ opacity: chipOpacity, scale: chipScale }} className="absolute left-[-8px] md:left-[-70px] top-[150px] flex items-center gap-2 rounded-xl border border-primary/25 bg-card/90 backdrop-blur-md px-3 py-2 shadow-xl">
            <ScanSearch className="h-4 w-4 text-primary" /><span className="h-1.5 w-12 rounded-full bg-primary/35" />
          </motion.div>
          <motion.div style={{ opacity: chipOpacity, scale: chipScale }} className="absolute right-[-8px] md:right-[-76px] top-[235px] flex items-center gap-2 rounded-xl border border-primary/25 bg-card/90 backdrop-blur-md px-3 py-2 shadow-xl">
            <FileCheck2 className="h-4 w-4 text-primary" /><span className="h-1.5 w-14 rounded-full bg-primary/35" />
          </motion.div>
          <motion.div style={{ opacity: chipOpacity, scale: chipScale }} className="absolute left-[8px] md:left-[-48px] bottom-[74px] flex items-center gap-2 rounded-xl border border-primary/25 bg-card/90 backdrop-blur-md px-3 py-2 shadow-xl">
            <ShieldCheck className="h-4 w-4 text-primary" /><span className="h-1.5 w-10 rounded-full bg-primary/35" />
          </motion.div>
        </motion.div>

        <div className="absolute top-7 md:top-10 left-1/2 -translate-x-1/2 flex items-center gap-2 text-primary/80 pointer-events-none">
          <Building2 className="h-4 w-4" />
          <span className="text-[10px] md:text-xs font-semibold tracking-[0.24em] uppercase whitespace-nowrap">Homatch Intelligence</span>
        </div>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-24 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      </div>
    </section>
  );
};
