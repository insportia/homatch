// The Service Control Center switches as service_controls_public() returns them.
// SERVICE_KEYS are the six the owner paused; the default harness answer ([]) leaves
// them hidden, exactly as production does. LIVE_KEYS are the products that are live
// today: a missing row means ON for them, so [] keeps every suite's pages as they were.
export const SERVICE_KEYS = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'];
export const LIVE_KEYS = ['find_property', 'find_property_deep', 'find_buyers', 'verify', 'contracts', 'mortgage', 'investment',
  'for_expats', 'meta_ads', 'email_campaigns', 'ai_assistant', 'brokers_directory', 'broker_desk', 'developers'];
const rows = (keys, on) => keys.map((service_key) => ({ service_key, frontend_enabled: on, backend_enabled: on }));
export const servicesState = (on = true) => rows(SERVICE_KEYS, on);
export const SERVICES_ALL_ON = servicesState(true);
export const SERVICES_ALL_OFF = servicesState(false);
// The expanded table: the six as given, every live product ON or OFF.
export const liveState = (on, six = false) => [...rows(SERVICE_KEYS, six), ...rows(LIVE_KEYS, on)];
export const SERVICE_CONTROLS_RPC = '/rest/v1/rpc/service_controls_public';
