/// <reference types="jest" />
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getImportConfig } from '../src/apim/openApiHelper';

describe('openApiHelper.getImportConfig', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
      const value = await getImportConfig(specPath, 'v1');
      expect(value).toBeDefined();
      expect(value).toContain('/ping');
      expect(value).not.toContain('/v1/ping');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns undefined when local file does not exist', async () => {
    const value = await getImportConfig(join(tmpdir(), 'does-not-exist-open-api.json'), 'v1');
    expect(value).toBeUndefined();
  });

  test('reads OpenAPI spec from HTTP URL', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        openapi: '3.0.0',
        paths: {
          '/v2/health': { get: { responses: { 200: { description: 'ok' } } } },
        },
      }),
    } as Response);

    const value = await getImportConfig('https://example.com/openapi.json', 'v2');
    expect(value).toBeDefined();
    expect(value).toContain('/health');
    expect(value).not.toContain('/v2/health');
  });

  test('returns undefined when HTTP request is not OK', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    const value = await getImportConfig('https://example.com/notfound.json', 'v1');
    expect(value).toBeUndefined();
  });

  test('returns undefined when HTTP request fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network failed'));

    const value = await getImportConfig('https://example.com/error.json', 'v1');
    expect(value).toBeUndefined();
  });
});
