import SFPLogger, { LoggerLevel } from '@flxbl-io/sfp-logger';
import { Messages } from '@salesforce/core';
import { Flags } from '@oclif/core';
import SfpCommand from '../../SfpCommand';
import { loglevel } from '../../flags/sfdxflags';
import { AIAuthService } from '../../impl/ai/auth/AIAuthService';
import inquirer from 'inquirer';

Messages.importMessagesDirectory(__dirname);

export default class AIAuth extends SfpCommand {
    public static description = 'Manage AI provider authentication for report generation';
    public static enableJsonFlag = true;

    public static examples = [
        '$ sfp ai auth                          # Show authentication status',
        '$ sfp ai auth --provider anthropic     # Check specific provider',
        '$ sfp ai auth --provider anthropic --auth  # Authenticate with provider',
        '$ sfp ai auth --list                   # List all supported providers',
    ];

    public static flags = {
        ...SfpCommand.flags,
        provider: Flags.string({
            description: 'Check authentication for specific provider',
        }),
        list: Flags.boolean({
            description: 'List all supported providers',
            default: false,
        }),
        auth: Flags.boolean({
            description: 'Authenticate with the specified provider (requires --provider)',
            default: false,
        }),
        loglevel,
    };

    public async execute(): Promise<void> {
        const { flags } = await this.parse(AIAuth);
        const authService = new AIAuthService();

        // Validate auth flag requires provider
        if (flags.auth && !flags.provider) {
            SFPLogger.log('Error: --auth flag requires --provider to be specified', LoggerLevel.ERROR);
            return;
        }

        if (flags.list) {
            await this.listProviders(authService);
            return;
        }

        if (flags.provider) {
            if (flags.auth) {
                await this.authenticateProvider(authService, flags.provider);
            } else {
                await this.checkProviderAuth(authService, flags.provider);
            }
        } else {
            await this.showAuthStatus(authService);
        }
    }

