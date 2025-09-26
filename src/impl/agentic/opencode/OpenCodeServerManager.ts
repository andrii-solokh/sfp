import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';

// Default OpenCode server configuration
const DEFAULT_OPENCODE_HOST = '127.0.0.1';
const DEFAULT_OPENCODE_PORT = 0; // Let the server pick a random port

// Type for OpencodeClient - using any due to ESM module import issues
type OpencodeClient = any;

export class OpenCodeServerManager {
    private server: { url: string; close: () => void } | null = null;
    private client: OpencodeClient | null = null;
    private logger?: Logger;

    constructor(logger?: Logger) {
        this.logger = logger;
    }

    async start(): Promise<OpencodeClient> {
        try {
            SFPLogger.log('🚀 Starting OpenCode server...', LoggerLevel.DEBUG, this.logger);

            // Dynamic import for ESM module
            const opencodeModule = await import('@opencode-ai/sdk');
            const { createOpencodeServer, createOpencodeClient } = opencodeModule;

            this.server = await createOpencodeServer({
                hostname: DEFAULT_OPENCODE_HOST,
                port: DEFAULT_OPENCODE_PORT
            });

            SFPLogger.log(`✅ OpenCode server started at ${this.server.url}`, LoggerLevel.DEBUG, this.logger);

            this.client = createOpencodeClient({
                baseUrl: this.server.url,
                responseStyle: 'data'
            });

            return this.client;
        } catch (error) {
            throw new Error(`Failed to start OpenCode server: ${error.message}`);
        }
    }

    async stop(): Promise<void> {
        if (this.server) {
            try {
                this.server.close();
                SFPLogger.log('🛑 OpenCode server stopped', LoggerLevel.DEBUG, this.logger);
            } catch (error) {
                SFPLogger.log(`Failed to stop server: ${error.message}`, LoggerLevel.DEBUG, this.logger);
            }
            this.server = null;
        }
        this.client = null;
    }

    getClient(): OpencodeClient {
        if (!this.client) {
            throw new Error('OpenCode client not initialized. Call start() first.');
        }
        return this.client;
    }

    getServerUrl(): string {
        if (!this.server) {
            throw new Error('OpenCode server not started');
        }
        return this.server.url;
    }
}