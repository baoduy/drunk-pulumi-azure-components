import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

export const getStorageEndpoints = (storage: types.ResourceType) => ({
  ...storage,
  blob: `https://${storage.resourceName}.blob.core.windows.net/`,
  file: `https://${storage.resourceName}.file.core.windows.net/`,
  queue: `https://${storage.resourceName}.queue.core.windows.net/`,
  table: `https://${storage.resourceName}.table.core.windows.net/`,
  lake: `https://${storage.resourceName}.dfs.core.windows.net/`,
  web: `https://${storage.resourceName}.z23.web.core.windows.net/`,
});

export const getStorageEndpointsOutputs = (storage: types.ResourceInputs) => ({
  ...storage,
  blob: pulumi.interpolate`https://${storage.resourceName}.blob.core.windows.net/`,
  file: pulumi.interpolate`https://${storage.resourceName}.file.core.windows.net/`,
  queue: pulumi.interpolate`https://${storage.resourceName}.queue.core.windows.net/`,
  table: pulumi.interpolate`https://${storage.resourceName}.table.core.windows.net/`,
  lake: pulumi.interpolate`https://${storage.resourceName}.dfs.core.windows.net/`,
  web: pulumi.interpolate`https://${storage.resourceName}.z23.web.core.windows.net/`,
});
