import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { OpenCodeAgent } from '../../agentic/opencode/OpenCodeAgent';
import { AgentOptions } from '../../agentic/opencode/types';
import { OpencodeCliChecker } from '../../../core/utils/OpencodeCliChecker';

export interface AuthProvider {
    id: string;
    name: string;
    env: string[];
    plugin?: string;
    requiresAuth: boolean;
    icon?: string;
}

export interface AuthStatus {
    provider: string;
    name: string;
    configured: boolean;
    icon: string;
    envVars?: { name: string; isSet: boolean }[];
    hasStoredAuth?: boolean;
    warnings?: string[];
}

export interface TestResult {
    provider: string;
    success: boolean;
    responseTime?: number;
    model?: string;
    error?: string;
}

export const AUTH_PROVIDERS: Record<string, AuthProvider> = {
    anthropic: {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        env: ['ANTHROPIC_API_KEY'],
        plugin: 'anthropic',
        requiresAuth: true,
        icon: '🤖'
    },
    'github-copilot': {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        env: [],
        plugin: 'copilot',
        requiresAuth: true,
        icon: '🐙'
    },
    openai: {
        id: 'openai',
        name: 'OpenAI',
        env: ['OPENAI_API_KEY'],
        requiresAuth: true,
        icon: '🧠'
    },
    'amazon-bedrock': {
        id: 'amazon-bedrock',
        name: 'Amazon Bedrock',
        env: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION'],
        requiresAuth: true,
        icon: '☁️'
    }
};

// Default models for each provider
export const DEFAULT_MODELS: Record<string, string> = {
    'anthropic': 'claude-sonnet-4-20250514',  // Current default for anthropic
    'github-copilot': 'claude-sonnet-4',       // Default for GitHub Copilot
    'amazon-bedrock': 'anthropic.claude-sonnet-4-20250514-v1:0', // Default for AWS Bedrock
    'openai': 'gpt-5'            // Default for OpenAI
};

export class AIAuthService {
    private logger?: Logger;
    private authFilePath: string;

    constructor(logger?: Logger) {
        this.logger = logger;
        const homeDir = os.homedir();
        const sfpDir = path.join(homeDir, '.sfp');
        this.authFilePath = path.join(sfpDir, 'ai-auth.json');
        fs.ensureDirSync(sfpDir);
    }

