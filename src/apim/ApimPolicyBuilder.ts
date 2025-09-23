import { stackInfo } from '../helpers';
import { dbHelpers } from '../database';
import * as pulumi from '@pulumi/pulumi';

type ApimCorsType = { origins: pulumi.Input<string>[] };

export enum SetHeaderTypes {
  delete = 'delete',
  override = 'override',
  skip = 'skip',
  append = 'append',
}
export type ApimClientCertType = {
  issuer?: pulumi.Input<string>;
  subject?: pulumi.Input<string>;
  verifyCert?: pulumi.Input<boolean>;
  thumbprint?: pulumi.Input<string>;
};

export type ApimForwardToServiceBusType = {
  authClientId?: pulumi.Input<string>;
  serviceBusName: pulumi.Input<string>;
  topicOrQueueName: pulumi.Input<string>;
  brokerProperties?: Record<string, pulumi.Input<string>>;
};

export type ApimSetHeaderType = {
  name: pulumi.Input<string>;
  value?: pulumi.Input<string>;
  type: SetHeaderTypes;
};

export type ApimSetResponseBodyType = {
  condition?: pulumi.Input<string>;
  conditionStatusCode?: pulumi.Input<number>;
  responseBody: pulumi.Input<string>;
  responseStatusCode?: pulumi.Input<number>;
};

export class ApimPolicyBuilder {
  private _inboundPolicies: pulumi.Input<string>[] = [];
  private _outboundPolicies: pulumi.Input<string>[] = [];
  private _cors: ApimCorsType | undefined = undefined;
  private _mockResponse: boolean = false;
  private _clientCertVerification?: ApimClientCertType | undefined;

  public setBaseUrl(url: pulumi.Input<string>): ApimPolicyBuilder {
    this._inboundPolicies.push(pulumi.interpolate`<set-backend-service base-url="${url}" />`);
    return this;
  }

  public setBaseUrlIf(condition: boolean, url: pulumi.Input<string>): ApimPolicyBuilder {
    if (condition) this.setBaseUrl(url);
    return this;
  }

  public setRequestHeader(props: ApimSetHeaderType): ApimPolicyBuilder {
    const rs = this.setHeader(props);
    this._inboundPolicies.push(rs);
    return this;
  }

  public setResponseHeaders(props: ApimSetHeaderType): ApimPolicyBuilder {
    const rs = this.setHeader(props);
    this._outboundPolicies.push(rs);
    return this;
  }

