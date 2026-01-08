import { AppRegistration } from './AppRegistration';
import * as types from '../types';
import * as pulumi from '@pulumi/pulumi';

/**
 * Creates an Azure App Registration for Cloudflare Access integration.
 * @param name - The Zero Trust Team Name of the Cloudflare.
 * @param props - Additional properties including vault information.
 * @param opts - Optional Pulumi component resource options.
 */

export function createCloudflareAzIdentity(
  name: string,
  props: types.WithVaultInfo,
  opts: pulumi.ComponentResourceOptions = {},
) {
  return new AppRegistration(
    `${name}-cloudflare-idp`,
    {
      ...props,
      enableClientSecret: true,
      appType: 'web',
      redirectUris: [`https://${name}.cloudflareaccess.com/cdn-cgi/access/callback`],
      implicitGrant: {
        accessTokenIssuanceEnabled: true,
        idTokenIssuanceEnabled: true,
      },
      requiredResourceAccesses: [
        {
          resourceAppId: '00000003-0000-0000-c000-000000000000',
          resourceAccesses: [
            {
              id: '0e263e50-5827-48a4-b97c-d940288653c7',
              type: 'Scope',
            },
            {
              id: '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0',
              type: 'Scope',
            },
            {
              id: '5f8c59db-677d-491f-a6b8-5f174b11ec1d',
              type: 'Scope',
            },
            {
              id: '7427e0e9-2fba-42fe-b0c0-848c9e6a8182',
              type: 'Scope',
            },
            {
              id: '37f7f235-527c-4136-accd-4a02d197296e',
              type: 'Scope',
            },
            {
              id: '14dad69e-099b-42c9-810b-d002981feec1',
              type: 'Scope',
            },
            {
              id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d',
              type: 'Scope',
            },
            {
              id: '2f51be20-0bb4-4fed-bf7b-db946066c75e',
              type: 'Role',
            },
          ],
        },
      ],
    },
    opts,
  );
}
