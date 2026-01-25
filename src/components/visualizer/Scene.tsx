import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import BarGrid from './BarGrid';

interface SceneProps {
  frequencyData: Uint8Array;
}

const Scene = ({ frequencyData }: SceneProps) => {
  return (
    <Canvas
      camera={{ position: [8, 12, 8], fov: 50 }}
      shadows
      style={{ background: 'transparent' }}
    >
      {/* Ambient light for base illumination */}
      <ambientLight intensity={0.3} />
      
      {/* Main directional light with sunset orange tint */}
      <directionalLight
        position={[10, 15, 5]}
        intensity={1.2}
        color="#ff8844"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      
      {/* Secondary light with purple tint from opposite side */}
      <directionalLight
        position={[-10, 10, -5]}
        intensity={0.6}
        color="#9944ff"
      />
      
      {/* Point light from below for depth */}
      <pointLight position={[0, -5, 0]} intensity={0.3} color="#ff6622" />
      
      {/* The 3D bar grid */}
      <BarGrid frequencyData={frequencyData} gridSize={16} />
      
      {/* Ground plane for shadow catching */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
      
      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        minDistance={8}
        maxDistance={25}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.5}
        autoRotate
        autoRotateSpeed={0.5}
      />
    </Canvas>
  );
};

export default Scene;
