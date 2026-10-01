// HOMATCH DESIGN STUDIO — the server-side work, one deployed function.
//
//   POST …/design-studio-reconstruct            pictures of a home → a scene  (reconstruct.ts)
//   POST …/design-studio-reconstruct/floorplan  a floor-plan image → a plan   (floorplan.ts)
//   POST …/design-studio-reconstruct/design     a version + brief  → a plan   (design.ts)
//   POST …/design-studio-reconstruct/project-delete  permanently delete a project (project.ts)
//   POST …/design-studio-reconstruct/factory          one Blender scene-factory pass (factory.ts)
//   POST …/design-studio-reconstruct/factory-status   a pass's state; every output verified on completion
//   POST …/design-studio-reconstruct/factory-discard  a superseded pass's outputs deleted
//   POST …/design-studio-reconstruct/qa               the rebuild checked against the picture or plan
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
import { handleFactory, handleFactoryDiscard, handleFactoryStatus, handleQa } from './factory.ts';
import { handleProjectDelete } from './project.ts';
import { handleReconstruct } from './reconstruct.ts';

serve((req) => {
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();
  if (route === 'design') return handleDesign(req);
  if (route === 'floorplan') return handleFloorplan(req);
  if (route === 'project-delete') return handleProjectDelete(req);
  if (route === 'factory') return handleFactory(req);
  if (route === 'factory-status') return handleFactoryStatus(req);
  if (route === 'factory-discard') return handleFactoryDiscard(req);
  if (route === 'qa') return handleQa(req);
  return handleReconstruct(req);
});
