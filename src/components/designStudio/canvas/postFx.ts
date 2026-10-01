// THE FINISHING PASS — what turns a lit model into an architectural picture.
//
// Ambient occlusion (GTAO) darkens where things meet: a sofa against a wall,
// a bed on a floor, the inside corner of a room. It is the single biggest
// difference between "a 3D editor" and "a visualisation", and it costs one
// extra depth/normal pass. The scene is rendered into a multisampled HDR
// target (so edges stay smooth), occluded, then tone-mapped exactly as the
// plain renderer would (OutputPass reads the renderer's tone mapping and
// colour space), so colours chosen in the editor do not shift.
//
// Used for every still, and live on the HIGH tier. Weaker devices render
// directly (contact shadows still ground the pieces).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class PostFx {
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private target: THREE.WebGLRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, width, height);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    // World-space radius: the contact darkening of furniture and room corners, not a dirty halo.
    this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
    // Occlusion comes from what is solid: glass (a railing, glazing) occludes nothing.
    const hideClearThings = this.gtao.overrideVisibility.bind(this.gtao);
    this.gtao.overrideVisibility = () => {
      hideClearThings();
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m && (Array.isArray(m) ? m.every((x) => x.transparent) : m.transparent)) o.visible = false;
      });
    };
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.gtao.dispose();
    this.composer.dispose();
    this.target.dispose();
  }
}
