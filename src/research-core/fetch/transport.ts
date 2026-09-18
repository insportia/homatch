export interface RawRequest {
  /** The URL to actually send. Never a canonicalized identity URL. */
  url: string;
  method: 'GET' | 'HEAD' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Hard cap on response bytes read. The transport must stop, not buffer. */
  maxBytes?: number;
  /**
   * Addresses the network policy already validated for this hostname.
   *
   * A transport that can pin the connection (see `NodeHttpTransport`) must
   * connect to one of these rather than resolving the hostname again, which is
   * what closes the DNS-rebinding window between validation and connection.
   * A transport that cannot pin must document that it does not.
   */
  pinnedAddresses?: string[];
}

export interface RawResponse {
  /** The URL actually served, before any redirect the client will follow. */
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  /** True when `maxBytes` stopped the read before the response ended. */
  truncated: boolean;
  /** Wall time for this single hop. */
  durationMs: number;
  /** The address the connection was actually made to, when the transport knows. */
  remoteAddress?: string;
}

/**
 * A single HTTP hop. Transports never follow redirects, never retry and never
 * rate limit - all of that lives in `HttpClient`, so those behaviours are
 * identical whether the bytes came from the network or from a fixture.
 */
export interface Transport {
  readonly name: string;
  /**
   * True when the transport honours `pinnedAddresses`. The HTTP client refuses
   * to send a request to a non-pinning transport when the network policy is in
   * strict mode, because validating an address and then connecting by hostname
   * leaves the rebinding window open.
   */
  readonly pinsAddresses: boolean;
  send(request: RawRequest): Promise<RawResponse>;
}

export function headerValue(headers: Record<string, string>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}
