// HOMATCH DESIGN STUDIO — the AI readings, one deployed function.
//
//   POST …/design-studio-reconstruct            pictures of a home → a scene  (reconstruct.ts)
//   POST …/design-studio-reconstruct/floorplan  a floor-plan image → a plan   (floorplan.ts)
//   POST …/design-studio-reconstruct/design     a version + brief  → a plan   (design.ts)
//
// Three handlers behind one function because the project is on a plan that
// caps how many edge functions it may have, and production is at that cap:
// two new functions were accepted by the CLI and never created. Each handler
// is unchanged in what it checks, reads, writes and records; each still acts
// AS THE CALLER, refuses an impersonated session, refuses while Design Studio
// billing is switched on, and records its own product's unbilled usage.
// The route is the URL's last segment, so no handler peeks at another's body.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleDesign } from './design.ts';
import { handleFloorplan } from './floorplan.ts';
import { handleReconstruct } from './reconstruct.ts';

serve((req) => {
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop();
  if (route === 'design') return handleDesign(req);
  if (route === 'floorplan') return handleFloorplan(req);
  return handleReconstruct(req);
});