  public authBasic(props: { userName: pulumi.Input<string>; password: pulumi.Input<string> }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      pulumi.interpolate`<authentication-basic username="${props.userName}" password="${props.password}" />`,
    );
    return this;
  }

  public authCert(
    props:
      | {
          certId: pulumi.Input<string>;
          password?: pulumi.Input<string>;
        }
      | {
          thumbprint: pulumi.Input<string>;
        },
  ): ApimPolicyBuilder {
    this._inboundPolicies.push(
      'thumbprint' in props
        ? pulumi.interpolate`<authentication-certificate thumbprint="${props.thumbprint}" />`
        : pulumi.interpolate`<authentication-certificate certificate-id="${props.certId}" password="${props.password}" />`,
    );
    return this;
  }

  public authIdentity(props: {
    resource: pulumi.Input<string>;
    clientId?: pulumi.Input<string>;
    variableName: pulumi.Input<string>;
    ignoreError?: pulumi.Input<boolean>;
    setHeaderKey?: pulumi.Input<string>;
  }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      'clientId' in props && props.clientId
        ? pulumi.interpolate`\t<authentication-managed-identity resource="${props.resource}" client-id="${props.clientId}" output-token-variable-name="${props.variableName}" ignore-error="${props.ignoreError}"/>`
        : pulumi.interpolate`\t<authentication-managed-identity resource="${props.resource}" output-token-variable-name="${props.variableName}" ignore-error="${props.ignoreError}"/>`,
    );

    if (props.setHeaderKey)
      this.setRequestHeader({
        name: props.setHeaderKey,
        type: SetHeaderTypes.override,
        value: pulumi.interpolate`@($"Bearer {context.Variables[&quot;${props.variableName}&quot;]}")`,
      });

    return this;
  }

  public checkHeader(props: { name: pulumi.Input<string>; values?: pulumi.Input<string>[] }): ApimPolicyBuilder {
    const vs = props.values ? props.values.map((v) => pulumi.interpolate`<value>${v}</value>`) : [];
    const rs = pulumi.interpolate`\t<check-header name="${
      props.name
    }" failed-check-httpcode="401" failed-check-error-message="The header ${
      props.name
    } is not found" ignore-case="true">
    ${pulumi.output(vs).apply((s) => s.join('\n'))}
\t</check-header>`;

    this._inboundPolicies.push(rs);
    return this;
  }

  public mockResponse(props: { code?: pulumi.Input<number>; contentType?: string }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      pulumi.interpolate`<mock-response status-code="${props.code ?? 200}" content-type="${props.contentType ?? 'application/json'}" />`,
    );
    this._mockResponse = true;
    return this;
  }

  public rewriteUri(template: pulumi.Input<string>): ApimPolicyBuilder {
    this._inboundPolicies.push(pulumi.interpolate`<rewrite-uri template="${template ?? '/'}" />`);
    return this;
  }

  public setRateLimit(props: {
    calls?: pulumi.Input<number>;
    inSecond?: pulumi.Input<number>;
    successConditionOnly?: boolean;
  }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      props.successConditionOnly
        ? pulumi.interpolate`<rate-limit-by-key calls="${props.calls ?? 10}" renewal-period="${
            props.inSecond ?? 10
          }" counter-key="@(context.Request.IpAddress)" increment-condition="@(context.Response.StatusCode &gt;= 200 &amp;&amp; context.Response.StatusCode &lt; 300)" />`
        : pulumi.interpolate`<rate-limit-by-key calls="${props.calls ?? 10}" renewal-period="${
            props.inSecond ?? 10
          }" counter-key="@(context.Request.IpAddress)" />`,
    );
    return this;
  }

  public setCacheOptions(duration?: pulumi.Input<string>): ApimPolicyBuilder {
    this._inboundPolicies.push(pulumi.interpolate`<cache-lookup vary-by-developer="false" 
            vary-by-developer-groups="false" 
            allow-private-response-caching="true" 
            must-revalidate="true" 
            downstream-caching-type="public" />`);
    this._outboundPolicies.push(pulumi.interpolate`<cache-store duration="${duration ?? 60}" />`);
    return this;
  }

  public setCors(props: ApimCorsType): ApimPolicyBuilder {
    this._cors = props;
    return this;
  }

  public setClientIpHeader(headerKey: pulumi.Input<string>): ApimPolicyBuilder {
    this.setRequestHeader({
      name: headerKey ?? `x-${stackInfo.organization}-clientIp`,
      value: '@(context.Request.IpAddress)',
      type: SetHeaderTypes.override,
    });
    return this;
  }

  public setWhitelistIPs(ipAddresses: pulumi.Input<string>[]): ApimPolicyBuilder {
    const policy = pulumi.interpolate`\t<ip-filter action="allow">\r\n${pulumi.output(ipAddresses).apply((ips) =>
      ips
        .map((ip) => {
          if (ip.includes('/')) {
            const range = dbHelpers.getIpsRange(ip);
            return `<address-range from="${range.first}" to="${range.last}" />`;
          }
          return `<address>${ip}</address>`;
        })
        .join('\r\n'),
    )}
\t</ip-filter>`;

    this._inboundPolicies.push(policy);
    return this;
  }

  public verifyClientCert(props: ApimClientCertType): ApimPolicyBuilder {
    this._clientCertVerification = props;
    return this;
  }

  public forwardToBus(props: ApimForwardToServiceBusType): ApimPolicyBuilder {
    this.authIdentity({
      clientId: props.authClientId,
      variableName: 'x-forward-to-bus',
      setHeaderKey: 'Authorization',
      resource: 'https://servicebus.azure.net',
      ignoreError: false,
    });

    this.setBaseUrl(pulumi.interpolate`https://${props.serviceBusName}.servicebus.windows.net`);
    this.rewriteUri(pulumi.interpolate`${props.topicOrQueueName}/messages`);

    if (props.brokerProperties) {
      Object.keys(props.brokerProperties).forEach((key) =>
        this.setRequestHeader({
          name: key,
          type: SetHeaderTypes.append,
          value: props.brokerProperties![key],
        }),
      );
    }
    return this;
  }

  public forwardToBusIf(condition: boolean, props: ApimForwardToServiceBusType): ApimPolicyBuilder {
    if (condition) this.forwardToBus(props);
    return this;
  }

  /**Replace outbound results */
  public replacesResponse(props: { from: pulumi.Input<string>; to: pulumi.Input<string> }): ApimPolicyBuilder {
    this._outboundPolicies.push(pulumi.interpolate`<find-and-replace from="${props.from}" to="${props.to}" />`);
    return this;
  }

  public setResponseBody(...props: ApimSetResponseBodyType[]): ApimPolicyBuilder {
    const options = props.map((c) =>
      c.conditionStatusCode
        ? pulumi.interpolate`\t<when condition="@(context.Response.StatusCode == ${c.conditionStatusCode})">
          <set-status code="${c.responseStatusCode ?? 200}" />
          <set-body>${c.responseBody}</set-body> 
\t</when>`
        : pulumi.interpolate`\t<when condition="${c.condition}">
          <set-status code="${c.responseStatusCode ?? 200}" />
          <set-body>${c.responseBody}</set-body>
\t</when>`,
    );

    this._outboundPolicies.push(pulumi.interpolate`\t<choose>
  ${pulumi.output(options).apply((ops) => ops.join('\n'))}
\t</choose>`);
    return this;
  }

  public build(): pulumi.Output<string> {
    this.buildCors();
    //This must be a last rule
    this.buildCertVerification();

    let backend: pulumi.Input<string> = '<base />';
    if (!this._mockResponse) {
      backend = pulumi.interpolate`<forward-request timeout="120" follow-redirects="true" buffer-request-body="true" fail-on-error-status-code="true"/>`;
    }

    return pulumi.interpolate`<policies>
  <inbound>
      <base />
      ${pulumi.output(this._inboundPolicies).apply((is) => is.join('\n'))}
  </inbound>
  <backend>
      ${backend}
  </backend>
  <outbound>
      <base />
      <set-header name="Strict-Transport-Security" exists-action="override">    
          <value>max-age=3600; includeSubDomains</value>    
      </set-header>    
      <set-header name="X-XSS-Protection" exists-action="override">    
          <value>1; mode=block</value>    
      </set-header>    
      <set-header name="Content-Security-Policy" exists-action="override">    
          <value>default-src 'self' data:</value>    
      </set-header>    
      <set-header name="X-Frame-Options" exists-action="override">    
          <value>Deny</value>    
      </set-header>    
      <set-header name="X-Content-Type-Options" exists-action="override">    
          <value>nosniff</value>    
      </set-header>    
      <set-header name="Expect-Ct" exists-action="override">    
          <value>max-age=3600,enforce</value>    
      </set-header>    
      <set-header name="Cache-Control" exists-action="override">    
          <value>none</value>    
      </set-header>    
      <set-header name="X-Powered-By" exists-action="delete" />    
      <set-header name="X-AspNet-Version" exists-action="delete" />
      
      ${pulumi.output(this._outboundPolicies).apply((os) => os.join('\n'))}
  </outbound>
  <on-error>
      <base />
  </on-error>
</policies>`;
  }

  private setHeader(props: ApimSetHeaderType) {
    return pulumi.output(props).apply((p) => {
      let rs = `\t<set-header name="${p.name}" exists-action="${p.type}">`;
      if (p.value) {
        rs += ` <value>${p.value}</value>`;
      }
      rs += '</set-header>';
      return rs;
    });
  }

  private buildCors() {
    const cors = !this._cors?.origins
      ? ['<origin>*</origin>']
      : this._cors!.origins.map((o) => pulumi.interpolate`<origin>${o}</origin>`);

    this._inboundPolicies.push(pulumi.interpolate`<cors allow-credentials="${Array.isArray(this._cors?.origins)}">
    <allowed-origins>
        ${pulumi.output(cors).apply((cs) => cs.join('\n'))}
    </allowed-origins>
    <allowed-methods preflight-result-max-age="300">
        <method>*</method>
    </allowed-methods>
    <allowed-headers>
        <header>*</header>
    </allowed-headers>
</cors>`);
  }

  private buildCertVerification() {
    if (!this._clientCertVerification) return;

    this._inboundPolicies.push(pulumi.interpolate`<choose>
        <when condition="@(context.Request.Certificate == null${
          this._clientCertVerification.verifyCert ? ' || !context.Request.Certificate.VerifyNoRevocation()' : ''
        }${
          this._clientCertVerification.issuer
            ? ` || context.Request.Certificate.Issuer != "${this._clientCertVerification.issuer}"`
            : ''
        }${
          this._clientCertVerification.subject
            ? ` || context.Request.Certificate.SubjectName.Name != "${this._clientCertVerification.subject}"`
            : ''
        }${
          this._clientCertVerification.thumbprint
            ? ` || context.Request.Certificate.Thumbprint != "${this._clientCertVerification.thumbprint}"`
            : ''
        })" >
          <return-response>
            <set-status code="403" reason="Invalid client certificate" />
          </return-response>
      </when>
    </choose>`);
  }
}
