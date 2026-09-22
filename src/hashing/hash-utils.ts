export type HashAlgorithm = 'wyhash' | 'adler32' | 'crc32' | 'cityHash32' | 'cityHash64' | 'murmur32v3' | 'murmur32v2' | 'murmur64v2';

export function hash(
  data: string | Uint8Array | ArrayBuffer,
  algorithm: HashAlgorithm = 'wyhash',
  seed?: number
): bigint | number {
  switch (algorithm) {
    case 'wyhash':
      return Bun.hash(data, seed);
    case 'adler32':
      return Bun.hash.adler32(data);
    case 'crc32':
      return Bun.hash.crc32(data);
    case 'cityHash32':
      return Bun.hash.cityHash32(data);
    case 'cityHash64':
      return Bun.hash.cityHash64(data, BigInt(seed || 0));
    case 'murmur32v3':
      return Bun.hash.murmur32v3(data, seed);
    case 'murmur32v2':
      return Bun.hash.murmur32v2(data, seed);
    case 'murmur64v2':
      return Bun.hash.murmur64v2(data, BigInt(seed || 0));
    default:
      return Bun.hash(data, seed);
  }
}

export function hashString(data: string, algorithm: HashAlgorithm = 'wyhash'): string {
  const result = hash(data, algorithm);
  return typeof result === 'bigint' ? result.toString(16) : result.toString(16);
}

export function hashToHex(data: string | Uint8Array, algorithm: HashAlgorithm = 'wyhash'): string {
  const result = hash(data, algorithm);
  const hex = typeof result === 'bigint' ? result.toString(16) : result.toString(16);
  return hex.padStart(algorithm.includes('64') ? 16 : 8, '0');
}

export function hashFile(path: string, algorithm: HashAlgorithm = 'wyhash'): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const file = Bun.file(path);
      const content = await file.arrayBuffer();
      const result = hash(new Uint8Array(content), algorithm);
      const hex = typeof result === 'bigint' ? result.toString(16) : result.toString(16);
      resolve(hex.padStart(algorithm.includes('64') ? 16 : 8, '0'));
    } catch (error) {
      reject(error);
    }
  });
}

export function hashFileSync(path: string, algorithm: HashAlgorithm = 'wyhash'): string {
  const file = Bun.file(path);
  const stream = file.stream();
  throw new Error('Sync file hashing not supported, use hashFile instead');
}

export interface ContentHashOptions {
  algorithm?: HashAlgorithm;
  prefix?: string;
  length?: number;
}

export function contentHash(
  content: string | Uint8Array,
  options: ContentHashOptions = {}
): string {
  const { algorithm = 'wyhash', prefix = '', length } = options;
  let hex = hashToHex(content, algorithm);
  
  if (length && length > 0) {
    hex = hex.slice(0, length);
  }
  
  return prefix ? `${prefix}${hex}` : hex;
}

export class ContentHasher {
  private cache: Map<string, string> = new Map();
  private options: Required<ContentHashOptions>;

  constructor(options: ContentHashOptions = {}) {
    this.options = {
      algorithm: options.algorithm ?? 'wyhash',
      prefix: options.prefix ?? '',
      length: options.length ?? 8,
    };
  }

  hash(content: string | Uint8Array): string {
    const key = typeof content === 'string' ? content : content.toString();
    
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const result = contentHash(content, this.options);
    this.cache.set(key, result);
    return result;
  }

  async hashFile(path: string): Promise<string> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }

    let hex = await hashFile(path, this.options.algorithm);
    
    if (this.options.length > 0) {
      hex = hex.slice(0, this.options.length);
    }
    
    const result = this.options.prefix ? `${this.options.prefix}${hex}` : hex;
    this.cache.set(path, result);
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}

export function createETag(content: string | Uint8Array, weak = false): string {
  const hex = hashToHex(content, 'wyhash');
  return weak ? `W/"${hex}"` : `"${hex}"`;
}

export function createFileETag(size: number, mtime: Date | number, weak = true): string {
  const time = typeof mtime === 'number' ? mtime : mtime.getTime();
  const combined = `${size}-${time}`;
  const hex = hashToHex(combined, 'wyhash');
  return weak ? `W/"${hex}"` : `"${hex}"`;
}

export function compareETag(etag1: string, etag2: string): boolean {
  const normalize = (tag: string) => tag.replace(/^W\//, '').replace(/"/g, '');
  return normalize(etag1) === normalize(etag2);
}

export interface HashingHelpers {
  hash: typeof hash;
  hashString: typeof hashString;
  hashToHex: typeof hashToHex;
  hashFile: typeof hashFile;
  contentHash: typeof contentHash;
  createETag: typeof createETag;
  createFileETag: typeof createFileETag;
  compareETag: typeof compareETag;
}

export const hashingHelpers: HashingHelpers = {
  hash,
  hashString,
  hashToHex,
  hashFile,
  contentHash,
  createETag,
  createFileETag,
  compareETag,
};
