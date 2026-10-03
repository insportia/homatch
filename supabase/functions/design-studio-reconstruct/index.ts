// HOMATCH DESIGN STUDIO — the server-side work, one deployed function.
//
//   POST …/design-studio-reconstruct            pictures of a home → a scene  (reconstruct.ts)
//   POST …/design-studio-reconstruct/floorplan  a floor-plan image → a plan   (floorplan.ts; server-owned, answers at once)
//   POST …/design-studio-reconstruct/photos     the customer's photos → one understanding + a PHOTO_SET source (photos.ts; server-owned)
//   POST …/design-studio-reconstruct/design     a version + brief  → a plan   (design.ts)
//   POST …/design-studio-reconstruct/project-delete  permanently delete a project (project.ts)
//   POST …/design-studio-reconstruct/factory          one Blender scene-factory pass (factory.ts)
//   POST …/design-studio-reconstruct/factory-status   a pass's state; every output verified on completion
//   POST …/design-studio-reconstruct/factory-discard  a superseded pass's outputs deleted
//   POST …/design-studio-reconstruct/qa               the rebuild checked against the picture or plan
//   POST …/design-studio-reconstruct/render-quote     a signed render quote (credits, 10-minute expiry)   (renders.ts)
//   POST …/design-studio-reconstruct/render-start     quoted renders reserved, recorded, one factory pass started
//   POST …/design-studio-reconstruct/render-status    renders advanced: factory → photoreal finish → structure check → settle
//   POST …/design-studio-reconstruct/render-edit      one appearance edit inside a target's own mask, checked
//   POST …/design-studio-reconstruct/design-spec           OpenAI's Design Specification from the customer's own source (generate.ts)
//   POST …/design-studio-reconstruct/render-generate       an OpenAI-first picture (MASTER / ROOM / VARIANT): quoted, reserved, generated
//   POST …/design-studio-reconstruct/render-generate-step  generated pictures advanced: image → scene → edit map → settle
//   POST …/design-studio-reconstruct/walkthrough-create    a 3D walkthrough of an approved design, owned by the server (walkthrough.ts)
//   POST …/design-studio-reconstruct/walkthrough-status    its real state; a due step is taken
//   POST …/design-studio-reconstruct/walkthrough-retry     a failed one resumed from its saved work
//   POST …/design-studio-reconstruct/walkthrough-tick      the reconciler (pg_cron, x-cron-token): due walkthroughs and unwatched factory jobs
//   POST …/design-studio-reconstruct/walkthrough-geometry  a design revision on corrected geometry (the same drawing read again)
//
// One function because the project is on a plan that caps how many edge
// functions it may have, and production is at that cap: two new functions
// were accepted by the CLI and never created. Every handler acts AS THE
// CALLER and refuses an impersonated session. The three AI readings also
// refuse while Design Studio billing is switched on and record their own
// product's unbilled usage; deleting a project is not billable and touches no
// ledger. The route is the URL's last segment, so no handler peeks at
// another's body.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleDesign } from './design.ts';
import { handleFloorplan } from './floorplan.ts';
import { handlePhotoRooms, handlePhotos } from './photos.ts';
import { handleFactory, handleFactoryDiscard, handleFactoryStatus, handleQa } from './factory.ts';
import { handleProjectDelete } from './project.ts';
import { handleRenderEdit, handleRenderQuote, handleRenderStart, handleRenderStatus } from './renders.ts';
import { handleReconstruct } from './reconstruct.ts';
import { handleDesignSpec, handleRenderGenerate, handleRenderGenerateStep } from './generate.ts';
import { handleWalkthroughCreate, handleWalkthroughGeometry, handleWalkthroughRetry, handleWalkthroughStatus, handleWalkthroughTick } from './walkthrough.ts';

serve((req) => {
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();
  if (route === 'design') return handleDesign(req);
  if (route === 'floorplan') return handleFloorplan(req);
  if (route === 'photos') return handlePhotos(req);
  if (route === 'photo-rooms') return handlePhotoRooms(req);
  if (route === 'project-delete') return handleProjectDelete(req);
  if (route === 'factory') return handleFactory(req);
  if (route === 'factory-status') return handleFactoryStatus(req);
  if (route === 'factory-discard') return handleFactoryDiscard(req);
  if (route === 'qa') return handleQa(req);
  if (route === 'render-quote') return handleRenderQuote(req);
  if (route === 'render-start') return handleRenderStart(req);
  if (route === 'render-status') return handleRenderStatus(req);
  if (route === 'render-edit') return handleRenderEdit(req);
  if (route === 'design-spec') return handleDesignSpec(req);
  if (route === 'render-generate') return handleRenderGenerate(req);
  if (route === 'render-generate-step') return handleRenderGenerateStep(req);
  if (route === 'walkthrough-create') return handleWalkthroughCreate(req);
  if (route === 'walkthrough-status') return handleWalkthroughStatus(req);
  if (route === 'walkthrough-retry') return handleWalkthroughRetry(req);
  if (route === 'walkthrough-tick') return handleWalkthroughTick(req);
  if (route === 'walkthrough-geometry') return handleWalkthroughGeometry(req);
  return handleReconstruct(req);
});
