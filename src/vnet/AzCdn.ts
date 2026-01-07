import CdnHttpsEnable from '@drunk-pulumi/azure-providers/CdnHttpsEnable';
import * as cdn from '@pulumi/azure-native/cdn';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import { azureEnv } from '../helpers';
import * as types from '../types';

type ProfileResourceType = { resourceName: pulumi.Input<string> };
type ResourceType = { resourceName: string; id: string };

export interface AzCdnArgs extends BaseArgs, types.WithResourceGroupInputs, types.WithResourceIdentityFlag {
  /** If not provided the new Cdn profile will be created */
  existingProfile?: ProfileResourceType;
  sku?: pulumi.Input<cdn.SkuName | string>;
  /** The endpoints of the Cdn profile */
  endpoint: {
    /** The original endpoint of storage account */
    originHost: pulumi.Input<string>;
    cors?: string[];
    domainNames?: string[];
    securityResponseHeaders?: Record<string, string>;
  };
}

export class AzCdn extends BaseResourceComponent<AzCdnArgs> {
  public profile?: pulumi.Output<ResourceType>;
  public readonly endpoint: pulumi.Output<ResourceType>;
  public readonly rsGroup: pulumi.Output<types.ResourceGroupType>;

  constructor(name: string, args: AzCdnArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzCdn', name, args, opts);

    const profile = this.createProfile();
    const rules = this.getEndpointRules();

    const endpoint = new cdn.Endpoint(
      `${name}-endpoint`,
      {
        ...args.rsGroup,
        profileName: profile.resourceName,

        origins: [{ name, hostName: args.endpoint.originHost }],
        originHostHeader: args.endpoint.originHost,

        optimizationType: 'GeneralWebDelivery',
        queryStringCachingBehavior: 'IgnoreQueryString',

        deliveryPolicy: {
          rules,
          description: 'Static Website Rules',
        },

        isCompressionEnabled: true,
        contentTypesToCompress: [
          'text/plain',
          'text/html',
          'text/xml',
          'text/css',
          'application/xml',
          'application/xhtml+xml',
          'application/rss+xml',
          'application/javascript',
          'application/x-javascript',
        ],

        isHttpAllowed: true,
        isHttpsAllowed: true,
      },
      { ...opts, parent: this },
    );

    this.createCertAndDomains(profile, endpoint);

    this.endpoint = pulumi.output({
      resourceName: endpoint.name,
      id: endpoint.id,
    });
    this.rsGroup = pulumi.output({
      resourceGroupName: args.rsGroup.resourceGroupName,
      location: args.rsGroup.location,
    });

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      profile: this.profile,
      endpoint: this.endpoint,
      rsGroup: this.rsGroup,
    };
  }

  private createCertAndDomains(profile: ProfileResourceType, endpoint: cdn.Endpoint) {
    const { domainNames } = this.args.endpoint;
    if (!domainNames) return;
    domainNames.map((d) => {
      const customDomain = new cdn.CustomDomain(
        `${this.name}-${d}`,
        {
          ...this.args.rsGroup,
          endpointName: endpoint.name,
          profileName: profile.resourceName,
          customDomainName: d.replace(/\./g, '-'),
          hostName: d,
        },
        { dependsOn: endpoint, parent: this },
      );

      return new CdnHttpsEnable(
        `${this.name}-${d}`,
        {
          ...this.args.rsGroup,
          endpointName: endpoint.name,
          profileName: profile.resourceName,
          customDomainName: customDomain.name,
          subscriptionId: azureEnv.subscriptionId,
        },
        { dependsOn: customDomain, parent: this },
      );
    });
  }

  private createProfile(): ProfileResourceType {
    const { existingProfile, enableResourceIdentity, rsGroup, sku } = this.args;
    if (existingProfile) return existingProfile;

    const profile = new cdn.Profile(
      `${this.name}-pfl`,
      {
        resourceGroupName: rsGroup.resourceGroupName,
        location: 'global',
        identity: enableResourceIdentity ? { type: cdn.ManagedServiceIdentityType.SystemAssigned } : undefined,
        sku: { name: sku ?? cdn.SkuName.Standard_Microsoft },
      },
      { parent: this },
    );

    this.addIdentityToRole('readOnly', profile.identity);

    this.profile = pulumi.output({
      resourceName: profile.name,
      id: profile.id,
    });

    return { resourceName: profile.name };
  }

  private getEndpointRules() {
    const { endpoint } = this.args;
    const rules = [this.getEnforceHttpsRules(), this.getIndexFileCacheRules()];
    if (endpoint.securityResponseHeaders) {
      rules.push(this.getResponseHeadersRule(endpoint.securityResponseHeaders));
    }
    if (endpoint.cors) {
      rules.push(...this.getCorsRules(endpoint.cors));
    }
    //Update rule order
    rules.forEach((r, i) => (r.order = i + 1));
    return rules;
  }

  private getCorsRules(cors: string[]): inputs.cdn.DeliveryRuleArgs[] {
    return cors.map((c, i) => ({
      name: `allowsCors${i + 1}`,
      order: 5 + i,
      conditions: [
        {
          name: 'RequestHeader',
          parameters: {
            typeName: 'DeliveryRuleRequestHeaderConditionParameters',
            selector: 'Origin',
            operator: 'Contains',
            transforms: [],
            matchValues: [c],
            negateCondition: false,
          },
        },
      ],
      actions: [
        {
          name: 'ModifyResponseHeader',
          parameters: {
            typeName: 'DeliveryRuleHeaderActionParameters',
            headerAction: 'Overwrite',
            headerName: 'Access-Control-Allow-Origin',
            value: c,
          },
        },
      ],
    }));
  }

  private getSecurityResponseHeaders({
    allowOrigins,
    contentSecurityPolicies,
  }: {
    contentSecurityPolicies?: string[];
    allowOrigins?: string;
  }): Record<string, string> {
    const rs: Record<string, string> = {
      'Strict-Transport-Security': 'max-age=86400; includeSubDomains',
      'X-XSS-Protection': '1; mode=block',
      'X-Content-Type-Options': 'nosniff',
    };
    if (contentSecurityPolicies) rs['Content-Security-Policy'] = contentSecurityPolicies.join(';');
    if (allowOrigins) {
      rs['Access-Control-Allow-Origin'] = allowOrigins;
      rs['Access-Control-Allow-Credentials'] = 'true';
    }
    return rs;
  }

  private getEnforceHttpsRules(): inputs.cdn.DeliveryRuleArgs {
    return {
      name: 'enforceHttps',
      order: 1,
      conditions: [
        {
          name: 'RequestScheme',
          parameters: {
            matchValues: ['HTTP'],
            operator: 'Equal',
            negateCondition: false,
            typeName: 'DeliveryRuleRequestSchemeConditionParameters',
          },
        },
      ],
      actions: [
        {
          name: 'UrlRedirect',
          parameters: {
            redirectType: 'Found',
            destinationProtocol: 'Https',
            typeName: 'DeliveryRuleUrlRedirectActionParameters',
          },
        },
      ],
    };
  }

  private getIndexFileCacheRules(): inputs.cdn.DeliveryRuleArgs {
    return {
      name: 'indexCache',
      order: 2,
      conditions: [
        {
          name: 'UrlFileName',
          parameters: {
            operator: 'Contains',
            negateCondition: false,
            matchValues: ['index.html'],
            transforms: ['Lowercase'],
            typeName: 'DeliveryRuleUrlFilenameConditionParameters',
          },
        },
      ],
      actions: [
        {
          name: 'CacheExpiration',
          parameters: {
            cacheBehavior: 'Override',
            cacheType: 'All',
            cacheDuration: '08:00:00',
            typeName: 'DeliveryRuleCacheExpirationActionParameters',
          },
        },
      ],
    };
  }

  private getResponseHeadersRule = (rules: Record<string, string>): inputs.cdn.DeliveryRuleArgs => {
    return {
      name: 'defaultResponseHeaders',
      order: 3,
      conditions: [
        {
          name: 'UrlPath',
          parameters: {
            operator: 'Any',
            negateCondition: false,
            matchValues: [],
            transforms: [],
            typeName: 'DeliveryRuleUrlPathMatchConditionParameters',
          },
        },
      ],
      actions: Object.keys(rules).map((k) => ({
        name: 'ModifyResponseHeader',
        parameters: {
          headerAction: 'Overwrite',
          headerName: k,
          value: rules[k],
          typeName: 'DeliveryRuleHeaderActionParameters',
        },
      })),
    };
  };
}
