// Loading a glTF model into the Design Studio scene.
//
// The same decoder setup as the Developer Digital Twin viewer: Draco, Meshopt
// and KTX2, with the decoders served from HOMATCH's own origin (see the
// homatch:three-decoders plugin in vite.config.ts). Read-only use of the twin
// service: a developer unit is fetched through the public dt_unit_scene()
// exactly as any viewer fetches it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export async function loadGltf(url: string, renderer: THREE.WebGLRenderer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/three/draco/');
  loader.setDRACOLoader(draco);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath('/three/basis/');
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } finally {
    draco.dispose();
    ktx2.dispose();
  }
}

/**
 * A glTF with its objects indexed by glTF node, so the parts the server's
 * model inspector identified (by node index) can be found in the scene.
 */
export async function loadGltfWithNodes(
  url: string, renderer: THREE.WebGLRenderer, wanted: number[],
): Promise<{ scene: THREE.Object3D; nodes: Map<number, THREE.Object3D> }> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/three/draco/');
  loader.setDRACOLoader(draco);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath('/three/basis/');
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync(url);
    // The parser caches each node's object and the scene is built from that
    // cache, so this is the very object in the scene. (parser.associations
    // cannot be used: instances of a shared mesh share one mapping entry.)
    const inScene = new Set<THREE.Object3D>();
    gltf.scene.traverse((o) => inScene.add(o));
    const nodes = new Map<number, THREE.Object3D>();
    await Promise.all(wanted.map(async (index) => {
      const object = await gltf.parser.getDependency('node', index).catch(() => null) as THREE.Object3D | null;
      if (object && inScene.has(object)) nodes.set(index, object);
    }));
    return { scene: gltf.scene, nodes };
  } finally {
    draco.dispose();
    ktx2.dispose();
  }
}

/** The geometry URL of a developer unit's CURRENT publication, or null. */
export async function developerUnitModelUrl(unitId: string): Promise<{ url: string; sceneId: string; version: string } | null> {
  const { loadUnitScene, assetUrl } = await import('@/services/developer/twin');
  const scene = await loadUnitScene(unitId);
  if (!scene) return null;
  const primary = scene.assets.find((a) => a.kind === 'GEOMETRY')
    ?? scene.assets.find((a) => a.mime?.includes('gltf') || /\.(glb|gltf)$/i.test(a.storage_key));
  if (!primary) return null;
  return { url: assetUrl(primary), sceneId: scene.id, version: String(scene.version) };
}
