import React, { useEffect, useState } from 'react';
import './content-studio-intro.css';

const INTRO_DURATION = 2700;

export default function ContentStudioIntro({ onComplete }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const leaveAfter = window.setTimeout(() => setLeaving(true), reducedMotion ? 80 : 2320);
    const completeAfter = window.setTimeout(() => onComplete?.(), reducedMotion ? 180 : INTRO_DURATION);
    return () => {
      window.clearTimeout(leaveAfter);
      window.clearTimeout(completeAfter);
    };
  }, [onComplete]);

  return <div className={`csi-intro ${leaving ? 'csi-leaving' : ''}`} role="status" aria-label="Preparando Estudios Creativos">
    <div className="csi-grain" aria-hidden="true" />
    <div className="csi-stage" aria-hidden="true">
      <div className="csi-aura" />
      <img className="csi-wordmark" src="/content-studio/brand/estudios-creativos-wordmark.webp" alt="" fetchPriority="high" />
      <div className="csi-touch-point"><i /><i /><i /></div>
      <img className="csi-mascot csi-mascot-touch" src="/content-studio/brand/mascota-toque.webp" alt="" fetchPriority="high" />
      <img className="csi-mascot csi-mascot-return" src="/content-studio/brand/mascota-regreso.webp" alt="" />
    </div>
    <p>UN TOQUE DE MAGIA</p>
  </div>;
}
