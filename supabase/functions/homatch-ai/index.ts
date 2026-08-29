// homatch-ai Edge Function — persistent AI assistant with context injection
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_URL =
  'https://app-e0dokxnqcykh-api-VaOwP8E7dJqa.gateway.appmedo.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

const SYSTEM_PROMPT = `You are Homatch AI, an expert real estate assistant for the Homatch platform.
Homatch is an AI Real Estate Search, Match, Connect & Verify platform operating in Georgia (Tbilisi, Batumi, etc.) and expanding globally.
You help BOTH buyers/renters (find properties) AND sellers/landlords (find demand for their property).
You can: search properties, explain matches, compare listings, detect duplicates, verify properties/developers, answer real estate questions.
You must: be concise, helpful, and context-aware. Never guarantee legal/financial outcomes.
Never silently trigger paid operations — always mention when an action requires credits.
When given page context (a specific property, developer, match), use it to give relevant answers.
If the user is not logged in, help with general questions but prompt them to log in for personalized results.`;

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: { messages: Array<{ role: string; content: string }>; context?: Record<string, unknown>; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { messages, context, conversationId } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Build system context prompt
  let contextPrefix = SYSTEM_PROMPT;
  if (context && Object.keys(context).length > 0) {
    contextPrefix += `\n\nCurrent page context:\n${JSON.stringify(context, null, 2)}`;
  }

  // Convert messages to Gemini contents format
  // Prepend system prompt as first user/model turn
  const contents = [
    { role: 'user', parts: [{ text: contextPrefix }] },
    { role: 'model', parts: [{ text: 'Understood. I am Homatch AI, ready to help.' }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  // Persist to DB if authenticated
  const authHeader = req.headers.get('Authorization');
  if (authHeader && conversationId) {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'user') {
        await supabase.from('ai_messages').insert({
          conversation_id: conversationId,
          role: 'user',
          content: lastMsg.content,
        });
      }
    } catch { /* best-effort persistence */ }
  }

  // Call Gemini
  const upstream = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ contents }),
  });

  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Stream through
  return new Response(upstream.body, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
