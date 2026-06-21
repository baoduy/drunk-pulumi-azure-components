/// <reference types="jest" />
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getImportConfig } from '../src/apim/openApiHelper';

describe('openApiHelper.getImportConfig', () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    if (!globalThis.fetch) {
      globalThis.fetch = async () => new Response(null, { status: 404 });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('reads OpenAPI spec from local file path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-spec-'));
    const specPath = join(dir, 'spec.json');
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        paths: {
          '/v1/ping': { get: { responses: { 200: { description: 'ok' } } } },
        },
      }),
      'utf8',
    );

    try {
      const value = await getImportConfig([specPath], 'v1');
      expect(value).toBeDefined();
      expect(value).toContain('/ping');
      expect(value).not.toContain('/v1/ping');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns undefined when local file does not exist', async () => {
    const value = await getImportConfig([join(tmpdir(), 'does-not-exist-open-api.json')], 'v1');
    expect(value).toBeUndefined();
  });

  test('returns undefined when local file contains invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-spec-invalid-'));
    const specPath = join(dir, 'spec.json');
    await writeFile(specPath, '{"openapi":"3.0.0","paths":', 'utf8');

    try {
      const value = await getImportConfig([specPath], 'v1');
      expect(value).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reads OpenAPI spec from HTTP URL', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          openapi: '3.0.0',
          paths: {
            '/v2/health': { get: { responses: { 200: { description: 'ok' } } } },
          },
        }),
        { status: 200 },
      );

    const value = await getImportConfig(['https://example.com/openapi.json'], 'v2');
    expect(value).toBeDefined();
    expect(value).toContain('/health');
    expect(value).not.toContain('/v2/health');
  });

  test('returns undefined when HTTP request is not OK', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 404 });

    const value = await getImportConfig(['https://example.com/notfound.json'], 'v1');
    expect(value).toBeUndefined();
  });

  test('returns undefined when HTTP request fails', async () => {
    globalThis.fetch = async () => { throw new Error('network failed'); };

    const value = await getImportConfig(['https://example.com/error.json'], 'v1');
    expect(value).toBeUndefined();
  });

  test('tries multiple URLs and returns first successful result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-spec-arr-'));
    const specPath = join(dir, 'spec.json');
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        paths: {
          '/v1/users': { get: { responses: { 200: { description: 'ok' } } } },
        },
      }),
      'utf8',
    );

    try {
      // First URL doesn't exist, second is the local file
      const value = await getImportConfig(
        [join(tmpdir(), 'does-not-exist.json'), specPath],
        'v1',
      );
      expect(value).toBeDefined();
      expect(value).toContain('/users');
      expect(value).not.toContain('/v1/users');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns undefined when all URLs in array fail', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 404 });

    const value = await getImportConfig(
      [
        join(tmpdir(), 'does-not-exist-1.json'),
        'https://example.com/notfound.json',
      ],
      'v1',
    );
    expect(value).toBeUndefined();
  });
});
