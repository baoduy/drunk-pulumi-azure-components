import * as pulumi from '@pulumi/pulumi';
import { isPrd } from './azureEnv';

/**
 * Production advisory (DRK-1922): in a prd stack, an optional protection the caller left off writes one
 * `pulumi.log.warn` naming the component type, the resource name, the capability and the input to set.
 * It raises no error and never blocks the resource. Outside prd this is a no-op.
 *
 * @param type - component type, e.g. `StorageAccount`
 * @param name - the component's resource name
 * @param capability - the protection left off, e.g. `Defender for Storage`
 * @param hint - the input that turns it on, e.g. `defender.enabled`
 */
export function warnPrdMissing(type: string, name: string, capability: string, hint: string): void {
  if (!isPrd) return;
  pulumi.log.warn(`${type} '${name}' has no ${capability} in prd. Set \`${hint}\` to turn it on.`);
}
