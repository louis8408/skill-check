import { describeError } from '../domain/errors.js';

/** Infrastructure-internal abstraction so version sources can be tested against a local server. */
export interface HttpClient {
  getText(url: string, timeoutMs: number, headers?: Readonly<Record<string, string>>): Promise<string>;
}

export interface GitHubAuth {
  readonly token: string;
  /** Hosts the token may be sent to. Never send it anywhere else. */
  readonly hosts: readonly string[];
}

export const GITHUB_HOSTS = ['api.github.com', 'raw.githubusercontent.com'] as const;

export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly userAgent: string,
    private readonly auth: GitHubAuth | null = null,
  ) {}

  async getText(url: string, timeoutMs: number, headers: Readonly<Record<string, string>> = {}): Promise<string> {
    const requestHeaders: Record<string, string> = { 'user-agent': this.userAgent, ...headers };
    if (this.auth?.hosts.includes(new URL(url).hostname)) {
      requestHeaders.authorization = `Bearer ${this.auth.token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error(`timed out after ${timeoutMs} ms`);
      throw new Error(`request failed: ${describeError(error)}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  }
}
