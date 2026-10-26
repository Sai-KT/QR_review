import * as React from 'react';
import { useParams } from 'react-router';
import { RoutePlaceholderCard } from '../shared/RoutePlaceholderCard.tsx';

/**
 * CustomerPageShell
 *
 * Public-facing customer survey route shell (/q/:qrId).
 * Reads dynamic qrId parameter; does not query records or execute handoffs.
 */
export function CustomerPageShell(): React.JSX.Element {
  const { qrId } = useParams<{ qrId: string }>();

  return (
    <RoutePlaceholderCard
      screenId="SCR-CUST-01..15"
      screenName="Customer Review Flow Shell"
      routePath={`/q/${qrId ?? ':qrId'}`}
      surface="Customer"
      description="Patron 30-second mobile review flow: 3 single-select MCQs, optional note, Gemini Flash draft generation, and explicit two-click Google review handoff."
      notes={`Active QR token parameter: "${qrId ?? 'unspecified'}"`}
    />
  );
}

export default CustomerPageShell;
