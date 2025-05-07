import { removeLeadingAndTrailingDash, stackInfo } from '../helpers';

export const getSecretName = (name: string) => {
  const n = name
    .replace(new RegExp(stackInfo.stack, 'g'), '') // Replace occurrences of "stack" variable with "-"
    .replace(/\.|_|\s/g, '-') // Replace ".", "_", and spaces with "-"
    .replace(/-+/g, '-') // Replace multiple dashes with a single dash
    .toLowerCase(); // Convert the result to lowercase

  return removeLeadingAndTrailingDash(n);
};
