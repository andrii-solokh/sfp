import SFPLogger, { LoggerLevel } from '@flxbl-io/sfp-logger';
import { Messages } from '@salesforce/core';
import { Flags } from '@oclif/core';
import SfpCommand from '../../SfpCommand';
import { loglevel } from '../../flags/sfdxflags';
import { AUTH_PROVIDERS } from '../../impl/agentic/opencode/auth/AuthManager';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { OpencodeCliChecker } from '../../core/utils/OpencodeCliChecker';
const chalk = require('chalk');
const inquirer = require('inquirer').default;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@flxbl-io/sfp', 'ai_auth');

export default class AIAuth extends SfpCommand {
    private authFilePath: string;

    constructor(argv: string[], config: any) {
        super(argv, config);
        // Store auth in ~/.sfp/ai-auth.json
        const homeDir = os.homedir();
        const sfpDir = path.join(homeDir, '.sfp');
        this.authFilePath = path.join(sfpDir, 'ai-auth.json');
        fs.ensureDirSync(sfpDir);
    }
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
            options: Object.keys(AUTH_PROVIDERS),
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

        // Validate auth flag requires provider
        if (flags.auth && !flags.provider) {
            SFPLogger.log('Error: --auth flag requires --provider to be specified', LoggerLevel.ERROR);
            return;
        }

        if (flags.list) {
            this.listProviders();
            return;
        }

