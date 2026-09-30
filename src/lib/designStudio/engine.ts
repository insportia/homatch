// The Design Studio engine's identity.
//
// A floor-plan source records which generator produced its geometry. The
// workspace opens only sources this build can rebuild and edit; anything
// else is refused by the resolver as INCOMPATIBLE_GENERATOR instead of being
// rendered with rules it was not made with.
//
// The Design Studio generator wraps HOMATCH's deterministic floor-plan
// geometry (src/lib/floorplan/geometry.ts, shared with the Developer Digital
// Twin and not modified) with Design Studio's own scale/confidence layer, so
// its version names both.

import { GENERATOR_VERSION as FLOORPLAN_GENERATOR } from '../floorplan/geometry.ts';

export const DS_GENERATOR_VERSION = `ds-1+${FLOORPLAN_GENERATOR}`;

export const SUPPORTED_GENERATORS: readonly string[] = [DS_GENERATOR_VERSION];
