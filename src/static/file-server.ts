import { join, extname, resolve, normalize } from 'path';

export interface StaticFileOptions {
  root: string;
  index?: string | string[];
  maxAge?: number;
  immutable?: boolean;
  dotfiles?: 'allow' | 'deny' | 'ignore';
  etag?: boolean;
  lastModified?: boolean;
  fallback?: string;
  headers?: Record<string, string>;
  compress?: boolean;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
};

function getMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export class BunFileServer {
  private options: Required<StaticFileOptions>;
  private root: string;

  constructor(options: StaticFileOptions) {
    this.options = {
      root: options.root,
      index: options.index ?? ['index.html'],
      maxAge: options.maxAge ?? 0,
      immutable: options.immutable ?? false,
      dotfiles: options.dotfiles ?? 'ignore',
      etag: options.etag ?? true,
      lastModified: options.lastModified ?? true,
      fallback: options.fallback ?? '',
      headers: options.headers ?? {},
      compress: options.compress ?? false,
    };
    this.root = resolve(options.root);
  }

  private isPathSafe(requestPath: string): boolean {
    const normalizedPath = normalize(requestPath);
    if (normalizedPath.includes('..')) {
      return false;
    }
    return true;
  }

  private isDotfile(path: string): boolean {
    const parts = path.split('/');
    return parts.some(part => part.startsWith('.') && part !== '.' && part !== '..');
  }

  async serve(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    pathname = pathname.replace(/^\/+/, '');

    if (!this.isPathSafe(pathname)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (this.isDotfile(pathname)) {
      if (this.options.dotfiles === 'deny') {
        return new Response('Forbidden', { status: 403 });
      }
      if (this.options.dotfiles === 'ignore') {
        return null;
      }
    }

    const indices = Array.isArray(this.options.index) 
      ? this.options.index 
      : [this.options.index];

    for (const suffix of ['', ...indices.map(i => '/' + i)]) {
      const relativePath = pathname + suffix.replace(/^\/+/, '');
      const filePath = join(this.root, relativePath);
      
      const resolvedPath = resolve(filePath);
      if (!resolvedPath.startsWith(this.root)) {
        return new Response('Forbidden', { status: 403 });
      }
      
      const response = await this.serveFile(filePath, request);
      if (response) {
        return response;
      }
    }

    if (this.options.fallback) {
      const fallbackPath = join(this.root, this.options.fallback);
      return this.serveFile(fallbackPath, request);
    }

    return null;
  }

  private async serveFile(filePath: string, request: Request): Promise<Response | null> {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    
    if (!exists) {
      return null;
    }

    const stat = await file.stat();
    if (stat.isDirectory()) {
      return null;
    }

    const headers = new Headers(this.options.headers);
    headers.set('Content-Type', getMimeType(filePath));
    headers.set('Content-Length', String(file.size));

    if (this.options.lastModified && stat.mtime) {
      headers.set('Last-Modified', stat.mtime.toUTCString());
    }

    if (this.options.etag) {
      const etag = await this.generateETag(file, stat);
      headers.set('ETag', etag);
      
      const ifNoneMatch = request.headers.get('If-None-Match');
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers });
      }
    }

    if (this.options.lastModified && stat.mtime) {
      const ifModifiedSince = request.headers.get('If-Modified-Since');
      if (ifModifiedSince) {
        const modifiedDate = new Date(ifModifiedSince);
        if (stat.mtime <= modifiedDate) {
          return new Response(null, { status: 304, headers });
        }
      }
    }

    if (this.options.maxAge > 0) {
      let cacheControl = `max-age=${this.options.maxAge}`;
      if (this.options.immutable) {
        cacheControl += ', immutable';
      }
      headers.set('Cache-Control', cacheControl);
    }

    const range = request.headers.get('Range');
    if (range) {
      return this.handleRangeRequest(file, stat, range, headers);
    }

    return new Response(file, { headers });
  }

  private async generateETag(file: ReturnType<typeof Bun.file>, stat: { mtime: Date | null; size: number }): Promise<string> {
    const mtime = stat.mtime?.getTime() || 0;
    const size = file.size;
    const hash = Bun.hash(`${mtime}-${size}`);
    return `"${hash.toString(16)}"`;
  }

  private handleRangeRequest(
    file: ReturnType<typeof Bun.file>,
    stat: { size: number },
    range: string,
    headers: Headers
  ): Response {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new Response('Invalid Range', { status: 416 });
    }

    const size = stat.size;
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : size - 1;

    if (start >= size || end >= size || start > end) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response('Range Not Satisfiable', { status: 416, headers });
    }

    const length = end - start + 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(length));
    headers.set('Accept-Ranges', 'bytes');

    const slicedFile = file.slice(start, end + 1);
    return new Response(slicedFile, { status: 206, headers });
  }
}

export function serveStatic(options: StaticFileOptions): (request: Request) => Promise<Response | null> {
  const server = new BunFileServer(options);
  return (request: Request) => server.serve(request);
}

export async function sendFile(
  filePath: string,
  options?: {
    headers?: Record<string, string>;
    contentType?: string;
    download?: boolean | string;
  }
): Promise<Response> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  
  if (!exists) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers(options?.headers);
  headers.set('Content-Type', options?.contentType || getMimeType(filePath));
  headers.set('Content-Length', String(file.size));

  if (options?.download) {
    const filename = typeof options.download === 'string' 
      ? options.download 
      : filePath.split('/').pop() || 'download';
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  }

  return new Response(file, { headers });
}
