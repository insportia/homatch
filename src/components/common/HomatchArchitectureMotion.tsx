import React, { useEffect, useRef, useState } from 'react';
import { Building2, FileCheck2, ScanSearch, ShieldCheck } from 'lucide-react';

export const HomatchArchitectureMotion: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setActive(true); return; }
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold: 0.22 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`hm-architecture ${active ? 'is-active' : ''}`} aria-hidden="true">
      <div className="hm-architecture__aura" />
      <div className="hm-architecture__grid" />
      <div className="hm-architecture__orbit hm-architecture__orbit--one" />
      <div className="hm-architecture__orbit hm-architecture__orbit--two" />
      <div className="hm-architecture__building">
        <div className="hm-architecture__roof" />
        {[0,1,2,3,4,5].map((floor) => (
          <div className="hm-architecture__floor" style={{ '--floor': floor } as React.CSSProperties} key={floor}>
            <span /><span /><span /><span />
          </div>
        ))}
        <div className="hm-architecture__base" />
        <div className="hm-architecture__scan" />
      </div>
      <div className="hm-architecture__signal hm-architecture__signal--a"><ScanSearch /></div>
      <div className="hm-architecture__signal hm-architecture__signal--b"><FileCheck2 /></div>
      <div className="hm-architecture__signal hm-architecture__signal--c"><ShieldCheck /></div>
      <div className="hm-architecture__core"><Building2 /></div>
    </div>
  );
};