    private async listProviders(authService: AIAuthService): Promise<void> {
        const providers = authService.getAllProviders();

        SFPLogger.log('\nSupported AI Providers:', LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        for (const provider of providers) {
            const icon = provider.icon || '📦';
            SFPLogger.log(`${icon} ${provider.name} (${provider.id})`, LoggerLevel.INFO);

            if (provider.env.length > 0) {
                SFPLogger.log(`   Environment: ${provider.env.join(', ')}`, LoggerLevel.INFO);
            }

            if (provider.plugin) {
                SFPLogger.log(`   ✓ OAuth authentication available`, LoggerLevel.INFO);
            }
        }

        SFPLogger.log('\nUse --provider <name> to check specific provider authentication', LoggerLevel.INFO);
    }

    private async checkProviderAuth(authService: AIAuthService, providerId: string): Promise<void> {
        const status = await authService.getProviderStatus(providerId);

        if (!status) {
            return; // Error already logged by service
        }

        SFPLogger.log(`\n${status.icon} ${status.name} Authentication Status`, LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        // Show environment variables
        if (status.envVars && status.envVars.length > 0) {
            SFPLogger.log('\nEnvironment Variables:', LoggerLevel.INFO);
            for (const envVar of status.envVars) {
                const statusText = envVar.isSet ? '✓ Set' : '✗ Not set';
                SFPLogger.log(`  ${envVar.name}: ${statusText}`, LoggerLevel.INFO);
            }

            // Show warnings if any
            if (status.warnings && status.warnings.length > 0) {
                for (const warning of status.warnings) {
                    SFPLogger.log(`  ⚠ ${warning}`, LoggerLevel.WARN);
                }
            }
        }

        // Show stored credentials
        if (status.hasStoredAuth) {
            SFPLogger.log('\nStored Credentials:', LoggerLevel.INFO);
            SFPLogger.log('  ✓ Authentication saved', LoggerLevel.INFO);
        }

        // Show OAuth availability
        const provider = authService.getProvider(providerId);
        if (provider?.plugin) {
            SFPLogger.log('\nOAuth Support:', LoggerLevel.INFO);
            SFPLogger.log('  ✓ OAuth authentication plugin available', LoggerLevel.INFO);

            if (provider.plugin === 'anthropic') {
                SFPLogger.log('  Supports Claude Pro/Max free API access', LoggerLevel.INFO);
                SFPLogger.log('  To authenticate: Install opencode-anthropic-auth plugin', LoggerLevel.INFO);
            } else if (provider.plugin === 'copilot') {
                SFPLogger.log('  Supports GitHub Copilot authentication', LoggerLevel.INFO);
                SFPLogger.log('  To authenticate: Install opencode-copilot-auth plugin', LoggerLevel.INFO);
            }
        }

        // Summary
        SFPLogger.log('\nStatus:', LoggerLevel.INFO);
        if (status.configured) {
            SFPLogger.log('  ✓ Ready to use', LoggerLevel.INFO);
        } else {
            SFPLogger.log('  ✗ Authentication required', LoggerLevel.ERROR);
            SFPLogger.log('\nTo authenticate:', LoggerLevel.INFO);

            if (status.envVars && status.envVars.length > 0) {
                if (providerId === 'amazon-bedrock') {
                    SFPLogger.log('  1. Set environment variables: export AWS_BEARER_TOKEN_BEDROCK=<token> AWS_REGION=<region>', LoggerLevel.INFO);
                } else {
                    SFPLogger.log(`  1. Set environment variable: export ${status.envVars[0].name}=<your-api-key>`, LoggerLevel.INFO);
                }
            }

            if (provider?.plugin) {
                SFPLogger.log(`  2. Or use OAuth: sfp ai auth --provider ${providerId} --auth`, LoggerLevel.INFO);
            }
        }

        if (this.jsonEnabled()) {
            SFPLogger.log(JSON.stringify(status, null, 2), LoggerLevel.INFO);
        }
    }

    private async showAuthStatus(authService: AIAuthService): Promise<void> {
        const statuses = await authService.getAllProvidersStatus();

        SFPLogger.log('\nAI Provider Authentication Status', LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        for (const status of statuses) {
            const statusText = status.configured ? '✓ Configured' : '- Not configured';
            SFPLogger.log(`${status.icon} ${status.name.padEnd(20)} ${statusText}`, LoggerLevel.INFO);
        }

        SFPLogger.log('\nUse --list for detailed information', LoggerLevel.INFO);
        SFPLogger.log('Use --provider <name> to check specific provider', LoggerLevel.INFO);

        if (this.jsonEnabled()) {
            SFPLogger.log(JSON.stringify(statuses, null, 2), LoggerLevel.INFO);
        }
    }

    private async authenticateProvider(authService: AIAuthService, providerId: string): Promise<void> {
        const provider = authService.getProvider(providerId);

        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR);
            return;
        }

        SFPLogger.log(`\n${provider.icon} Authenticating with ${provider.name}`, LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        // Check if already authenticated
        if (await authService.hasAuth(providerId)) {
            SFPLogger.log('\n✓ Already authenticated via environment variable', LoggerLevel.INFO);
            return;
        }

        // Handle OAuth or prompt for credentials
        if (provider.plugin) {
            try {
                // Perform OAuth authentication directly in the command
                const success = await this.performOAuthAuthentication(authService, providerId, provider);
                if (!success) {
                    SFPLogger.log('\nFalling back to API key authentication...', LoggerLevel.INFO);
                    await this.promptForCredentials(authService, providerId);
                }
            } catch (error) {
                SFPLogger.log(`OAuth authentication failed: ${error.message}`, LoggerLevel.ERROR);
                SFPLogger.log('\nFalling back to API key authentication...', LoggerLevel.INFO);
                await this.promptForCredentials(authService, providerId);
            }
        } else {
            await this.promptForCredentials(authService, providerId);
        }
    }

    private async performOAuthAuthentication(authService: AIAuthService, providerId: string, provider: any): Promise<boolean> {
        SFPLogger.log('\nStarting OAuth authentication...', LoggerLevel.INFO);

        // Start OpenCode server for OAuth flow
        let server: any;
        let client: any;

        try {
            // Dynamic import for ESM module
            const opencodeModule = await import('@opencode-ai/sdk');
            const { createOpencodeServer, createOpencodeClient } = opencodeModule;

            server = await createOpencodeServer({
                hostname: 'localhost',
                port: 4096
            });

            client = createOpencodeClient({
                baseUrl: server.url,
                responseStyle: 'data'
            });

            // Load the appropriate plugin
            let plugin: any;
            if (provider.plugin === 'anthropic') {
                const { AnthropicAuthPlugin } = await import('opencode-anthropic-auth');
                plugin = await AnthropicAuthPlugin({ client });
            } else if (provider.plugin === 'copilot') {
                const { CopilotAuthPlugin } = await import('opencode-copilot-auth');
                plugin = await CopilotAuthPlugin({ client });
            } else {
                throw new Error(`Unknown plugin: ${provider.plugin}`);
            }

            if (!plugin.auth || !plugin.auth.methods) {
                throw new Error('Plugin does not support authentication');
            }

            // Select authentication method
            let method: any;
            if (plugin.auth.methods.length === 1) {
                method = plugin.auth.methods[0];
            } else {
                const { selectedMethod } = await inquirer.prompt([{
                    type: 'list',
                    name: 'selectedMethod',
                    message: 'Select authentication method:',
                    choices: plugin.auth.methods.map((m: any, i: number) => ({
                        name: m.label,
                        value: i
                    }))
                }]);
                method = plugin.auth.methods[selectedMethod];
            }

            // Perform authentication
            if (method.type === 'oauth') {
                const authorize = await method.authorize();

                if (authorize.url) {
                    SFPLogger.log('\nPlease authenticate:', LoggerLevel.INFO);
                    SFPLogger.log(`Go to: ${authorize.url}`, LoggerLevel.INFO);
                }

                if (authorize.instructions) {
                    SFPLogger.log(authorize.instructions, LoggerLevel.INFO);
                }

                if (authorize.method === 'code') {
                    const { code } = await inquirer.prompt([{
                        type: 'input',
                        name: 'code',
                        message: 'Enter the authorization code:',
                        validate: (input: string) => input.length > 0
                    }]);

                    const result = await authorize.callback(code);
                    if (result.type === 'success') {
                        // Save to both OpenCode client (for current session) and our persistent storage
                        await client.auth.set({
                            path: { id: providerId },
                            body: result
                        });
                        await authService.authenticateProvider(providerId, result);
                        SFPLogger.log('\n✓ Authentication successful!', LoggerLevel.INFO);
                        return true;
                    } else {
                        SFPLogger.log('\n✗ Authentication failed', LoggerLevel.ERROR);
                        return false;
                    }
                } else if (authorize.method === 'auto') {
                    SFPLogger.log('\nWaiting for authorization...', LoggerLevel.INFO);
                    const result = await authorize.callback();
                    if (result.type === 'success') {
                        // Save to both OpenCode client (for current session) and our persistent storage
                        await client.auth.set({
                            path: { id: providerId },
                            body: result
                        });
                        await authService.authenticateProvider(providerId, result);
                        SFPLogger.log('\n✓ Authentication successful!', LoggerLevel.INFO);
                        return true;
                    } else {
                        SFPLogger.log('\n✗ Authentication failed', LoggerLevel.ERROR);
                        return false;
                    }
                }
            } else if (method.type === 'api') {
                // Fall back to API key
                return false;
            }

            return false;

        } finally {
            if (server) {
                server.close();
            }
        }
    }

    private async promptForCredentials(authService: AIAuthService, providerId: string): Promise<void> {
        const provider = authService.getProvider(providerId);
        if (!provider) return;

        SFPLogger.log('\nAPI Key Authentication', LoggerLevel.INFO);

        try {
            if (providerId === 'amazon-bedrock') {
                const { bearerToken, region } = await inquirer.prompt([
                    {
                        type: 'password',
                        name: 'bearerToken',
                        message: 'Enter your AWS Bedrock Bearer Token:',
                        validate: (input: string) => input.length > 0 ? true : 'Bearer token is required'
                    },
                    {
                        type: 'input',
                        name: 'region',
                        message: 'Enter your AWS Region (e.g., us-east-1):',
                        default: 'us-east-1',
                        validate: (input: string) => input.length > 0 ? true : 'Region is required'
                    }
                ]);

                const success = await authService.authenticateProvider(providerId, {
                    token: bearerToken,
                    region: region
                });

                if (success) {
                    SFPLogger.log('\n✓ AWS Bedrock credentials saved successfully!', LoggerLevel.INFO);
                } else {
                    SFPLogger.log('\n✗ Failed to save credentials', LoggerLevel.ERROR);
                }
            } else {
                const { apiKey } = await inquirer.prompt([{
                    type: 'password',
                    name: 'apiKey',
                    message: `Enter your ${provider.name} API key:`,
                    validate: (input: string) => input.length > 0 ? true : 'API key is required'
                }]);

                const success = await authService.authenticateProvider(providerId, { apiKey });

                if (success) {
                    SFPLogger.log('\n✓ API key saved successfully!', LoggerLevel.INFO);
                } else {
                    SFPLogger.log('\n✗ Failed to save API key', LoggerLevel.ERROR);
                }
            }
        } catch (error) {
            SFPLogger.log(`Authentication failed: ${error.message}`, LoggerLevel.ERROR);
        }
    }
}