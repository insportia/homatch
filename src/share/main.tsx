// The public share viewer's own entry (share.html, served at /w/<token>).
//
// Deliberately small: no router, no auth, no app providers, no Supabase
// client, no full translation bundle — a phone opening a link from a
// messaging app downloads the 3D engine and this viewer, nothing else.

import { createRoot } from 'react-dom/client';
import { ShareViewer } from './ShareViewer';
import '../index.css';

createRoot(document.getElementById('root')!).render(<ShareViewer />);
