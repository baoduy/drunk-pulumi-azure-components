import { AppContainerArgs, AppSecretArgs } from './AppContainer';
import * as types from '../types';
import { AppJobArgs } from './AppJob';
import * as pulumi from '@pulumi/pulumi';
import * as inputs from '@pulumi/azure-native/types/input';

export type ContainerAppsArgs = Omit<AppContainerArgs, types.CommonProps | 'managedEnvironmentId'>;
export type ContainerJobsArgs = Omit<AppJobArgs, types.CommonProps | 'managedEnvironmentId'>;

export const createCloudflareTunnelApp = ({
  enableResourceIdentity,
  configuration,
  container,
}: types.WithResourceIdentityFlag & {
  configuration: {
    registries?: pulumi.Input<pulumi.Input<inputs.app.RegistryCredentialsArgs>[]>;
    cloudflareToken: Omit<AppSecretArgs, 'name'>;
  };
  container: {
    image: pulumi.Input<string>;
    resources?: pulumi.Input<inputs.app.ContainerResourcesArgs>;
  };
}): ContainerAppsArgs => {
  return {
    enableResourceIdentity,
    configuration: {
      registries: configuration.registries,
      maxInactiveRevisions: 5,
      activeRevisionsMode: 'Single',
      secrets: [
        {
          ...configuration.cloudflareToken,
          name: 'cf-tunnel-token',
        },
      ],
    },
    template: {
      containers: [
        {
          name: 'cloudflared',
          args: ['tunnel', '--no-autoupdate', 'run', '--token', '$(token)'],
          image: container.image,
          resources: container?.resources,
          env: [
            {
              name: 'token',
              secretRef: 'cf-tunnel-token',
            },
          ],
        },
      ],
    },
  };
};

export const createGitRunnerJob = ({
  enableResourceIdentity,
  configuration,
  container,
}: types.WithResourceIdentityFlag & {
  configuration: {
    gitRepoOwner: pulumi.Input<string>;
    gitRepoName: pulumi.Input<string>;
    registries?: pulumi.Input<pulumi.Input<inputs.app.RegistryCredentialsArgs>[]>;
    gitPATSecret: Omit<AppSecretArgs, 'name'>;
  };
  container: {
    image: pulumi.Input<string>;
    resources?: pulumi.Input<inputs.app.ContainerResourcesArgs>;
  };
}): ContainerJobsArgs => {
  return {
    enableResourceIdentity,
    configuration: {
      registries: configuration.registries,
      triggerType: 'Event',
      eventTriggerConfig: {
        parallelism: 1,
        replicaCompletionCount: 1,
        scale: {
          minExecutions: 0,
          maxExecutions: 5,
          rules: [
            {
              name: 'github-runner',
              type: 'github-runner',
              metadata: {
                githubAPIURL: 'https://api.github.com',
                owner: configuration.gitRepoOwner,
                runnerScope: 'repo',
                repos: configuration.gitRepoName,
                targetWorkflowQueueLength: '1',
              },
              auth: [
                {
                  triggerParameter: 'personalAccessToken',
                  secretRef: 'github-pat-secret',
                },
              ],
            },
          ],
        },
      },
      secrets: [
        {
          ...configuration.gitPATSecret,
          name: 'github-pat-secret',
        },
      ],
    },
    template: {
      containers: [
        {
          name: 'git-runner',
          image: container.image,
          // https://learn.microsoft.com/en-us/azure/container-apps/containers#allocations
          resources: container.resources ?? { cpu: 2.5, memory: '5.0Gi' },
          env: [
            {
              name: 'GITHUB_PAT',
              secretRef: 'github-pat-secret',
            },
            {
              name: 'GH_URL',
              value: pulumi.interpolate`https://github.com/${configuration.gitRepoOwner}/${configuration.gitRepoName}`,
            },
            {
              name: 'REGISTRATION_TOKEN_API_URL',
              value: pulumi.interpolate`https://api.github.com/repos/${configuration.gitRepoOwner}/${configuration.gitRepoName}/actions/runners/registration-token`,
            },
          ],
        },
      ],
    },
  };
};
