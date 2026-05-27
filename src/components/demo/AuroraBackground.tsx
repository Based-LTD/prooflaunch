'use client';

// Aurora gradient drift — three large blurred gradient blobs in the
// gold/amber brand palette that slowly translate + scale on long
// (30-40s) loops. Reads as atmospheric, calm, premium. Different
// category entirely from pumptracks' floating particles.

export const AuroraBackground = () => (
  <>
    <style>{`
      @keyframes aurora-drift-1 {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        33%      { transform: translate3d(12vw, 8vh, 0) scale(1.18); }
        66%      { transform: translate3d(-10vw, 14vh, 0) scale(0.92); }
      }
      @keyframes aurora-drift-2 {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        50%      { transform: translate3d(-18vw, 18vh, 0) scale(1.25); }
      }
      @keyframes aurora-drift-3 {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
        50%      { transform: translate3d(14vw, -8vh, 0) scale(1.12); }
      }
      @media (prefers-reduced-motion: reduce) {
        .aurora-blob { animation: none !important; }
      }
    `}</style>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: -1,
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    >
      <div
        className="aurora-blob"
        style={{
          position: 'absolute',
          top: '-10%',
          left: '15%',
          width: '50vw',
          height: '50vw',
          background: 'radial-gradient(circle, rgba(255,157,0,0.45) 0%, transparent 60%)',
          filter: 'blur(80px)',
          animation: 'aurora-drift-1 30s ease-in-out infinite',
        }}
      />
      <div
        className="aurora-blob"
        style={{
          position: 'absolute',
          top: '30%',
          right: '-10%',
          width: '45vw',
          height: '45vw',
          background: 'radial-gradient(circle, rgba(255,184,77,0.38) 0%, transparent 60%)',
          filter: 'blur(90px)',
          animation: 'aurora-drift-2 40s ease-in-out infinite',
        }}
      />
      <div
        className="aurora-blob"
        style={{
          position: 'absolute',
          bottom: '-15%',
          left: '5%',
          width: '50vw',
          height: '50vw',
          background: 'radial-gradient(circle, rgba(204,102,0,0.40) 0%, transparent 60%)',
          filter: 'blur(85px)',
          animation: 'aurora-drift-3 35s ease-in-out infinite',
        }}
      />
    </div>
  </>
);