        if (flags.provider) {
            if (flags.auth) {
                await this.authenticateProvider(flags.provider);
            } else {
                await this.checkProviderAuth(flags.provider);
            }
        } else {
            await this.showAuthStatus();
        }
    }

    private listProviders(): void {
        console.log('\n' + chalk.bold('Supported AI Providers:'));
        console.log(chalk.gray('─'.repeat(50)));

        for (const [id, provider] of Object.entries(AUTH_PROVIDERS)) {
            const icon = this.getProviderIcon(id);
            console.log(`${icon} ${chalk.cyan(provider.name)} (${chalk.gray(id)})`);

            if (provider.env.length > 0) {
                console.log(`   Environment: ${provider.env.join(', ')}`);
            }

            if (provider.plugin) {
                console.log(`   ${chalk.green('✓')} OAuth authentication available`);
            }
        }

        console.log('\n' + chalk.gray('Use --provider <name> to check specific provider authentication'));
    }

    private async checkProviderAuth(providerId: string): Promise<void> {
        const provider = AUTH_PROVIDERS[providerId];

        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR);
            return;
        }

        const icon = this.getProviderIcon(providerId);
        console.log('\n' + chalk.bold(`${icon} ${provider.name} Authentication Status`));
        console.log(chalk.gray('─'.repeat(50)));

        // Check environment variables
        let hasAuth = false;
        if (provider.env.length > 0) {
            console.log('\n' + chalk.yellow('Environment Variables:'));
            for (const envVar of provider.env) {
                const isSet = !!process.env[envVar];
                hasAuth = hasAuth || isSet;
                const status = isSet ? chalk.green('✓ Set') : chalk.red('✗ Not set');
                console.log(`  ${envVar}: ${status}`);
            }
        }

        // Check stored credentials
        const storedAuth = await this.getStoredAuth(providerId);
        if (storedAuth && !hasAuth) {
            console.log('\n' + chalk.yellow('Stored Credentials:'));
            console.log(`  ${chalk.green('✓')} Authentication saved`);
            hasAuth = true;
        }

        // Show OAuth availability
        if (provider.plugin) {
            console.log('\n' + chalk.yellow('OAuth Support:'));
            console.log(`  ${chalk.green('✓')} OAuth authentication available`);
            if (provider.plugin === 'anthropic') {
                console.log(`  Supports Claude Pro/Max free API access`);
            } else if (provider.plugin === 'copilot') {
                console.log(`  Supports GitHub Copilot authentication`);
            }
        }

        // Summary
        console.log('\n' + chalk.bold('Status:'));
        if (hasAuth) {
            console.log(chalk.green('  ✓ Ready to use'));
        } else {
            console.log(chalk.red('  ✗ Authentication required'));
            console.log('\n' + chalk.yellow('To authenticate:'));
            if (provider.env.length > 0) {
                console.log(`  1. Set environment variable: export ${provider.env[0]}=<your-api-key>`);
            }
            if (provider.plugin) {
                console.log(`  2. Or use OAuth: sfp ai auth --provider ${providerId} --auth`);
            }
        }
    }

    private async showAuthStatus(): Promise<void> {
        console.log('\n' + chalk.bold('AI Provider Authentication Status'));
        console.log(chalk.gray('─'.repeat(50)));

        const statuses: Array<{ provider: string; name: string; status: string; icon: string }> = [];

        for (const [id, provider] of Object.entries(AUTH_PROVIDERS)) {
            let hasAuth = false;

            // Check environment variables
            if (provider.env.length > 0) {
                hasAuth = provider.env.some(envVar => !!process.env[envVar]);
            }

            // Also check stored credentials
            if (!hasAuth) {
                const storedAuth = await this.getStoredAuth(id);
                hasAuth = !!storedAuth;
            }

            const icon = this.getProviderIcon(id);
            statuses.push({
                provider: id,
                name: provider.name,
                status: hasAuth ? chalk.green('✓ Configured') : chalk.gray('- Not configured'),
                icon,
            });
        }

        // Display table
        for (const { icon, name, status } of statuses) {
            console.log(`${icon} ${chalk.cyan(name.padEnd(20))} ${status}`);
        }

        console.log('\n' + chalk.gray('Use --list for detailed information'));
        console.log(chalk.gray('Use --provider <name> to check specific provider'));
    }

    private getProviderIcon(providerId: string): string {
        const icons: Record<string, string> = {
            'anthropic': '🤖',
            'github-copilot': '🐙'
        };
        return icons[providerId] || '📦';
    }

    private async authenticateProvider(providerId: string): Promise<void> {
        const provider = AUTH_PROVIDERS[providerId];

        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR);
            return;
        }

        const icon = this.getProviderIcon(providerId);
        console.log('\n' + chalk.bold(`${icon} Authenticating with ${provider.name}`));
        console.log(chalk.gray('─'.repeat(50)));

        // Check if already authenticated
        let hasAuth = false;
        if (provider.env.length > 0) {
            hasAuth = provider.env.some(envVar => !!process.env[envVar]);
        }

        if (hasAuth) {
            console.log(chalk.green('\n✓ Already authenticated via environment variable'));
            return;
        }

        // Handle OAuth authentication
        if (provider.plugin) {
            try {
                await this.performOAuthAuthentication(providerId, provider);
            } catch (error) {
                SFPLogger.log(`Authentication failed: ${error.message}`, LoggerLevel.ERROR);
            }
        } else {
            // For providers without OAuth, prompt for API key
            await this.promptForApiKey(providerId, provider);
        }
    }

    private async performOAuthAuthentication(providerId: string, provider: any): Promise<void> {
        console.log('\n' + chalk.yellow('Starting OAuth authentication...'));

        // Check if OpenCode CLI is installed before attempting OAuth
        if (!OpencodeCliChecker.checkAndWarn('OAuth authentication')) {
            console.log(chalk.yellow('\nFalling back to API key authentication...'));
            await this.promptForApiKey(providerId, provider);
            return;
        }

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
                    console.log('\n' + chalk.bold('Please authenticate:'));
                    console.log(chalk.cyan('Go to: ') + authorize.url);
                }

                if (authorize.instructions) {
                    console.log(chalk.yellow(authorize.instructions));
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
                        await this.saveAuth(providerId, result);
                        console.log(chalk.green('\n✓ Authentication successful!'));
                        console.log(chalk.gray(`Credentials saved to ${this.authFilePath}`));
                    } else {
                        console.log(chalk.red('\n✗ Authentication failed'));
                    }
                } else if (authorize.method === 'auto') {
                    console.log(chalk.gray('\nWaiting for authorization...'));
                    const result = await authorize.callback();
                    if (result.type === 'success') {
                        // Save to both OpenCode client (for current session) and our persistent storage
                        await client.auth.set({
                            path: { id: providerId },
                            body: result
                        });
                        await this.saveAuth(providerId, result);
                        console.log(chalk.green('\n✓ Authentication successful!'));
                        console.log(chalk.gray(`Credentials saved to ${this.authFilePath}`));
                    } else {
                        console.log(chalk.red('\n✗ Authentication failed'));
                    }
                }
            } else if (method.type === 'api') {
                await this.promptForApiKey(providerId, provider);
            }

        } finally {
            if (server) {
                server.close();
            }
        }
    }

    private async promptForApiKey(providerId: string, provider: any): Promise<void> {
        console.log('\n' + chalk.yellow('API Key Authentication'));

        const { apiKey } = await inquirer.prompt([{
            type: 'password',
            name: 'apiKey',
            message: `Enter your ${provider.name} API key:`,
            validate: (input: string) => input.length > 0 ? true : 'API key is required'
        }]);

        // Save the API key to our persistent storage
        await this.saveAuth(providerId, {
            type: 'api',
            key: apiKey
        });

        console.log(chalk.green('\n✓ API key saved successfully!'));
        console.log(chalk.gray(`Credentials saved to ${this.authFilePath}`));
        console.log('\nYou can now run your report generation command.');
    }

    private async saveAuth(providerId: string, auth: any): Promise<void> {
        try {
            const existing = await this.loadAuthFile();
            existing[providerId] = auth;
            await fs.writeJson(this.authFilePath, existing, { spaces: 2 });
            // Set file permissions to 0o600 (read/write for owner only)
            await fs.chmod(this.authFilePath, 0o600);
        } catch (error) {
            SFPLogger.log(`Failed to save authentication: ${error.message}`, LoggerLevel.ERROR);
        }
    }

    private async getStoredAuth(providerId: string): Promise<any> {
        try {
            const auth = await this.loadAuthFile();
            return auth[providerId];
        } catch (error) {
            return undefined;
        }
    }

    private async loadAuthFile(): Promise<Record<string, any>> {
        try {
            if (await fs.pathExists(this.authFilePath)) {
                return await fs.readJson(this.authFilePath);
            }
        } catch (error) {
            // File doesn't exist or is corrupted
        }
        return {};
    }
}