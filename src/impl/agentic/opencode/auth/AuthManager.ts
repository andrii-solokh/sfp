import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Type for OpencodeClient - using any due to ESM module import issues
type OpencodeClient = any;

export interface AuthProvider {
    id: string;
    name: string;
    env: string[];
    plugin?: string;
    requiresAuth: boolean;
}

export const AUTH_PROVIDERS: Record<string, AuthProvider> = {
    anthropic: {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        env: ['ANTHROPIC_API_KEY'],
        plugin: 'anthropic',
        requiresAuth: true
    },
    'github-copilot': {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        env: [],
        plugin: 'copilot',
        requiresAuth: true
    },
    openai: {
        id: 'openai',
        name: 'OpenAI',
        env: ['OPENAI_API_KEY'],
        requiresAuth: true
    },
    'amazon-bedrock': {
        id: 'amazon-bedrock',
        name: 'Amazon Bedrock',
        env: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION'],
        requiresAuth: true
    }
};

export class AuthManager {
    private logger?: Logger;
    private client: OpencodeClient;
    private authFilePath: string;

    constructor(client: OpencodeClient, logger?: Logger) {
        this.logger = logger;
        this.client = client;
        // Use the same auth file as the CLI command
        const homeDir = os.homedir();
        const sfpDir = path.join(homeDir, '.sfp');
        this.authFilePath = path.join(sfpDir, 'ai-auth.json');
    }

    /**
     * Check if a provider has authentication available (env var or stored)
     */
    public async hasAuth(providerId: string): Promise<boolean> {
        const provider = AUTH_PROVIDERS[providerId];
        if (!provider) return false;

        // Check environment variables
        if (provider.env && provider.env.length > 0) {
            // For AWS Bedrock, both env vars must be present
            if (providerId === 'amazon-bedrock') {
                const hasToken = !!process.env['AWS_BEARER_TOKEN_BEDROCK'];
                const hasRegion = !!process.env['AWS_REGION'];
                if (hasToken && hasRegion) {
                    return true;
                }
            } else {
                // For other providers, any env var is sufficient
                for (const envVar of provider.env) {
                    if (process.env[envVar]) {
                        return true;
                    }
                }
            }
        }

        // Check our persistent storage
        try {
            if (await fs.pathExists(this.authFilePath)) {
                const auth = await fs.readJson(this.authFilePath);
                return auth[providerId] !== undefined;
            }
        } catch (error) {
            // Ignore errors
        }
        return false;
    }

    /**
     * Configure authentication for a provider in OpenCode
     */
    public async configureAuth(providerId: string): Promise<boolean> {
        const provider = AUTH_PROVIDERS[providerId];
        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR, this.logger);
            return false;
        }

        // First try environment variables
        if (provider.env && provider.env.length > 0) {
            // Special handling for AWS Bedrock - needs both env vars
            if (providerId === 'amazon-bedrock') {
                const token = process.env['AWS_BEARER_TOKEN_BEDROCK'];
                const region = process.env['AWS_REGION'];

                if (token && region) {
                    try {
                        await this.client.auth.set({
                            path: { id: providerId },
                            body: {
                                type: 'api',
                                key: token,
                                region: region  // Store region as metadata
                            }
                        });
                        SFPLogger.log(`✅ Configured ${providerId} authentication with token and region`, LoggerLevel.INFO, this.logger);
                        return true;
                    } catch (error) {
                        SFPLogger.log(`Failed to set ${providerId} auth: ${error.message}`, LoggerLevel.ERROR, this.logger);
                    }
                }
            } else {
                // For other providers, use the first available env var
                for (const envVar of provider.env) {
                    const value = process.env[envVar];
                    if (value) {
                        try {
                            await this.client.auth.set({
                                path: { id: providerId },
                                body: {
                                    type: 'api',
                                    key: value
                                }
                            });
                            SFPLogger.log(`✅ Configured ${providerId} authentication from ${envVar}`, LoggerLevel.INFO, this.logger);
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
            if (await fs.pathExists(this.authFilePath)) {
                const auth = await fs.readJson(this.authFilePath);
                const storedAuth = auth[providerId];
                if (storedAuth) {
                    // Set the stored auth in the OpenCode client for this session
                    await this.client.auth.set({
                        path: { id: providerId },
                        body: storedAuth
                    });
                    SFPLogger.log(`✅ ${providerId} authentication loaded from stored credentials`, LoggerLevel.INFO, this.logger);
                    return true;
                }
            }
        } catch (error) {
            SFPLogger.log(`Failed to load stored auth: ${error.message}`, LoggerLevel.DEBUG, this.logger);
        }

        // Check if already authenticated via env
        if (await this.hasAuth(providerId)) {
            SFPLogger.log(`${providerId} authentication already configured`, LoggerLevel.INFO, this.logger);
            return true;
        }

        SFPLogger.log(`No authentication found for ${providerId}`, LoggerLevel.ERROR, this.logger);
        SFPLogger.log(`Please set ${provider.env.join(' or ')} environment variable`, LoggerLevel.INFO, this.logger);
        return false;
    }

    /**
     * Get supported providers
     */
    public getSupportedProviders(): string[] {
        return Object.keys(AUTH_PROVIDERS);
    }

    /**
     * Get provider display name
     */
    public getProviderName(providerId: string): string {
        return AUTH_PROVIDERS[providerId]?.name || providerId;
    }

}