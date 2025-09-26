import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import { AuthManager } from './auth/AuthManager';

// Type for OpencodeClient - using any due to ESM module import issues
type OpencodeClient = any;

export class OpenCodeSessionManager {
    private sessionId: string | null = null;
    private logger?: Logger;
    private authManager: AuthManager;
    private authConfigured: boolean = false;
    private providerId: string;
    private modelId: string;

    constructor(
        private client: OpencodeClient,
        providerId: string,
        modelId: string,
        logger?: Logger
    ) {
        this.logger = logger;
        this.providerId = providerId;
        this.modelId = modelId;
        this.authManager = new AuthManager(client, logger);
    }

    async configureAuthentication(): Promise<void> {
        try {
            SFPLogger.log(`🔐 Configuring authentication for ${this.providerId}...`, LoggerLevel.DEBUG, this.logger);

            const success = await this.authManager.configureAuth(this.providerId);
            if (!success) {
                throw new Error(`Failed to configure authentication for ${this.providerId}`);
            }

            this.authConfigured = true;
            SFPLogger.log('✅ Authentication configured', LoggerLevel.DEBUG, this.logger);
        } catch (error) {
            throw new Error(`Failed to configure authentication: ${error.message}`);
        }
    }

    async createSession(title: string = 'Salesforce Repository Analysis'): Promise<string> {
        try {
            // Ensure authentication is configured
            if (!this.authConfigured) {
                await this.configureAuthentication();
            }

            SFPLogger.log('🤖 Creating AI session...', LoggerLevel.INFO, this.logger);

            const response = await this.client.session.create({
                body: {
                    title
                }
            });

            // Handle both response formats (with or without data wrapper)
            const sessionId = response?.data?.id || response?.id;

            if (!sessionId) {
                throw new Error(`Failed to create session - no session ID returned. Response: ${JSON.stringify(response)}`);
            }

            this.sessionId = sessionId;
            SFPLogger.log(`✅ AI session created: ${this.sessionId}`, LoggerLevel.INFO, this.logger);

            return this.sessionId;
        } catch (error) {
            throw new Error(`Failed to create session: ${error.message}`);
        }
    }

    async deleteSession(): Promise<void> {
        if (!this.sessionId) {
            return;
        }

        try {
            await this.client.session.delete({
                path: {
                    id: this.sessionId
                }
            });
            SFPLogger.log('🛑 Session closed', LoggerLevel.DEBUG, this.logger);
        } catch (error) {
            SFPLogger.log(`Failed to delete session: ${error.message}`, LoggerLevel.DEBUG, this.logger);
        } finally {
            this.sessionId = null;
        }
    }

    getSessionId(): string {
        if (!this.sessionId) {
            throw new Error('Session not created. Call createSession() first.');
        }
        return this.sessionId;
    }

    isSessionActive(): boolean {
        return this.sessionId !== null;
    }

    getModelConfig() {
        return {
            providerID: this.providerId,
            modelID: this.modelId
        };
    }

    getProviderId(): string {
        return this.providerId;
    }

    getModelId(): string {
        return this.modelId;
    }
}