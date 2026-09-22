function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as unknown as Uint8Array<ArrayBuffer>;
}

export interface CompressionOptions {
  threshold?: number;
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  memLevel?: number;
}

export interface WebSocketCompressionOptions {
  enabled?: boolean;
  threshold?: number;
  serverNoContextTakeover?: boolean;
  clientNoContextTakeover?: boolean;
  serverMaxWindowBits?: number;
  clientMaxWindowBits?: number;
}

export function compressGzip(data: string | Uint8Array, level?: number): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Bun.gzipSync(asBufferSource(input), { level: level as any });
}

export function decompressGzip(data: Uint8Array): Uint8Array {
  return Bun.gunzipSync(asBufferSource(data));
}

export function compressDeflate(data: string | Uint8Array, level?: number): Uint8Array {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Bun.deflateSync(asBufferSource(input), { level: level as any });
}

export function decompressDeflate(data: Uint8Array): Uint8Array {
  return Bun.inflateSync(asBufferSource(data));
}

export async function compressGzipAsync(data: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Bun.gzipSync(asBufferSource(input));
}

export async function decompressGzipAsync(data: Uint8Array): Promise<Uint8Array> {
  return Bun.gunzipSync(asBufferSource(data));
}

export class MessageCompressor {
  private options: Required<CompressionOptions>;

  constructor(options: CompressionOptions = {}) {
    this.options = {
      threshold: options.threshold ?? 1024,
      level: options.level ?? 6,
      memLevel: options.memLevel ?? 8,
    };
  }

  compress(data: string | Uint8Array): { data: Uint8Array; compressed: boolean } {
    const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    
    if (input.length < this.options.threshold) {
      return { data: input, compressed: false };
    }

    const compressed = compressDeflate(input, this.options.level);
    
    if (compressed.length >= input.length) {
      return { data: input, compressed: false };
    }

    return { data: compressed, compressed: true };
  }

  decompress(data: Uint8Array, wasCompressed: boolean): Uint8Array {
    if (!wasCompressed) {
      return data;
    }
    return decompressDeflate(data);
  }
}

export interface PerMessageDeflateOptions {
  serverNoContextTakeover?: boolean;
  clientNoContextTakeover?: boolean;
  serverMaxWindowBits?: number;
  clientMaxWindowBits?: number;
  threshold?: number;
}

export class PerMessageDeflate {
  private options: Required<PerMessageDeflateOptions>;
  private compressor: MessageCompressor;

  constructor(options: PerMessageDeflateOptions = {}) {
    this.options = {
      serverNoContextTakeover: options.serverNoContextTakeover ?? true,
      clientNoContextTakeover: options.clientNoContextTakeover ?? true,
      serverMaxWindowBits: options.serverMaxWindowBits ?? 15,
      clientMaxWindowBits: options.clientMaxWindowBits ?? 15,
      threshold: options.threshold ?? 1024,
    };
    
    this.compressor = new MessageCompressor({ threshold: this.options.threshold });
  }

  getExtensionHeader(): string {
    let header = 'permessage-deflate';
    
    if (this.options.serverNoContextTakeover) {
      header += '; server_no_context_takeover';
    }
    if (this.options.clientNoContextTakeover) {
      header += '; client_no_context_takeover';
    }
    if (this.options.serverMaxWindowBits < 15) {
      header += `; server_max_window_bits=${this.options.serverMaxWindowBits}`;
    }
    if (this.options.clientMaxWindowBits < 15) {
      header += `; client_max_window_bits=${this.options.clientMaxWindowBits}`;
    }
    
    return header;
  }

  compressMessage(data: string | Uint8Array): { data: Uint8Array; rsv1: boolean } {
    const { data: compressed, compressed: isCompressed } = this.compressor.compress(data);
    return { data: compressed, rsv1: isCompressed };
  }

  decompressMessage(data: Uint8Array, rsv1: boolean): Uint8Array {
    return this.compressor.decompress(data, rsv1);
  }
}

export function createBunWebSocketOptions(compressionOptions?: WebSocketCompressionOptions): {
  perMessageDeflate?: boolean | {
    compress?: boolean;
  };
} {
  if (!compressionOptions?.enabled) {
    return {};
  }

  return {
    perMessageDeflate: true,
  };
}
