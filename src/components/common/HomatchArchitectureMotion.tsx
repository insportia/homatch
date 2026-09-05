import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Building2, FileCheck2, ScanSearch, ShieldCheck } from 'lucide-react';

export const HomatchArchitectureMotion: React.FC = () => {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pathname !== '/') return;
    const onScroll = () => setVisible(window.scrollY < Math.max(760, window.innerHeight * 1.05));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  if (pathname !== '/') return null;

  return (
    <div className={`hm-architecture ${visible ? 'is-active' : ''}`} aria-hidden="true">
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
