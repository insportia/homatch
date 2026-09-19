// HOMATCH — the second way into a verification: a contract.
//
// A buyer often has the contract before they have the cadastral code, so the
// Verification Center accepts either. Choosing a file here creates the
// Verification Case, stores the document privately against it, QUEUES THE
// ANALYSIS, and opens the document — the same case a cadastral verification
// would have produced, not a separate flow.
//
// The upload itself, its validation, its error copy and the analysis request
// all live in ContractUpload, which the finished report's own "upload the
// contract" action uses too. This file used to carry its own copy of that
// logic and was missing the analysis step entirely: a contract uploaded from
// the Center was stored and never read, created no job, and never appeared in
// Running tasks. One implementation cannot drift from itself.
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ContractUpload } from './ContractUpload';

export const StartFromDocument: React.FC = () => (
  <Card>
    <CardContent className="pt-5">
      <ContractUpload variant="full" />
    </CardContent>
  </Card>
);

export default StartFromDocument;
