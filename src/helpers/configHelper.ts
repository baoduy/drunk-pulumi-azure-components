import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();

/**
 * Retrieves a configuration value by name.
 *
 * @param {string} name - The name of the configuration value to retrieve
 * @returns {string | undefined} The configuration value if found, undefined otherwise
 * @description This function attempts to get a configuration value from Pulumi's configuration system.
 * If the configuration value doesn't exist, it returns undefined instead of throwing an error.
 * @example
 * const dbHost = getValue('database-host');
 * if (dbHost) {
 *   // use dbHost
 * }
 */
export function getValue(name: string) {
  return config.get(name);
}

/**
 * Retrieves a required configuration value by name.
 *
 * @param {string} name - The name of the required configuration value to retrieve
 * @returns {string} The configuration value
 * @throws {Error} If the configuration value is not found
 * @description This function retrieves a configuration value that must exist.
 * If the configuration value doesn't exist, it throws an error instead of returning undefined.
 * @example
 * const requiredApiKey = requireValue('api-key');
 * // requiredApiKey is guaranteed to have a value
 */
export function requireValue(name: string) {
  return config.require(name);
}

/**
 * Retrieves a secret configuration value by name.
 *
 * @param {string} name - The name of the secret configuration value to retrieve
 * @returns {pulumi.Output<string> | undefined} The secret configuration value if found, undefined otherwise
 * @description This function attempts to get a secret configuration value from Pulumi's configuration system.
 * The returned value is wrapped in a Pulumi.Output to ensure secure handling of sensitive data.
 * If the secret doesn't exist, it returns undefined instead of throwing an error.
 * @example
 * const dbPassword = getSecret('database-password');
 * if (dbPassword) {
 *   // use dbPassword securely
 * }
 */
export function getSecret(name: string) {
  return config.getSecret(name);
}

/**
 * Retrieves a required secret configuration value by name.
 *
 * @param {string} name - The name of the required secret configuration value to retrieve
 * @returns {pulumi.Output<string>} The secret configuration value
 * @throws {Error} If the secret configuration value is not found
 * @description This function retrieves a secret configuration value that must exist.
 * The returned value is wrapped in a Pulumi.Output to ensure secure handling of sensitive data.
 * If the secret doesn't exist, it throws an error instead of returning undefined.
 * @example
 * const requiredDbPassword = requireSecret('database-password');
 * // requiredDbPassword is guaranteed to have a value
 */
export function requireSecret(name: string) {
  return config.requireSecret(name);
}
