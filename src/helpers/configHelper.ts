import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();

export function getValue(name: string) {
  return config.get(name);
}
export function requireValue(name: string) {
  return config.require(name);
}
export function getSecret(name: string) {
  return config.getSecret(name);
}
export function requireSecret(name: string) {
  return config.requireSecret(name);
}
