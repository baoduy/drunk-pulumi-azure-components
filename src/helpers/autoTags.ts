import * as pulumi from '@pulumi/pulumi';

/**
 * List of resource types that should be excluded from automatic tagging.
 * These are typically identity/auth related resources or external provider resources
 * that don't support or need tagging.
 */
const ignoredTags = [
  'Group',
  'GroupMember',
  'Application',
  'ApplicationPassword',
  'ServicePrincipal',
  'ServicePrincipalPassword',
  'kubernetes',
  'cloudflare',
  'providers',
  'dynamic:Resource',
];

/**
 * Registers a stack transformation that automatically applies tags to resources.
 *
 * This function creates a Pulumi stack transformation that adds specified tags to
 * supported Azure resources. It excludes certain resource types defined in the
 * ignoredTags list and handles resource groups differently.
 *
 * @param autoTags - An object containing key-value pairs of tags to be applied
 * @returns void - The function registers a stack transformation with Pulumi runtime
 */
export const registerAutoTags = (autoTags: Record<string, string>) =>
  pulumi.runtime.registerStackTransformation((resource) => {
    //Check and ignore tag
    if (
      !resource.type.toLowerCase().includes('resourcegroup') &&
      ignoredTags.find((t) => resource.type.toLowerCase().includes(t.toLowerCase()))
    )
      return { props: resource.props, opts: resource.opts };

    //Apply default tag
    resource.props['tags'] = { ...resource.props['tags'], ...autoTags };
    return { props: resource.props, opts: resource.opts };
  });
