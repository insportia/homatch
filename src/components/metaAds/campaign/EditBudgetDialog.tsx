// Edit the daily budget: preview → financial delta → write-through commit.
import React from 'react';
import { PlanChangeDialog, type PlanChangeProps } from './PlanChangeDialog';

export function EditBudgetDialog(props: PlanChangeProps) {
  return <PlanChangeDialog kind="budget" {...props} />;
}
