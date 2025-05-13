import { rsHelpers, stackInfo } from '../helpers';

export function getSecretName(name: string) {
  const n = name.replace(new RegExp(stackInfo.stack, 'g'), ''); // Replace occurrences of "stack" variable with "-"

  return rsHelpers.getNameNormalize(n);
}
