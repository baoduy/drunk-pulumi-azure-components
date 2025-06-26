import { rsHelpers, stackInfo } from '../helpers';
import _ from 'lodash';

export function getSecretName(name: string) {
  const sanitizedStack = _.escapeRegExp(stackInfo.stack);
  const n = name.replace(new RegExp(sanitizedStack, 'g'), ''); // Replace occurrences of "stack" variable with "-"

  return rsHelpers.getNameNormalize(n);
}
