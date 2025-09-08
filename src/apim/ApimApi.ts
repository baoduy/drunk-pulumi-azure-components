import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as apim from '@pulumi/azure-native/apimanagement';
import * as pulumi from '@pulumi/pulumi';
import * as openApi from './openApiHelper';
import { ApimPolicyBuilder } from './ApimPolicyBuilder';
import { azureEnv, stackInfo } from '../helpers';
import * as types from '../types';

export interface ApimApiArgs
  extends CommonBaseArgs,
    Omit<
      apim.ApiArgs,
      | types.CommonProps
      | 'format'
      | 'value'
      | 'isCurrent'
      | 'apiVersionDescription'
      | 'apiRevisionDescription'
      | 'apiVersion'
      | 'soapApiType'
      | 'protocols'
    > {
  apiVersion: 'v1' | 'v2' | 'v3' | string;
  productId?: pulumi.Input<string>;
  enableDiagnostic?: boolean;
  openSpecUrl?: string;
  soapApiType?: apim.SoapApiType;
  protocols?: Array<apim.Protocol>;
  operations?: Array<
    Omit<
      apim.ApiOperationArgs,
      'policies' | 'apiId' | 'resourceGroupName' | 'serviceName' | 'method' | 'displayName'
    > & {
      name: string;
      displayName?: pulumi.Input<string>;
      policyBuilder?: (policy: ApimPolicyBuilder) => ApimPolicyBuilder;
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'TRACE';
    }
  >;
  policyBuilder?: (policy: ApimPolicyBuilder) => ApimPolicyBuilder;
}

export class ApimApi extends BaseResourceComponent<ApimApiArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ApimApiArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ApimApi', name, args, opts);

    const api = this.buidApi();
    this.buildApiPolicy(api);
    this.buildApiDiagnostic(api);
    this.buildProductLink(api);
    this.buildOperations(api);

    this.id = api.id;
    this.resourceName = api.name;
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private buidApi() {
    let {
      productId,
      apiId,
      displayName,
      description,
      groupRoles,
      vaultInfo,
      rsGroup,
      apiVersion,
      apiRevision,
      serviceUrl,
      openSpecUrl,
      protocols,
      ...others
    } = this.args;
    if (!apiVersion) apiVersion = 'v1';
    if (!apiRevision) apiRevision = '1';
    const apiRevName = `${this.name};rev=${apiRevision}`;

    return new apim.Api(
      this.name,
      {
        ...rsGroup,
        ...others,
        apiId: apiId ?? this.name,
        displayName: displayName ?? this.name,
        description: description ?? this.name,
        isCurrent: true,
        protocols: protocols ?? [apim.Protocol.Https],

        apiVersion,
        apiVersionDescription: pulumi.interpolate`The version ${apiVersion} of ${this.name}`,

        apiRevision,
        apiRevisionDescription: pulumi.interpolate`${apiRevName} ${new Date().toLocaleDateString()}`,
        serviceUrl: serviceUrl
          ? pulumi.interpolate`${serviceUrl}/${apiVersion}`
          : `https://${stackInfo.organization}.com/${apiVersion}`,

        format: openSpecUrl ? apim.ContentFormat.Openapi_json : undefined,
        value: openSpecUrl ? pulumi.output(openApi.getImportConfig(openSpecUrl, apiVersion)) : undefined,
      },
      {
        ...this.opts,
        parent: this,
        customTimeouts: { create: '20m', update: '20m' },
      },
    );
  }

  private buildApiPolicy(api: apim.Api) {
    const { policyBuilder, serviceName, apiId, rsGroup } = this.args;
    if (!policyBuilder) return;

    return new apim.ApiPolicy(
      `${this.name}-policy`,
      {
        ...rsGroup,
        serviceName,
        apiId: apiId ?? this.name,
        policyId: 'policy',
        format: 'xml',
        value: policyBuilder(new ApimPolicyBuilder()).build(),
      },
      { dependsOn: api, deletedWith: api, parent: this },
    );
  }

  private buildApiDiagnostic(api: apim.Api) {
    const { rsGroup, serviceName, enableDiagnostic, apiId } = this.args;
    if (!enableDiagnostic) return;

    return new apim.ApiDiagnostic(
      `apim-${this.name}-apiDiagnostic`,
      {
        ...rsGroup,
        serviceName,
        apiId: apiId ?? this.name,
        alwaysLog: apim.AlwaysLog.AllErrors,
        httpCorrelationProtocol: 'W3C',
        operationNameFormat: 'Url',
        logClientIp: true,
        verbosity: 'information',
        loggerId: pulumi.interpolate`/subscriptions/${azureEnv.subscriptionId}/resourceGroups/${rsGroup.resourceGroupName}/providers/Microsoft.ApiManagement/service/${serviceName}/loggers/${serviceName}-appInsight`,
        diagnosticId: 'applicationinsights',
        sampling: {
          percentage: 100,
          samplingType: apim.SamplingType.Fixed,
        },
      },
      { dependsOn: api, deletedWith: api, parent: this },
    );
  }

  private buildProductLink(api: apim.Api) {
    const { serviceName, productId, apiId, rsGroup } = this.args;
    if (!productId) return;

    return new apim.ProductApi(
      this.name,
      {
        ...rsGroup,
        serviceName,
        productId,
        apiId: apiId ?? this.name,
      },
      { dependsOn: api, deletedWith: api, parent: this },
    );
  }

  private buildOperations(api: apim.Api) {
    const { operations, serviceName, rsGroup, apiId } = this.args;
    if (!operations?.length) return;

    return operations.map((o) => {
      const opsName = o.name.replace(/\//g, '');
      const opsRsName = `${this.name}-ops-${opsName}-${o.method}`.toLowerCase();

      const apiOps = new apim.ApiOperation(
        opsRsName,
        {
          ...o,
          ...rsGroup,
          serviceName,
          operationId: o.operationId ?? opsName,
          apiId: apiId ?? this.name,
          displayName: o.displayName ?? o.name,
          description: o.description ?? o.name,
          urlTemplate: o.urlTemplate ?? o.name,

          request: o.request ?? {
            description: o.name,
            headers: [],
            queryParameters: [],
            representations: [
              {
                contentType: 'application/json',
              },
            ],
          },

          responses: o.responses ?? [
            {
              description: 'successful operation',
              headers: [],
              representations: [
                {
                  contentType: 'application/json',
                },
              ],
              statusCode: 200,
            },
          ],
        },
        { dependsOn: api, deletedWith: api, parent: this },
      );

      if (o.policyBuilder) {
        new apim.ApiOperationPolicy(
          opsRsName,
          {
            ...rsGroup,
            serviceName,
            operationId: o.operationId ?? opsName,
            apiId: apiId ?? this.name,
            policyId: 'policy',
            format: 'xml',
            value: o.policyBuilder(new ApimPolicyBuilder()).build(),
          },
          { dependsOn: apiOps },
        );
      }
      return apiOps;
    });
  }
}
