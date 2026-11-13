import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One scripted model turn: run a shell command, or reply with text. */
export type ModelStep = { readonly exec: string } | { readonly say: string };

interface ResponsesRequest {
  readonly input?: readonly { readonly role?: string; readonly content?: readonly { readonly text?: string }[] }[];
}

/**
 * A local stand-in for the OpenAI Responses API, so real Codex can run without an account.
 * Each POST /responses gets the next scripted step as a server-sent event stream, in the
 * shape Codex's own tests use (codex-rs/core/tests/common/responses.rs).
 */
export class FakeModel {
  readonly requests: ResponsesRequest[] = [];
  private script: ModelStep[] = [];
  private server: Server | null = null;
  baseUrl = '';

  /** Steps for the next requests, in order. The last step repeats if Codex asks again. */
  play(steps: ModelStep[]): void {
    this.script = [...steps];
    this.requests.length = 0;
  }

  /** Developer messages Codex added to the model's input, e.g. hook additionalContext. */
  developerTexts(): string[] {
    return this.requests.flatMap((request) =>
      (request.input ?? []).filter((item) => item.role === 'developer').flatMap((item) => (item.content ?? []).map((c) => c.text ?? '')),
    );
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
      req.on('end', () => {
        if (req.method === 'POST' && req.url?.endsWith('/responses') === true) {
          this.requests.push(JSON.parse(body) as ResponsesRequest);
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(this.turn(this.requests.length - 1));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}/v1`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  }

  private turn(index: number): string {
    const step = this.script[Math.min(index, this.script.length - 1)] ?? { say: 'done' };
    const id = `resp_${index}`;
    const item =
      'exec' in step
        ? { type: 'function_call', call_id: `call_${index}`, name: 'exec_command', arguments: JSON.stringify({ cmd: step.exec }) }
        : { type: 'message', role: 'assistant', id: `msg_${index}`, content: [{ type: 'output_text', text: step.say }] };
    const usage = { input_tokens: 0, input_tokens_details: null, output_tokens: 0, output_tokens_details: null, total_tokens: 0 };
    return [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item },
      { type: 'response.completed', response: { id, usage } },
    ]
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('');
  }
}
