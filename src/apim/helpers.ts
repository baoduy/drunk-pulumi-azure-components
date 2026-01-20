import { ApimApiType } from './ApimApiSet';
import { ApimPolicyBuilder } from './ApimPolicyBuilder';

export const createProxyApi = ({
  targetUrlHeaderKey,
  subscriptionKeyParameterNames,
  ...props
}: Pick<ApimApiType, 'name' | 'apiVersion' | 'apiRevision' | 'path' | 'subscriptionKeyParameterNames'> & {
  /**The header key that apim will get the real url for forwarding*/
  targetUrlHeaderKey: string;
}): ApimApiType => {
  return {
    ...props,
    //Dummy serviceUrl for proxy api this will be overwritten by api management during runtime
    serviceUrl: `https://${props.name}-hook-delivery.local`,
    operations: [{ name: 'POST', method: 'POST', urlTemplate: '/' }],
    subscriptionRequired: Boolean(subscriptionKeyParameterNames),
    subscriptionKeyParameterNames,
    policyBuilder: (p: ApimPolicyBuilder) =>
      p
        .checkHeader({ name: targetUrlHeaderKey })
        .setBaseUrl(`@(context.Request.Headers.GetValueOrDefault(&quot;${targetUrlHeaderKey}&quot;,&quot;&quot;))`),
  };
};
