import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';

export function useNotificationCount(): number {
  const { homatchUser } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!homatchUser) { setCount(0); return; }

    const fetchCount = async () => {
      const { count: c } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', homatchUser.id)
        .eq('read', false);
      setCount(c ?? 0);
    };

    fetchCount();

    const channel = supabase
      .channel(`notif-count-${homatchUser.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${homatchUser.id}`,
      }, () => fetchCount())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [homatchUser]);

  return count;
}
