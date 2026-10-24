// Railway public API, server-side only, for ONE service: homatch-official-worker.
//
// Used by verify-scaling (Admin → Infrastructure → Verify Scaling). The token
// is a Supabase secret and never leaves this function:
//   RAILWAY_PROJECT_TOKEN  a project token scoped to the production environment
//                          (least privilege; sent as Project-Access-Token), or
//   RAILWAY_API_TOKEN      an account/workspace token (Bearer) as a fallback.
// The service, project and environment are fixed constants; a request naming
// any other service is refused before a call is made, and nothing here can
// create, delete or reconnect a service, or change the plan.

export const RAILWAY_GRAPHQL = 'https://backboard.railway.com/graphql/v2';
export const WORKER_SERVICE_ID = '3e7f132b-d0be-4804-9bc0-0b6ad368ad15';
export const WORKER_PROJECT_ID = 'd088991c-b680-4458-9f12-a5df2d983e6b';
export const WORKER_ENVIRONMENT_ID = '7b355ab3-96fa-444d-8a0e-98896780c9ef';

export interface RailwayInstance {
  region: string;
  replicas: number;
  latestDeployment: { id: string; status: string; createdAt: string } | null;
}

export interface RailwayUsage {
  /** Average and peak over the window, summed across replicas. */
  memoryGbAvg: number | null;
  memoryGbPeak: number | null;
  cpuAvg: number | null;
  cpuPeak: number | null;
  windowDays: number;
}

type Fetch = typeof fetch;

export function railwayConfigured(env: { get(k: string): string | undefined }): boolean {
  return !!(env.get('RAILWAY_PROJECT_TOKEN') || env.get('RAILWAY_API_TOKEN'));
}

export class RailwayClient {
  private readonly env: { get(k: string): string | undefined };
  private readonly fetcher: Fetch;
  constructor(env: { get(k: string): string | undefined }, fetcher: Fetch = fetch) {
    this.env = env;
    this.fetcher = fetcher;
  }

  private headers(): Record<string, string> {
    const project = this.env.get('RAILWAY_PROJECT_TOKEN');
    if (project) return { 'Content-Type': 'application/json', 'Project-Access-Token': project };
    const api = this.env.get('RAILWAY_API_TOKEN');
    if (api) return { 'Content-Type': 'application/json', Authorization: `Bearer ${api}` };
    throw new Error('RAILWAY_NOT_CONFIGURED');
  }

  async gql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (variables.serviceId !== undefined && variables.serviceId !== WORKER_SERVICE_ID) throw new Error('RAILWAY_SERVICE_NOT_ALLOWED');
    const res = await this.fetcher(RAILWAY_GRAPHQL, { method: 'POST', headers: this.headers(), body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.errors?.length) {
      // The provider's message only; never the request headers.
      throw new Error(`RAILWAY_API_ERROR ${res.status}: ${String(body?.errors?.[0]?.message ?? '').slice(0, 200)}`);
    }
    return body.data as T;
  }

  /** The live replica count and region from the service instance's multi-region config. */
  async instance(): Promise<RailwayInstance> {
    const d = await this.gql<any>(
      `query i($serviceId: String!, $environmentId: String!) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { region numReplicas latestDeployment { id status createdAt } } }`,
      { serviceId: WORKER_SERVICE_ID, environmentId: WORKER_ENVIRONMENT_ID },
    );
    const si = d?.serviceInstance ?? {};
    return {
      region: String(si.region || 'ams'),
      replicas: Number.isInteger(si.numReplicas) ? si.numReplicas : 1,
      latestDeployment: si.latestDeployment ?? null,
    };
  }

  /**
   * Sets the replica count in the service's region, then redeploys the SAME
   * commit so Railway applies it (a replica change is a deployment on Railway).
   * Old replicas get SIGTERM and drain (VERIFY_QUEUE_DRAIN_SECONDS, released
   * leases go back to the queue), so no task is lost or run twice.
   */
  async setReplicas(region: string, replicas: number): Promise<void> {
    await this.gql(
      `mutation u($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`,
      { serviceId: WORKER_SERVICE_ID, environmentId: WORKER_ENVIRONMENT_ID, input: { multiRegionConfig: { [region]: { numReplicas: replicas } } } },
    );
    await this.gql(
      `mutation r($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId: WORKER_SERVICE_ID, environmentId: WORKER_ENVIRONMENT_ID },
    );
  }

  /** Measured CPU and memory over the last `days`, summed across replicas; nulls when Railway does not answer. */
  async usage(days = 7): Promise<RailwayUsage> {
    const empty = { memoryGbAvg: null, memoryGbPeak: null, cpuAvg: null, cpuPeak: null, windowDays: days };
    try {
      const d = await this.gql<any>(
        `query m($projectId: String!, $serviceId: String!, $environmentId: String!, $startDate: DateTime!) { metrics(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId, startDate: $startDate, measurements: [CPU_USAGE, MEMORY_USAGE_GB], sampleRateSeconds: 3600) { measurement values { ts value } } }`,
        { projectId: WORKER_PROJECT_ID, serviceId: WORKER_SERVICE_ID, environmentId: WORKER_ENVIRONMENT_ID, startDate: new Date(Date.now() - days * 86_400_000).toISOString() },
      );
      const series = (name: string) => ((d?.metrics ?? []).find((m: any) => m.measurement === name)?.values ?? []).map((v: any) => Number(v.value)).filter(Number.isFinite);
      const stat = (xs: number[]) => (xs.length ? { avg: xs.reduce((a, b) => a + b, 0) / xs.length, peak: Math.max(...xs) } : null);
      const mem = stat(series('MEMORY_USAGE_GB')), cpu = stat(series('CPU_USAGE'));
      return { memoryGbAvg: mem?.avg ?? null, memoryGbPeak: mem?.peak ?? null, cpuAvg: cpu?.avg ?? null, cpuPeak: cpu?.peak ?? null, windowDays: days };
    } catch {
      return empty;
    }
  }
}
