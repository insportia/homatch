import { createClient } from 'npm:@supabase/supabase-js@2.103.1';
import { createPublisherHandler } from './handler.ts';
Deno.serve(
  createPublisherHandler({ createClient, env: (name) => Deno.env.get(name) }),
);
