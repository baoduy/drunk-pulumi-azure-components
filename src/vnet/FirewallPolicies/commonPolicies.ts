import * as pulumi from '@pulumi/pulumi';
import { azureEnv } from '../../helpers';
import { FirewallPolicyBuilder } from './FirewallPolicyBuilder';

export const allAzurePorts = [
  '22',
  '443',
  '445',
  '1433',
  '1194',
  '3306',
  '3389',
  '5432',
  '5671',
  '5672',
  '6379',
  '6380',
  '8883',
  '9000',
  '10255',
];

export function defaultAllowedPolicies({
  name = 'default-allows',
  priority = 100,
  sourceAddresses,
  allowsAllApps,
  allowsAzurePortal,
  allowsAzureDevOps,
  allowsOffice365,
  allowsWindowsUpdate,
}: {
  name?: string;
  priority: number;
  sourceAddresses: pulumi.Input<string>[];
  allowsAzurePortal?: boolean;
  allowsOffice365?: boolean;
  allowsAzureDevOps?: boolean;
  /**This is dangerous rule use with care*/
  allowsAllApps?: boolean;
  allowsWindowsUpdate?: boolean;
}) {
  const builder = new FirewallPolicyBuilder(name, { priority, action: 'Allow' });

  if (allowsAllApps) {
    builder.addAppRule('allow-everything', {
      description: 'Allows Everything (Dangerous)',
      sourceAddresses,
      targetFqdns: ['*'],
      protocols: [
        { protocolType: 'Http', port: 80 },
        { protocolType: 'Https', port: 443 },
      ],
    });
    return builder;
  }

  if (allowsAzurePortal) {
    builder
      .addNetRule('azure-portal-net', {
        description: ' Allows Azure Portal Access',
        ipProtocols: ['TCP', 'UDP'],
        sourceAddresses,
        destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`, `Sql.${azureEnv.currentRegionCode}`],
        destinationPorts: allAzurePorts,
      })
      .addAppRule('azure-apps', {
        description: 'Allows Windows Updates',
        sourceAddresses,
        targetFqdns: ['AzureBackup', 'AzureKubernetesService', 'AzureActiveDirectoryDomainServices'],
        protocols: [{ protocolType: 'Https', port: 443 }],
      })
      .addAppRule('azure-portal-app', {
        description: ' Allows Azure Portal Access',
        sourceAddresses,
        targetFqdns: [
          '*.azure.com',
          '*.azure.net',
          '*.microsoftonline.com',
          '*.msauth.net',
          '*.msauthimages.net',
          '*.msecnd.net',
          '*.msftauth.net',
          '*.msftauthimages.net',
          'www.microsoft.com',
          'learn.microsoft.com',
        ],
        protocols: [
          { protocolType: 'Http', port: 80 },
          { protocolType: 'Https', port: 443 },
        ],
      });
  }

  if (allowsAzureDevOps) {
    builder.addAppRule('azure-devops-app', {
      description: 'Allows Azure DevOps Access',
      sourceAddresses,
      targetFqdns: [
        //Core Azure DevOps
        '*.dev.azure.com',
        'aex.dev.azure.com',
        'app.vssps.dev.azure.com',
        'vsrm.dev.azure.com',
        'download.agent.dev.azure.com',
        'dataimport.dev.azure.com',
        //Visual Studio & Legacy
        '*.visualstudio.com',
        '*.vsrm.visualstudio.com',
        '*.vstmr.visualstudio.com',
        '*.pkgs.visualstudio.com',
        '*.vssps.visualstudio.com',
        '*.vsblob.visualstudio.com',
        'aexprodea1.vsaex.visualstudio.com',
        //Azure DevOps Assets & CDN
        '*.vsassets.io',
        '*.vstmrblob.vsassets.io',
        '*.gallerycdn.vsassets.io',
        'cdn.vsassets.io',
        '*.vsassetscdn.azure.cn',
        '*.gallerycdn.azure.cn',
        //Azure Artifacts
        '*.blob.core.windows.net',
        '*.dedup.microsoft.com',
        //NuGet
        '*.azurewebsites.net',
        '*.nuget.org',
        //SSH
        'ssh.dev.azure.com',
        'vs-ssh.visualstudio.com',
        //Common Microsoft Services
        'azure.microsoft.com',
        'management.azure.com',
        'management.core.windows.net',
        'graph.microsoft.com',
        'static2.sharepointonline.com',
        'amp.azure.net',
        //MSA Authentication (for MSA-backed orgs)
        'live.com',
        'login.live.com',
        //Billing
        '*.vscommerce.visualstudio.com',
        //CDN Auth
        'aadcdn.msauth.net',
        'aadcdn.msftauth.net',
        'amcdn.msftauth.net',
        'azurecomcdn.azureedge.net',
      ],
      protocols: [{ protocolType: 'Https', port: 443 }],
    });
  }

  if (allowsOffice365) {
    builder.addAppRule('office365-app', {
      description: 'Allows Microsoft 365/Office 365 Access',
      sourceAddresses,
      targetFqdns: [
        //Microsoft 365 Unified Domains
        '*.cloud.microsoft',
        '*.static.microsoft',
        '*.usercontent.microsoft',
        //Exchange Online
        'outlook.cloud.microsoft',
        'outlook.office.com',
        'outlook.office365.com',
        '*.outlook.com',
        '*.protection.outlook.com',
        '*.mail.protection.outlook.com',
        '*.mx.microsoft',
        'smtp.office365.com',
        //SharePoint Online and OneDrive
        '*.sharepoint.com',
        '*.sharepointonline.com',
        'storage.live.com',
        '*.search.production.apac.trafficmanager.net',
        '*.search.production.emea.trafficmanager.net',
        '*.search.production.us.trafficmanager.net',
        '*.wns.windows.com',
        'admin.onedrive.com',
        'officeclient.microsoft.com',
        'g.live.com',
        'oneclient.sfx.ms',
        'spoprod-a.akamaihd.net',
        '*.svc.ms',
        //Microsoft Teams
        '*.lync.com',
        '*.teams.cloud.microsoft',
        '*.teams.microsoft.com',
        'teams.cloud.microsoft',
        'teams.microsoft.com',
        '*.keydelivery.mediaservices.windows.net',
        '*.streaming.mediaservices.windows.net',
        'aka.ms',
        'adl.windows.com',
        'join.secure.skypeassets.com',
        'mlccdnprod.azureedge.net',
        '*.skype.com',
        //Microsoft 365 Common and Office Online
        '*.officeapps.live.com',
        '*.online.office.com',
        'office.live.com',
        '*.office.net',
        '*.onenote.com',
        '*cdn.onenote.net',
        'ajax.aspnetcdn.com',
        'apis.live.net',
        'officeapps.live.com',
        'www.onedrive.com',
        //Authentication & Identity
        '*.auth.microsoft.com',
        '*.msftidentity.com',
        '*.msidentity.com',
        'account.activedirectory.windowsazure.com',
        'accounts.accesscontrol.windows.net',
        'adminwebservice.microsoftonline.com',
        'api.passwordreset.microsoftonline.com',
        'autologon.microsoftazuread-sso.com',
        'becws.microsoftonline.com',
        'ccs.login.microsoftonline.com',
        'clientconfig.microsoftonline-p.net',
        'companymanager.microsoftonline.com',
        'device.login.microsoftonline.com',
        'login-us.microsoftonline.com',
        'login.microsoft.com',
        'login.microsoftonline-p.com',
        'login.microsoftonline.com',
        'login.windows.net',
        'logincert.microsoftonline.com',
        'loginex.microsoftonline.com',
        'nexus.microsoftonline-p.com',
        'passwordreset.microsoftonline.com',
        'provisioningapi.microsoftonline.com',
        '*.hip.live.com',
        '*.microsoftonline-p.com',
        '*.microsoftonline.com',
        '*.msauth.net',
        '*.msauthimages.net',
        '*.msecnd.net',
        '*.msftauth.net',
        '*.msftauthimages.net',
        '*.phonefactor.net',
        'enterpriseregistration.windows.net',
        //Security & Compliance
        '*.protection.office.com',
        '*.security.microsoft.com',
        'compliance.microsoft.com',
        'defender.microsoft.com',
        'protection.office.com',
        'purview.microsoft.com',
        'security.microsoft.com',
        '*.portal.cloudappsecurity.com',
        //Telemetry & Diagnostics
        '*.aria.microsoft.com',
        '*.events.data.microsoft.com',
        //Common Services
        '*.o365weve.com',
        'appsforoffice.microsoft.com',
        'assets.onestore.ms',
        'auth.gfx.ms',
        'c1.microsoft.com',
        'dgps.support.microsoft.com',
        'docs.microsoft.com',
        'msdn.microsoft.com',
        'platform.linkedin.com',
        'prod.msocdn.com',
        'shellprod.msocdn.com',
        'support.microsoft.com',
        'technet.microsoft.com',
        '*.office365.com',
        //Information Protection
        '*.aadrm.com',
        '*.azurerms.com',
        '*.informationprotection.azure.com',
        'ecn.dev.virtualearth.net',
        'informationprotection.hosting.portal.azure.net',
        //Other Services
        'dc.services.visualstudio.com',
        'mem.gfx.ms',
        '*.microsoft.com',
        '*.msocdn.com',
        '*.onmicrosoft.com',
        'o15.officeredir.microsoft.com',
        'officepreviewredir.microsoft.com',
        'officeredir.microsoft.com',
        'r.office.microsoft.com',
        'activation.sls.microsoft.com',
        'crl.microsoft.com',
        'office15client.microsoft.com',
        'cdn.odc.officeapps.live.com',
        'officecdn.microsoft.com',
        'officecdn.microsoft.com.edgesuite.net',
        'otelrules.azureedge.net',
        //Optional Services
        '*.virtualearth.net',
        'c.bing.net',
        'ocos-office365-s2s.msedge.net',
        'tse1.mm.bing.net',
        'www.bing.com',
        '*.acompli.net',
        '*.outlookmobile.com',
        'login.windows-ppe.net',
        'account.live.com',
        'www.acompli.com',
        '*.appex-rf.msn.com',
        '*.appex.bing.com',
        'c.live.com',
        'partnerservices.getmicrosoftkey.com',
        'signup.live.com',
        '*.assets-yammer.com',
        'www.outlook.com',
        'eus-www.sway-cdn.com',
        'eus-www.sway-extensions.com',
        'wus-www.sway-cdn.com',
        'wus-www.sway-extensions.com',
        'sway.com',
        'www.sway.com',
        //Certificate Authorities
        '*.entrust.net',
        '*.geotrust.com',
        '*.omniroot.com',
        '*.public-trust.com',
        '*.symcb.com',
        '*.symcd.com',
        '*.verisign.com',
        '*.verisign.net',
        'cacerts.digicert.com',
        'cert.int-x3.letsencrypt.org',
        'crl.globalsign.com',
        'crl.globalsign.net',
        'crl.identrust.com',
        'crl3.digicert.com',
        'crl4.digicert.com',
        'isrg.trustid.ocsp.identrust.com',
        'mscrl.microsoft.com',
        'ocsp.digicert.com',
        'ocsp.globalsign.com',
        'ocsp.msocsp.com',
        'ocsp2.globalsign.com',
        'ocspx.digicert.com',
        'oneocsp.microsoft.com',
        'secure.globalsign.com',
        'www.digicert.com',
        'www.microsoft.com',
        //Office Features
        'officespeech.platform.bing.com',
        '*.office.com',
        'www.microsoft365.com',
        '*.microsoftusercontent.com',
        '*.azure-apim.net',
        '*.flow.microsoft.com',
        '*.powerapps.com',
        '*.powerautomate.com',
        '*.activity.windows.com',
        'activity.windows.com',
        '*.cortana.ai',
        'admin.microsoft.com',
        'cdn.uci.officeapps.live.com',
      ],
      protocols: [
        { protocolType: 'Http', port: 80 },
        { protocolType: 'Https', port: 443 },
      ],
    });
  }

  if (allowsWindowsUpdate) {
    builder.addAppRule('windows-update-app', {
      description: 'Allows Windows Updates',
      sourceAddresses,
      targetFqdns: ['WindowsUpdate', 'WindowsDiagnostics'],
      protocols: [{ protocolType: 'Https', port: 443 }],
    });
  }

  return builder;
}

export function defaultDeniedPolicies(priority: number = 6001) {
  return new FirewallPolicyBuilder('default-denied', { priority, action: 'Deny' })
    .addAppRule('deny-everything-else', {
      description: 'Default Deny Everything Else',
      protocols: [
        { protocolType: 'Http', port: 80 },
        { protocolType: 'Https', port: 443 },
        { protocolType: 'Mssql', port: 1433 },
      ],
      sourceAddresses: ['*'],
      targetFqdns: ['*'],
    })
    .build();
}

export function allowsCloudflareTunnels({
  name = 'cf-tunnels',
  priority,
  sourceAddresses,
  internalDestinationAddresses,
  internalDestinationPorts,
}: {
  name?: string;
  priority: number;
  sourceAddresses: pulumi.Input<string>[];
  /**Allows tunnels access to these addresses only*/
  internalDestinationAddresses?: pulumi.Input<string>[];
  /**Allows tunnels access to these ports only*/
  internalDestinationPorts?: pulumi.Input<string>[];
}) {
  const builder = new FirewallPolicyBuilder(name, { priority, action: 'Allow' })
    .addNetRule('net', {
      description: 'Allows CF Tunnel to access to Cloudflare.',
      ipProtocols: ['TCP', 'UDP'],
      sourceAddresses,
      destinationAddresses: [
        '198.41.192.167',
        '198.41.192.67',
        '198.41.192.57',
        '198.41.192.107',
        '198.41.192.27',
        '198.41.192.7',
        '198.41.192.227',
        '198.41.192.47',
        '198.41.192.37',
        '198.41.192.77',
        '198.41.200.13',
        '198.41.200.193',
        '198.41.200.33',
        '198.41.200.233',
        '198.41.200.53',
        '198.41.200.63',
        '198.41.200.113',
        '198.41.200.73',
        '198.41.200.43',
        '198.41.200.23',
      ],
      destinationPorts: ['7844'],
    })
    .addAppRule('app', {
      description: 'Allows CF Tunnel to access to Cloudflare.',
      sourceAddresses,
      targetFqdns: ['*.argotunnel.com', '*.cftunnel.com', '*.cloudflareaccess.com', '*.cloudflareresearch.com'],
      protocols: [
        { protocolType: 'Https', port: 443 },
        { protocolType: 'Https', port: 7844 },
      ],
    });

  if (internalDestinationAddresses && internalDestinationPorts) {
    builder.addNetRule('internal', {
      description: 'Allows CF Tunnel to access to Internals.',
      ipProtocols: ['TCP'],
      sourceAddresses,
      destinationAddresses: internalDestinationAddresses,
      destinationPorts: internalDestinationPorts,
    });
  }

  return builder.build();
}

/** These rules are not required for Private AKS */
export function allowsAksPolicies({
  name = 'aks',
  priority,
  subnetAddressSpaces,
  privateCluster,
}: {
  name?: string;
  priority: number;
  privateCluster?: boolean;
  subnetAddressSpaces: Array<pulumi.Input<string>>;
  /** the name of Azure Container registry allows access from Azure AKS */
  allowsAcrs?: pulumi.Input<string>[];
}) {
  const builder = new FirewallPolicyBuilder(name, { priority, action: 'Allow' });
  if (!privateCluster) {
    builder
      .addNetRule('udp', {
        description: 'For tunneled secure communication between the nodes and the control plane.',
        ipProtocols: ['UDP'],
        sourceAddresses: subnetAddressSpaces,
        destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`],
        destinationPorts: ['1194'],
      })
      .addNetRule('tcp', {
        description: 'For tunneled secure communication between the nodes and the control plane.',
        ipProtocols: ['TCP'],
        sourceAddresses: subnetAddressSpaces,
        destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`],
        destinationPorts: ['9000'],
      });
  }

  builder
    .addNetRule('dns', {
      description: 'Allows DNS resolution for the cluster nodes',
      ipProtocols: ['UDP'],
      sourceAddresses: subnetAddressSpaces,
      //The basic firewall is not allows destinationFqdns tags, so we use wildcard
      destinationAddresses: ['*'],
      destinationPorts: ['53'],
    })
    .addNetRule('ubuntu', {
      description: 'Required for Network Time Protocol (NTP) time synchronization on Linux nodes',
      ipProtocols: ['UDP'],
      sourceAddresses: subnetAddressSpaces,
      //The basic firewall is not allows destinationFqdns tags, so we use wildcard
      destinationAddresses: ['*'],
      destinationPorts: ['123'],
    })
    .addNetRule('aks-monitor', {
      description: 'This endpoint is used to send metrics data and logs to Azure Monitor and Log Analytics.',
      ipProtocols: ['TCP'],
      sourceAddresses: subnetAddressSpaces,
      destinationAddresses: ['AzureMonitor'],
      destinationPorts: ['443'],
    });

  builder
    //App
    .addAppRule('acrs', {
      description: 'Allows pods to access AzureKubernetesService',
      sourceAddresses: subnetAddressSpaces,
      targetFqdns: [
        `*.hcp.${azureEnv.currentRegionCode}.azmk8s.io`,
        'mcr.microsoft.com',
        '*.data.mcr.microsoft.com',
        'mcr-0001.mcr-msedge.net',
        'management.azure.com',
        'login.microsoftonline.com',
        'packages.microsoft.com',
        'acs-mirror.azureedge.net',
        'packages.aks.azure.com',
        //Defender for Containers and Monitoring
        '*.ods.opinsights.azure.com',
        '*.oms.opinsights.azure.com',
        '*.cloud.defender.microsoft.com',
        '*.in.applicationinsights.azure.com',
        '*.monitoring.azure.com',
        'global.handler.control.monitor.azure.com',
        '*.ingest.monitor.azure.com',
        '*.metrics.ingest.monitor.azure.com',
        `${azureEnv.currentRegionCode}.handler.control.monitor.azure.com`,
        //Key Vault
        'vault.azure.net',
        '*.vault.usgovcloudapi.net',
      ],
      protocols: [{ protocolType: 'Https', port: 443 }],
    });

  return builder;
}
