import React, { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { Building2, Check, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { publishingStatusKey } from './presentation';
import './publishing.css';
export interface OrbitDestination {
  id: string;
  name: string;
  state?: string;
  selected?: boolean;
}
export function PublishingOrbit({
  destinations,
  illustrative = false,
}: {
  destinations: OrbitDestination[];
  illustrative?: boolean;
}) {
  const { t } = useLanguage();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0.2 });
  const nodes = destinations.slice(0, 10).map((portal, i, all) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / all.length;
    return {
      ...portal,
      x: 250 + Math.cos(angle) * 195,
      y: 200 + Math.sin(angle) * 145,
    };
  });
  return (
    <div
      ref={ref}
      className={`pub-orbit ${illustrative ? 'pub-orbit-preview' : ''}`}
    >
      <div className="pub-orbit-halo" aria-hidden="true" />
      <svg viewBox="0 0 500 400" className="pub-orbit-paths" aria-hidden="true">
        <defs>
          <linearGradient
            id={illustrative ? 'pub-ray-preview' : 'pub-ray-live'}
          >
            <stop stopColor="#b89860" stopOpacity=".15" />
            <stop offset="1" stopColor="#e1c28b" stopOpacity=".8" />
          </linearGradient>
        </defs>
        {nodes.map((portal) => {
          const active =
            !illustrative &&
            ['connecting', 'uploading', 'submitting', 'reconciling'].includes(
              portal.state ?? '',
            );
          return (
            <g key={portal.id}>
              <path
                d={`M250 200 Q${portal.x} 200 ${portal.x} ${portal.y}`}
                fill="none"
                stroke={`url(#${illustrative ? 'pub-ray-preview' : 'pub-ray-live'})`}
                strokeWidth={portal.selected ? 1.8 : 1}
                opacity={portal.selected || illustrative ? 1 : 0.25}
              />
              {(active || illustrative) && (
                <motion.path
                  d={`M250 200 Q${portal.x} 200 ${portal.x} ${portal.y}`}
                  fill="none"
                  stroke="#e8d1a7"
                  strokeWidth="2"
                  strokeDasharray="8 22"
                  animate={
                    visible && !reduced
                      ? {
                          strokeDashoffset: [0, -60],
                          opacity: [0.2, 0.65, 0.2],
                        }
                      : { opacity: 0.35 }
                  }
                  transition={{
                    duration: 4,
                    repeat: visible && !reduced ? Infinity : 0,
                    ease: 'linear',
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="pub-orbit-property" aria-hidden="true">
        <div className="pub-property-roof" />
        <div className="pub-property-wall">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="pub-property-plinth" />
        <span className="pub-property-brand">HOMATCH</span>
      </div>
      {nodes.map((portal) => (
        <motion.div
          key={portal.id}
          className={`pub-orbit-node ${portal.selected ? 'is-selected' : ''}`}
          style={{ left: `${portal.x / 5}%`, top: `${portal.y / 4}%` }}
          whileHover={reduced ? undefined : { scale: 1.035 }}
        >
          <span className="pub-node-icon" aria-hidden="true">
            {portal.state === 'published' ? (
              <Check size={14} />
            ) : ['failed', 'action_required'].includes(portal.state ?? '') ? (
              <AlertCircle size={14} />
            ) : (
              <Building2 size={14} />
            )}
          </span>
          <strong dir="ltr">{portal.name}</strong>
          {!illustrative && portal.state && (
            <span>{t(publishingStatusKey(portal.state))}</span>
          )}
        </motion.div>
      ))}
      {illustrative && (
        <p className="pub-orbit-caption">{t('pub_illustration')}</p>
      )}
    </div>
  );
}
