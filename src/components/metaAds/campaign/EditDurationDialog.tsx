// Edit the total duration: preview → financial delta → write-through commit.
import React from 'react';
import { PlanChangeDialog, type PlanChangeProps } from './PlanChangeDialog';

export function EditDurationDialog(props: PlanChangeProps) {
  return <PlanChangeDialog kind="duration" {...props} />;
}
