import { Link, type LinkProps } from 'react-router-dom';
import { usePathAvailable } from '@/lib/serviceControls';

/**
 * A router Link that is not offered while its address belongs to a paused service
 * (Admin → Service Control Center; src/lib/serviceControls/routes.ts). For links to
 * another product from inside a page — a hand-off, a "next step" — so a paused product
 * never appears as a destination anywhere. Renders nothing when the service is paused.
 */
export function ServiceLink(props: LinkProps & { to: string }) {
  const available = usePathAvailable();
  if (!available(props.to)) return null;
  return <Link {...props} />;
}