    /**
     * Get authentication status for a specific provider
     */
    public async getProviderStatus(providerId: string): Promise<AuthStatus | undefined> {
        const provider = AUTH_PROVIDERS[providerId];
        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR, this.logger);
            return undefined;
        }

        const status: AuthStatus = {
            provider: providerId,
            name: provider.name,
            configured: false,
            icon: provider.icon || '📦',
            envVars: [],
            warnings: []
        };

        // Check environment variables
        if (provider.env && provider.env.length > 0) {
            if (providerId === 'amazon-bedrock') {
                const tokenSet = !!process.env['AWS_BEARER_TOKEN_BEDROCK'];
                const regionSet = !!process.env['AWS_REGION'];

                status.envVars = [
                    { name: 'AWS_BEARER_TOKEN_BEDROCK', isSet: tokenSet },
                    { name: 'AWS_REGION', isSet: regionSet }
                ];

                status.configured = tokenSet && regionSet;

                if (tokenSet && !regionSet) {
                    status.warnings?.push('Token is set but region is missing');
                } else if (!tokenSet && regionSet) {
                    status.warnings?.push('Region is set but token is missing');
                }
            } else {
                status.envVars = provider.env.map(envVar => ({
                    name: envVar,
                    isSet: !!process.env[envVar]
                }));

                status.configured = status.envVars.some(v => v.isSet);
            }
        }

        // Check stored credentials
        const storedAuth = await this.getStoredAuth(providerId);
        if (storedAuth) {
            status.hasStoredAuth = true;
            if (!status.configured) {
                status.configured = true;
            }
        }

        return status;
    }

    /**
     * Get authentication status for all providers
     */
    public async getAllProvidersStatus(): Promise<AuthStatus[]> {
        const statuses: AuthStatus[] = [];

        for (const providerId of Object.keys(AUTH_PROVIDERS)) {
            const status = await this.getProviderStatus(providerId);
            if (status) {
                statuses.push(status);
            }
        }

        return statuses;
    }

    /**
     * Check if a provider has authentication available
     */
    public async hasAuth(providerId: string): Promise<boolean> {
        const status = await this.getProviderStatus(providerId);
        return status?.configured || false;
    }

    /**
     * Authenticate a provider interactively (with prompts)
     */
    public async authenticateProvider(providerId: string, credentials?: any): Promise<boolean> {
        const provider = AUTH_PROVIDERS[providerId];
        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR, this.logger);
            return false;
        }

        // Check if already authenticated via env
        if (await this.hasAuth(providerId)) {
            SFPLogger.log(`${providerId} already authenticated`, LoggerLevel.INFO, this.logger);
            return true;
        }

        // Handle OAuth if plugin is available and no credentials provided
        if (provider.plugin && !credentials) {
            return await this.performOAuthAuthentication(providerId);
        }

        // Save provided credentials or prompt will be handled by CLI
        if (credentials) {
            // Handle OAuth result objects (from OAuth flow)
            if (credentials.type === 'success' || credentials.refresh || credentials.access !== undefined) {
                // This is an OAuth result object
                await this.saveAuth(providerId, credentials);
                SFPLogger.log(`${providerId} OAuth credentials saved`, LoggerLevel.INFO, this.logger);
                return true;
            } else if (providerId === 'amazon-bedrock' && credentials.token && credentials.region) {
                await this.saveAuth(providerId, {
                    type: 'api',
                    key: credentials.token,
                    region: credentials.region
                });
                SFPLogger.log(`AWS Bedrock credentials saved`, LoggerLevel.INFO, this.logger);
                return true;
            } else if (credentials.apiKey) {
                await this.saveAuth(providerId, {
                    type: 'api',
                    key: credentials.apiKey
                });
                SFPLogger.log(`API key saved for ${providerId}`, LoggerLevel.INFO, this.logger);
                return true;
            }
        }

        return false;
    }

    /**
     * Check inference capability of a provider
     */
    public async checkProvider(providerId: string, modelId?: string): Promise<TestResult> {
        const provider = AUTH_PROVIDERS[providerId];
        if (!provider) {
            return {
                provider: providerId,
                success: false,
                error: `Unknown provider: ${providerId}`
            };
        }

        // Check authentication
        if (!await this.hasAuth(providerId)) {
            return {
                provider: providerId,
                success: false,
                error: 'Authentication not configured'
            };
        }

        // Use default model if not provided
        const effectiveModelId = modelId || DEFAULT_MODELS[providerId];

        if (!effectiveModelId) {
            return {
                provider: providerId,
                success: false,
                error: `No model specified and no default model available for ${provider.name}`
            };
        }

        const startTime = Date.now();
        let agent: OpenCodeAgent | null = null;

        try {
            const agentOptions: AgentOptions = {
                projectPath: process.cwd(),
                providerId: providerId,
                modelId: effectiveModelId,
                logger: this.logger
            };

            agent = new OpenCodeAgent(agentOptions);
            await agent.initialize();

            const testPrompt = {
                name: 'test-inference',
                content: 'Please respond with a simple greeting and confirm you are working. Keep it under 20 words.'
            };

            await agent.executePrompt(testPrompt);
            const responseTime = Date.now() - startTime;

            return {
                provider: providerId,
                success: true,
                responseTime,
                model: effectiveModelId
            };
        } catch (error) {
            return {
                provider: providerId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        } finally {
            if (agent) {
                try {
                    await agent.cleanup();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }

    /**
     * Check all configured providers
     */
    public async checkAllProviders(): Promise<TestResult[]> {
        const results: TestResult[] = [];

        for (const providerId of Object.keys(AUTH_PROVIDERS)) {
            const result = await this.checkProvider(providerId);
            results.push(result);
            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }

    /**
     * Configure authentication in OpenCode client
     */
    public async configureAuthInClient(client: any, providerId: string): Promise<boolean> {
        const provider = AUTH_PROVIDERS[providerId];
        if (!provider) return false;

        // Check environment variables first
        if (provider.env && provider.env.length > 0) {
            if (providerId === 'amazon-bedrock') {
                const token = process.env['AWS_BEARER_TOKEN_BEDROCK'];
                const region = process.env['AWS_REGION'];

                if (token && region) {
                    try {
                        await client.auth.set({
                            path: { id: providerId },
                            body: {
                                type: 'api',
                                key: token,
                                region: region
                            }
                        });
                        SFPLogger.log(`Configured ${providerId} authentication`, LoggerLevel.INFO, this.logger);
                        return true;
                    } catch (error) {
                        SFPLogger.log(`Failed to set ${providerId} auth: ${error.message}`, LoggerLevel.ERROR, this.logger);
                    }
                }
            } else {
                for (const envVar of provider.env) {
                    const value = process.env[envVar];
                    if (value) {
                        try {
                            await client.auth.set({
                                path: { id: providerId },
                                body: {
                                    type: 'api',
                                    key: value
                                }
                            });
                            SFPLogger.log(`Configured ${providerId} authentication from ${envVar}`, LoggerLevel.INFO, this.logger);
                            return true;
                        } catch (error) {
                            SFPLogger.log(`Failed to set ${providerId} auth: ${error.message}`, LoggerLevel.ERROR, this.logger);
                        }
                    }
                }
            }
        }

        // Check stored credentials
        try {
            const storedAuth = await this.getStoredAuth(providerId);
            if (storedAuth) {
                await client.auth.set({
                    path: { id: providerId },
                    body: storedAuth
                });
                SFPLogger.log(`${providerId} authentication loaded from stored credentials`, LoggerLevel.INFO, this.logger);
                return true;
            }
        } catch (error) {
            SFPLogger.log(`Failed to load stored auth: ${error.message}`, LoggerLevel.DEBUG, this.logger);
        }

        return false;
    }

    /**
     * Get list of supported providers
     */
    public getSupportedProviders(): string[] {
        return Object.keys(AUTH_PROVIDERS);
    }

    /**
     * Get provider information
     */
    public getProvider(providerId: string): AuthProvider | undefined {
        return AUTH_PROVIDERS[providerId];
    }

    /**
     * Get all providers
     */
    public getAllProviders(): AuthProvider[] {
        return Object.values(AUTH_PROVIDERS);
    }

    /**
     * Get default model for a provider
     */
    public getDefaultModel(providerId: string): string | undefined {
        return DEFAULT_MODELS[providerId];
    }

    // Private methods

    private async performOAuthAuthentication(providerId: string): Promise<boolean> {
        try {
            // Check if OpenCode CLI is installed
            if (!OpencodeCliChecker.checkAndWarn('OAuth authentication')) {
                SFPLogger.log('OpenCode CLI not available for OAuth', LoggerLevel.WARN, this.logger);
                return false;
            }

            // OAuth authentication requires user interaction
            // This must be handled by the command layer
            // Return false to indicate OAuth needs to be handled by the caller
            return false;
        } catch (error) {
            SFPLogger.log(`OAuth authentication failed: ${error.message}`, LoggerLevel.ERROR, this.logger);
            return false;
        }
    }

    private async saveAuth(providerId: string, auth: any): Promise<void> {
        try {
            const existing = await this.loadAuthFile();
            existing[providerId] = auth;
            await fs.writeJson(this.authFilePath, existing, { spaces: 2 });
            await fs.chmod(this.authFilePath, 0o600);
            SFPLogger.log(`Authentication saved for ${providerId}`, LoggerLevel.DEBUG, this.logger);
        } catch (error) {
            SFPLogger.log(`Failed to save authentication: ${error.message}`, LoggerLevel.ERROR, this.logger);
            throw error;
        }
    }

    private async getStoredAuth(providerId: string): Promise<any> {
        try {
            const auth = await this.loadAuthFile();
            return auth[providerId];
        } catch {
            return undefined;
        }
    }

    private async loadAuthFile(): Promise<Record<string, any>> {
        try {
            if (await fs.pathExists(this.authFilePath)) {
                return await fs.readJson(this.authFilePath);
            }
        } catch {
            // File doesn't exist or is corrupted
        }
        return {};
    }
}