export * as azureEnv from './azureEnv';
export * as configHelper from './configHelper';
export * as stackInfo from './stackEnv';

export const removeLeadingAndTrailingDash = (s: string) => s.replace(/^-|-$/g, '');
