// HOMATCH INVESTMENT INTELLIGENCE — the click-first controls.
//
// They moved to src/components/workspace/controls.tsx when Mortgage needed
// the same chips, cards and source badges; this file re-exports them so no
// Investment call site had to move. See the note at the top of
// src/components/workspace/primitives.tsx for why the presentation layer
// is shared and the meaning of a number is not.

export * from '@/components/workspace/controls';
