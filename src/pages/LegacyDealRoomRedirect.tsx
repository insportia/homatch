// HOMATCH — compatibility for the old /deal-rooms URLs.
//
// "Deal Room" is no longer a product a customer can be in; a verification
// case is, and it lives under /verify. Any link that was shared, bookmarked
// or emailed while the old routes existed still has to land somewhere
// sensible, so those paths redirect into the canonical route instead of 404ing
// or — worse — rendering a second, parallel copy of the same workspace.
//
// `replace` is deliberate: the old URL must not sit in the history stack,
// where Back would bounce the customer straight out of the case again.
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

export const LegacyDealRoomRedirect: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/verify/${id}` : '/verify'} replace />;
};

export default LegacyDealRoomRedirect;
