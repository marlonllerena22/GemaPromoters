import React, { useEffect, useState } from 'react';
import './content-studio-intro.css';

const INTRO_DURATION = 3400;

export default function ContentStudioIntro({ onComplete }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const frame = window.requestAnimationFrame(() => setPlaying(true));
    const completeAfter = window.setTimeout(() => onComplete?.(), reducedMotion ? 160 : INTRO_DURATION);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(completeAfter);
    };
  }, [onComplete]);

  return <div className={`csi-intro ${playing ? 'csi-play' : ''}`} role="status" aria-label="Preparando Estudios Creativos">
    <div className="csi-atmosphere" aria-hidden="true" />
    <div className="csi-stage" aria-hidden="true">
      <div className="csi-wizard-wrap">
        <img className="csi-wizard csi-wizard-diag" src="/content-studio/brand/mascota-toque.webp" alt="" fetchPriority="high" />
        <img className="csi-wizard csi-wizard-wink" src="/content-studio/brand/mascota-regreso.webp" alt="" fetchPriority="high" />
      </div>
      <img className="csi-wordmark" src="/content-studio/brand/estudios-creativos-wordmark.webp" alt="" fetchPriority="high" />
      <span className="csi-spark" />
      <span className="csi-micro-spark" />
    </div>
    <div className="csi-flash" aria-hidden="true" />
  </div>;
}
