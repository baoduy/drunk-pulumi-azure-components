import * as pulumi from '@pulumi/pulumi';
import { ApimPolicyBuilder } from '../src';

describe('ApimPolicyBuilder', () => {
  test('setBaseUrl', async () => {
    const builder = new ApimPolicyBuilder().setBaseUrl('https://example.com');

    await pulumi.output(builder.build()).apply((policy) => {
      expect(policy).toContain('<set-backend-service base-url="https://example.com" />');
      expect(policy).toContain(
        '<set-header name="x-test-header" exists-action="override"> <value>test-value</value></set-header>',
      );
      expect(policy).toContain('<policies>');
      expect(policy).toContain('<inbound>');
      expect(policy).toContain('<outbound>');
    });
  });

  // test('adds CORS and rate limit policies', async () => {
  //   const builder = new ApimPolicyBuilder()
  //     .setCors({ origins: ['https://foo.com', 'https://bar.com'] })
  //     .setRateLimit({ calls: 5, inSecond: 10 });
  //   const policy = await new Promise((resolve) => {
  //     pulumi.output(builder.build()).apply(resolve);
  //   });
  //   expect(policy).toContain('<cors allow-credentials="true">');
  //   expect(policy).toContain('<origin>https://foo.com</origin>');
  //   expect(policy).toContain('<origin>https://bar.com</origin>');
  //   expect(policy).toContain(
  //     '<rate-limit-by-key calls="5" renewal-period="10" counter-key="@(context.Request.IpAddress)" />',
  //   );
  // });
  //
  // test('mock response disables backend forwarding', async () => {
  //   const builder = new ApimPolicyBuilder().mockResponse({ code: 201 });
  //   const policy = await new Promise((resolve) => {
  //     pulumi.output(builder.build()).apply(resolve);
  //   });
  //
  //   expect(policy).toContain('<mock-response status-code="201" content-type="application/json" />');
  //   expect(policy).toContain('<backend>\n      <base />'); // Should not contain <forward-request ...>
  // });
});
