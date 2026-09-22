export interface StreamOptions {
  highWaterMark?: number;
  signal?: AbortSignal;
}

export class StreamingResponse {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private stream: ReadableStream<Uint8Array>;
  private encoder = new TextEncoder();

  constructor() {
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  write(data: string | Uint8Array): void {
    if (!this.controller) {
      throw new Error('Stream not initialized');
    }
    const chunk = typeof data === 'string' ? this.encoder.encode(data) : data;
    this.controller.enqueue(chunk);
  }

  writeLine(data: string): void {
    this.write(data + '\n');
  }

  writeJSON(data: any): void {
    this.write(JSON.stringify(data));
  }

  end(): void {
    if (this.controller) {
      this.controller.close();
      this.controller = null;
    }
  }

  error(err: Error): void {
    if (this.controller) {
      this.controller.error(err);
      this.controller = null;
    }
  }

  getReadableStream(): ReadableStream<Uint8Array> {
    return this.stream;
  }

  toResponse(init?: ResponseInit): Response {
    return new Response(this.stream, {
      ...init,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        ...init?.headers,
      },
    });
  }
}

export class SSEStream extends StreamingResponse {
  private eventId = 0;

  constructor() {
    super();
  }

  sendEvent(event: string, data: any, id?: string): void {
    const eventId = id || String(++this.eventId);
    let message = `id: ${eventId}\n`;
    message += `event: ${event}\n`;
    message += `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
    this.write(message);
  }

  sendData(data: any): void {
    const message = `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
    this.write(message);
  }

  sendComment(comment: string): void {
    this.write(`: ${comment}\n\n`);
  }

  keepAlive(): void {
    this.sendComment('keepalive');
  }

  toResponse(init?: ResponseInit): Response {
    return new Response(this.getReadableStream(), {
      ...init,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...init?.headers,
      },
    });
  }
}

export async function* streamBody(request: Request): AsyncGenerator<Uint8Array, void, unknown> {
  const body = request.body;
  if (!body) return;

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

export function pipeStream(
  source: ReadableStream<Uint8Array>,
  destination: WritableStream<Uint8Array>,
  options?: { signal?: AbortSignal }
): Promise<void> {
  return source.pipeTo(destination, options);
}

export function transformStream<I, O>(
  source: ReadableStream<I>,
  transformer: (chunk: I) => O | Promise<O>
): ReadableStream<O> {
  return source.pipeThrough(
    new TransformStream<I, O>({
      async transform(chunk, controller) {
        const result = await transformer(chunk);
        controller.enqueue(result);
      },
    })
  );
}

export function createLineStream(source: ReadableStream<Uint8Array>): ReadableStream<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  
  return source.pipeThrough(
    new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          controller.enqueue(line);
        }
      },
      flush(controller) {
        if (buffer) {
          controller.enqueue(buffer);
        }
      },
    })
  );
}

export function createJSONStream<T>(source: ReadableStream<Uint8Array>): ReadableStream<T> {
  return createLineStream(source).pipeThrough(
    new TransformStream<string, T>({
      transform(line, controller) {
        if (line.trim()) {
          try {
            controller.enqueue(JSON.parse(line));
          } catch {
          }
        }
      },
    })
  );
}
