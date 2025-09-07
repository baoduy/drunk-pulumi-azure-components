import { stackInfo } from '../helpers';
import { dbHelpers } from '../database';

type ApimCorsType = { origins: string[] };
export enum SetHeaderTypes {
  delete = 'delete',
  override = 'override',
  skip = 'skip',
  append = 'append',
}
export type ApimClientCertType = {
  issuer?: string;
  subject?: string;
  verifyCert?: boolean;
  thumbprint?: string;
};

export type ApimForwardToServiceBusType = {
  serviceBusName: string;
  topicOrQueueName: string;
  brokerProperties?: Record<string, string>;
};

export type ApimSetHeaderType = {
  name: string;
  value?: string;
  type: SetHeaderTypes;
};

export type ApimSetResponseBodyType = {
  condition?: string;
  conditionStatusCode?: number;
  responseBody: string;
  responseStatusCode?: number;
};

export class ApimPolicyBuilder {
  private _inboundPolicies: string[] = [];
  private _outboundPolicies: string[] = [];
  private _cors: ApimCorsType | undefined = undefined;
  private _mockResponse: boolean = false;
  private _clientCertVerification?: ApimClientCertType | undefined;

  public setBaseUrl(url: string): ApimPolicyBuilder {
    this._inboundPolicies.push(`\t<set-backend-service base-url="${url}" />`);
    return this;
  }

  public setBaseUrlIf(condition: boolean, url: string): ApimPolicyBuilder {
    if (condition) this.setBaseUrl(url);
    return this;
  }

  private setHeader(props: ApimSetHeaderType) {
    let rs = `\t<set-header name="${props.name}" exists-action="${props.type}">`;
    if (props.value) {
      rs += ` <value>${props.value}</value>`;
    }
    rs += '</set-header>';
    return rs;
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

  public authBasic(props: { userName: string; password: string }): ApimPolicyBuilder {
    this._inboundPolicies.push(`\t<authentication-basic username="${props.userName}" password="${props.password}" />`);
    return this;
  }

  public authCert(
    props:
      | {
          certId: string;
          password?: string;
        }
      | {
          thumbprint: string;
        },
  ): ApimPolicyBuilder {
    this._inboundPolicies.push(
      'thumbprint' in props
        ? `\t<authentication-certificate thumbprint="${props.thumbprint}" />`
        : `\t<authentication-certificate certificate-id="${props.certId}" password="${props.password}" />`,
    );
    return this;
  }

  public authIdentity(props: {
    resource: string;
    clientId?: string;
    variableName: string;
    ignoreError?: boolean;
    setHeaderKey?: string;
  }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      'clientId' in props
        ? `\t<authentication-managed-identity resource="${props.resource}" client-id="${props.clientId}" output-token-variable-name="${props.variableName}" ignore-error="${props.ignoreError}"/>`
        : `\t<authentication-managed-identity resource="${props.resource}" output-token-variable-name="${props.variableName}" ignore-error="${props.ignoreError}"/>`,
    );

    if (props.setHeaderKey)
      this.setRequestHeader({
        name: props.setHeaderKey,
        type: SetHeaderTypes.override,
        value: `@((string) context.Variables[&quot;${props.variableName}&quot;])`,
      });

    return this;
  }

  public checkHeader(props: { name: string; values?: string[] }): ApimPolicyBuilder {
    const rs = `\t<check-header name="${
      props.name
    }" failed-check-httpcode="401" failed-check-error-message="The header ${
      props.name
    } is not found" ignore-case="true">
    ${props.values ? props.values.map((v) => `<value>${v}</value>`).join('\n') : ''}
\t</check-header>`;

    this._inboundPolicies.push(rs);
    return this;
  }

