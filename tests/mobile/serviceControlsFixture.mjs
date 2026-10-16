// The six Service Control Center switches as service_controls_public() returns them.
// A suite that exercises one of the six puts it ON; the default harness answer ([])
// leaves all six hidden, exactly as production does while they are paused.
export const SERVICE_KEYS = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'];
export const servicesState = (on = true) => SERVICE_KEYS.map((service_key) => ({ service_key, frontend_enabled: on, backend_enabled: on }));
export const SERVICES_ALL_ON = servicesState(true);
export const SERVICES_ALL_OFF = servicesState(false);
export const SERVICE_CONTROLS_RPC = '/rest/v1/rpc/service_controls_public';
