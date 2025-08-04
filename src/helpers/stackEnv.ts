import * as pulumi from '@pulumi/pulumi';
import { registerAutoTags } from './autoTags';

/**
 * Indicates if Pulumi is running in dry-run mode
 * @type {boolean}
 */
export const isDryRun = Boolean(process.env.PULUMI_NODEJS_DRY_RUN);

export const isTesting = process.env.NODE_ENV === 'test';
/**
 * The Pulumi organization name
 * @type {string}
 */
export const organization = process.env.PULUMI_NODEJS_ORGANIZATION!;

/**
 * The Pulumi project name. Falls back to the current project name in lowercase if not specified
 * @type {string}
 */
export const projectName = process.env.PULUMI_NODEJS_PROJECT ?? pulumi.getProject().toLowerCase();

/**
 * The Pulumi stack name. Falls back to the current stack name in lowercase if not specified
 * @type {string}
 */
export const stack = process.env.PULUMI_NODEJS_STACK ?? pulumi.getStack().toLowerCase();

/**
 * Gets stack outputs from a specified project
 * @template TOutput - The type of the stack outputs
 * @param {string} [name=projectName] - The name of the project to get outputs from. Defaults to current project
 * @returns {pulumi.Output<TOutput>} The stack outputs
 */
export const getStackOutputs = <TOutput>(name: string = projectName): pulumi.Output<TOutput> => {
  const stackRef = new pulumi.StackReference(`${organization}/${name}/${stack}`);
  return stackRef.outputs.apply((s) => s.default ?? s) as pulumi.Output<TOutput>;
};

console.log('Pulumi Environments:', {
  organization,
  projectName,
  stack,
  isDryRun,
});

if (!isDryRun && !isTesting) {
  registerAutoTags({
    environment: stack,
    organization: organization,
    'pulumi-project': projectName,
  });
}