  public mockResponse(props: { code?: number; contentType?: string }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      `<mock-response status-code="${props.code ?? 200}" content-type="${props.contentType ?? 'application/json'}" />`,
    );
    this._mockResponse = true;
    return this;
  }

  public rewriteUri(template: string): ApimPolicyBuilder {
    this._inboundPolicies.push(`<rewrite-uri template="${template ?? '/'}" />`);
    return this;
  }

  public setRateLimit(props: { calls?: number; inSecond?: number; successConditionOnly?: boolean }): ApimPolicyBuilder {
    this._inboundPolicies.push(
      props.successConditionOnly
        ? `<rate-limit-by-key calls="${props.calls ?? 10}" renewal-period="${
            props.inSecond ?? 10
          }" counter-key="@(context.Request.IpAddress)" increment-condition="@(context.Response.StatusCode &gt;= 200 &amp;&amp; context.Response.StatusCode &lt; 300)" />`
        : `<rate-limit-by-key calls="${props.calls ?? 10}" renewal-period="${
            props.inSecond ?? 10
          }" counter-key="@(context.Request.IpAddress)" />`,
    );
    return this;
  }

  public setCacheOptions(duration?: number): ApimPolicyBuilder {
    this._inboundPolicies.push(`<cache-lookup vary-by-developer="false" 
            vary-by-developer-groups="false" 
            allow-private-response-caching="true" 
            must-revalidate="true" 
            downstream-caching-type="public" />`);
    this._outboundPolicies.push(`<cache-store duration="${duration ?? 60}" />`);
    return this;
  }

  public setCors(props: ApimCorsType): ApimPolicyBuilder {
    this._cors = props;
    return this;
  }

  public setClientIpHeader(headerKey: string): ApimPolicyBuilder {
    this.setRequestHeader({
      name: headerKey ?? `x-${stackInfo.organization}-clientIp`,
      value: '@(context.Request.IpAddress)',
      type: SetHeaderTypes.override,
    });
    return this;
  }

  public setWhitelistIPs(ipAddresses: string[]): ApimPolicyBuilder {
    const policy = `\t<ip-filter action="allow">\r\n${ipAddresses
      .map((ip) => {
        if (ip.includes('/')) {
          const range = dbHelpers.getIpsRange(ip);
          return `<address-range from="${range.first}" to="${range.last}" />`;
        }
        return `<address>${ip}</address>`;
      })
      .join('\r\n')}
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
      variableName: 'x-forward-to-bus',
      setHeaderKey: 'Authorization',
      resource: 'https://servicebus.azure.net',
      ignoreError: false,
    });

    this.setBaseUrl(`https://${props.serviceBusName}.servicebus.windows.net`);

    this.rewriteUri(`${props.topicOrQueueName}/messages`);
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
  public replacesResponse(props: { from: string; to: string }): ApimPolicyBuilder {
    this._outboundPolicies.push(`<find-and-replace from="${props.from}" to="${props.to}" />`);
    return this;
  }

  public setResponseBody(...props: ApimSetResponseBodyType[]): ApimPolicyBuilder {
    const options = props.map((c) =>
      c.conditionStatusCode
        ? `\t<when condition="@(context.Response.StatusCode == ${c.conditionStatusCode})">
          <set-status code="${c.responseStatusCode ?? 200}" />
          <set-body>${c.responseBody}</set-body> 
\t</when>`
        : `\t<when condition="${c.condition}">
          <set-status code="${c.responseStatusCode ?? 200}" />
          <set-body>${c.responseBody}</set-body>
\t</when>`,
    );

    this._outboundPolicies.push(`\t<choose>
  ${options.join('\n')}
\t</choose>`);
    return this;
  }

  private buildCors() {
    if (!this._cors) return;
    const orgs = this._cors?.origins
      ? this._cors!.origins!.map((o) => `<origin>${o}</origin>`)
      : ['<origin>*</origin>'];

    const cors = `<cors allow-credentials="${Array.isArray(this._cors?.origins)}">
    <allowed-origins>
        ${orgs.join('\n')}
    </allowed-origins>
    <allowed-methods preflight-result-max-age="300">
        <method>*</method>
    </allowed-methods>
    <allowed-headers>
        <header>*</header>
    </allowed-headers>
</cors>`;
    this._inboundPolicies.push(cors);
  }

  private buildCertVerification() {
    if (!this._clientCertVerification) return;

    this._inboundPolicies.push(`<choose>
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

  public build(): string {
    this.buildCors();
    //This must be a last rule
    this.buildCertVerification();

    let backend = '<base />';
    if (!this._mockResponse) {
      backend =
        '<forward-request timeout="120" follow-redirects="true" buffer-request-body="true" fail-on-error-status-code="true"/>';
    }

    return `<policies>
  <inbound>
      <base />
      ${this._inboundPolicies.join('\n')}
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
      
      ${this._outboundPolicies.join('\n')}
  </outbound>
  <on-error>
      <base />
  </on-error>
</policies>`;
  }
}
