import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BarGridProps {
  frequencyData: Uint8Array;
  gridSize?: number;
}

const BarGrid = ({ frequencyData, gridSize = 16 }: BarGridProps) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const targetHeights = useRef<Float32Array>(new Float32Array(gridSize * gridSize));
  const currentHeights = useRef<Float32Array>(new Float32Array(gridSize * gridSize));

  // Create gradient colors from orange to purple
  const colors = useMemo(() => {
    const colorArray = new Float32Array(gridSize * gridSize * 3);
    const orangeColor = new THREE.Color('hsl(25, 95%, 55%)');
    const purpleColor = new THREE.Color('hsl(280, 70%, 50%)');

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const index = i * gridSize + j;
        const t = (i + j) / (gridSize * 2 - 2);
        const color = orangeColor.clone().lerp(purpleColor, t);
        colorArray[index * 3] = color.r;
        colorArray[index * 3 + 1] = color.g;
        colorArray[index * 3 + 2] = color.b;
      }
    }
    return colorArray;
  }, [gridSize]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const binCount = frequencyData.length;
    const barsPerBin = Math.floor(binCount / gridSize);

    // Map frequency data to grid
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const index = i * gridSize + j;
        
        // Map position to frequency bin with some variation
        const binIndex = Math.floor(((i + j) / (gridSize * 2 - 2)) * (binCount * 0.7));
        const frequencyValue = frequencyData[binIndex] || 0;
        
        // Normalize and add some variance based on position
        const normalizedValue = frequencyValue / 255;
        const variance = Math.sin(i * 0.5) * Math.cos(j * 0.5) * 0.2;
        targetHeights.current[index] = Math.max(0.1, normalizedValue * 4 + variance * normalizedValue);
      }
    }

    // Smooth interpolation for that motorized PinThing feel
    const lerpFactor = 1 - Math.pow(0.001, delta);

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const index = i * gridSize + j;
        
        // Lerp current height towards target
        currentHeights.current[index] += (targetHeights.current[index] - currentHeights.current[index]) * lerpFactor * 8;
        
        const x = (i - gridSize / 2) * 0.6;
        const z = (j - gridSize / 2) * 0.6;
        const height = currentHeights.current[index];
        
        dummy.position.set(x, height / 2, z);
        dummy.scale.set(1, height, 1);
        dummy.updateMatrix();
        
        meshRef.current.setMatrixAt(index, dummy.matrix);
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, gridSize * gridSize]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[0.4, 1, 0.4]}>
        <instancedBufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
        />
      </boxGeometry>
      <meshStandardMaterial
        vertexColors
        metalness={0.6}
        roughness={0.3}
        emissive="#000000"
        emissiveIntensity={0.1}
      />
    </instancedMesh>
  );
};

export default BarGrid;
