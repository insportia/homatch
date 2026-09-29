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
