'use client';

// Real 3D scene — react-three-fiber + three.js.
// Multiple concentric gold rings at varying tilts rotating slowly,
// real metallic material with emissive glow, fog for depth, subtle
// camera drift for cinematic feel. No postprocessing dep — glow is
// achieved via high emissive intensity + dark scene + light contrast.
// Reads as designed product (not generative dots) immediately.

import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const GOLD = '#ff9d00';
const AMBER = '#cc6600';
const CREAM = '#ffd9a3';

interface RingProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  ringRadius: number;
  tubeRadius: number;
  color: string;
  rotSpeed: [number, number, number];
  emissiveIntensity?: number;
}

function GoldenRing({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  ringRadius,
  tubeRadius,
  color,
  rotSpeed,
  emissiveIntensity = 0.9,
}: RingProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.x += rotSpeed[0] * dt;
    ref.current.rotation.y += rotSpeed[1] * dt;
    ref.current.rotation.z += rotSpeed[2] * dt;
  });
  return (
    <mesh ref={ref} position={position} rotation={rotation}>
      <torusGeometry args={[ringRadius, tubeRadius, 24, 160]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={emissiveIntensity}
        metalness={0.85}
        roughness={0.18}
        toneMapped={false}
      />
    </mesh>
  );
}

function CameraDrift() {
  const { camera } = useThree();
  const targetRef = useRef(new THREE.Vector3(0, 0, 0));
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Slow Lissajous orbit — never repeats exactly
    camera.position.x = Math.sin(t * 0.10) * 0.55 + Math.cos(t * 0.07) * 0.25;
    camera.position.y = Math.cos(t * 0.08) * 0.45 + Math.sin(t * 0.05) * 0.20;
    camera.position.z = 8 + Math.sin(t * 0.06) * 0.3;
    camera.lookAt(targetRef.current);
  });
  return null;
}

function Scene() {
  return (
    <>
      {/* Lighting — multiple warm lights for depth + variance */}
      <ambientLight intensity={0.08} />
      <pointLight position={[6, 5, 6]} intensity={3.0} color={GOLD} distance={20} />
      <pointLight position={[-6, -4, 4]} intensity={2.2} color={AMBER} distance={20} />
      <pointLight position={[0, 0, -4]} intensity={1.5} color={CREAM} distance={20} />

      {/* Fog gives the rings depth — closer rings sharp, distant fade to bg */}
      <fog attach="fog" args={['#0a0a0a', 6, 18]} />

      {/* Six rings at different tilts, sizes, speeds, and color tones */}
      <GoldenRing
        rotation={[0.4, 0, 0]}
        ringRadius={3.4}
        tubeRadius={0.045}
        color={GOLD}
        rotSpeed={[0.04, 0.09, 0]}
      />
      <GoldenRing
        rotation={[1.2, 0.5, 0]}
        ringRadius={2.7}
        tubeRadius={0.040}
        color={AMBER}
        rotSpeed={[0.08, -0.06, 0.04]}
        emissiveIntensity={0.7}
      />
      <GoldenRing
        rotation={[0, 1.5, 0.3]}
        ringRadius={2.0}
        tubeRadius={0.040}
        color={CREAM}
        rotSpeed={[-0.05, 0.10, -0.03]}
        emissiveIntensity={1.1}
      />
      <GoldenRing
        rotation={[0.8, 0.8, 0]}
        ringRadius={4.3}
        tubeRadius={0.035}
        color={GOLD}
        rotSpeed={[0.025, -0.04, 0.02]}
        emissiveIntensity={0.55}
      />
      <GoldenRing
        rotation={[2.0, 0.2, 0.6]}
        ringRadius={1.4}
        tubeRadius={0.035}
        color={GOLD}
        rotSpeed={[0.06, 0.12, 0]}
        emissiveIntensity={1.3}
      />
      <GoldenRing
        rotation={[0.3, 1.8, 1.2]}
        ringRadius={5.2}
        tubeRadius={0.025}
        color={AMBER}
        rotSpeed={[0.018, -0.03, 0.015]}
        emissiveIntensity={0.4}
      />

      <CameraDrift />
    </>
  );
}

export const ThreeOrbitalsBackground = () => {
  return (
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
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#0a0a0a']} />
        <Scene />
      </Canvas>
      {/* Vignette over the canvas — pulls focus inward, matches the
          other demos' atmospheric edge treatment. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(10,10,10,0.55) 90%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
