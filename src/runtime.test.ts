import { describe, test, expect } from 'bun:test';
import { hashString, hashToHex, contentHash, createETag, compareETag } from './hashing/hash-utils';
import { compressGzip, decompressGzip, compressDeflate, decompressDeflate } from './websocket/compression';

describe('hash utils', () => {
  test('hashString is deterministic and order-sensitive', () => {
    expect(hashString('orbit')).toBe(hashString('orbit'));
    expect(hashString('orbit')).not.toBe(hashString('orbit-2'));
  });

  test('hashToHex produces hex output', () => {
    expect(hashToHex('orbit')).toMatch(/^[0-9a-f]+$/);
  });

  test('different algorithms produce different hashes', () => {
    expect(hashToHex('data', 'wyhash')).not.toBe(hashToHex('data', 'crc32'));
  });

  test('contentHash differs per content', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
    expect(contentHash('stable-content')).toBe(contentHash('stable-content'));
  });
});

describe('ETag helpers', () => {
  test('createETag strong format', () => {
    expect(createETag('payload')).toMatch(/^"[0-9a-f]+"$/);
  });

  test('createETag weak format', () => {
    expect(createETag('payload', true)).toMatch(/^W\//);
  });

  test('compareETag', () => {
    const etag = createETag('x');
    expect(compareETag(etag, etag)).toBe(true);
    expect(compareETag(etag, createETag('y'))).toBe(false);
  });
});

describe('websocket compression', () => {
  test('gzip round-trip', () => {
    const original = 'compress me: ' + 'orbit '.repeat(100);
    const compressed = compressGzip(original);
    const restored = decompressGzip(compressed);
    expect(new TextDecoder().decode(restored)).toBe(original);
  });

  test('deflate round-trip', () => {
    const original = 'deflate: ' + 'bun '.repeat(100);
    const compressed = compressDeflate(original);
    const restored = decompressDeflate(compressed);
    expect(new TextDecoder().decode(restored)).toBe(original);
  });

  test('compressed output is smaller than input for repetitive text', () => {
    const original = 'a'.repeat(10_000);
    const compressed = compressGzip(original);
    expect(compressed.length).toBeLessThan(original.length);
  });

  test('Uint8Array input works', () => {
    const bytes = new TextEncoder().encode('binary-ish text');
    const restored = decompressGzip(compressGzip(bytes));
    expect(new TextDecoder().decode(restored)).toBe('binary-ish text');
  });
});
