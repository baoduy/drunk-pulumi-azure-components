import { OpenAPI3 } from './openAPI3Type';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const removeVersion = (data: OpenAPI3, version: string): OpenAPI3 => {
  if (!data?.paths) {
    console.error(`APIM-removeVersion: There is no paths found in`, data);
    return data;
  }

  const newPaths = {} as any;

  //Replace version from path
  Object.keys(data.paths).forEach((k) => {
    const newKey = k.replace(`/${version}`, '');
    newPaths[newKey] = data.paths[k];
  });

  data.paths = newPaths;
  return data;
};

const isHttpSpecUrl = (specUrl: string): boolean => /^https?:\/\//i.test(specUrl);

const downloadRemoteSpecFile = async (fileUrl: string): Promise<OpenAPI3 | undefined> => {
  try {
    const response = await fetch(fileUrl, { method: 'GET' });
    if (!response.ok) {
      console.error(`Not able to get spec file from: ${fileUrl}. Status: ${response.status}`);
      return undefined;
    }

    return (await response.json()) as OpenAPI3;
  } catch (error) {
    console.error(`Not able to get spec file from: ${fileUrl}`, error);
    return undefined;
  }
};

const downloadLocalSpecFile = async (filePath: string): Promise<OpenAPI3 | undefined> => {
  try {
    await access(filePath, constants.F_OK);
    const fileContent = await readFile(filePath, 'utf8');
    return JSON.parse(fileContent) as OpenAPI3;
  } catch (error) {
    console.error(`Not able to read spec file from: ${filePath}`, error);
    return undefined;
  }
};

const downloadSpecFile = async (specUrl: string): Promise<OpenAPI3 | undefined> => {
  return isHttpSpecUrl(specUrl) ? downloadRemoteSpecFile(specUrl) : downloadLocalSpecFile(specUrl);
};

export const getImportConfig = async (specUrl: string, version: string): Promise<string | undefined> => {
  const spec = await downloadSpecFile(specUrl);
  if (!spec) return undefined;

  //Remove Version
  const data = removeVersion(spec, version);
  return JSON.stringify(data);
};
