import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import { OpenCodeServerManager } from './OpenCodeServerManager';
import { OpenCodeSessionManager } from './OpenCodeSessionManager';
import { OpenCodeEventHandler } from './OpenCodeEventHandler';
import { AuthManager } from './auth/AuthManager';
import { AgentOptions, AgentPrompt, AgentResponse, OpenCodeClient } from './types';

// Default AI configuration
export const DEFAULT_PROVIDER = 'anthropic';
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const SYSTEM_PROMPT = `You are an AI assistant helping to analyze and work with Salesforce codebases.
You have access to file reading, writing  tools. Use them to explore the codebase and provide accurate, specific information.
When analyzing code, be thorough but concise. Provide concrete examples and actionable insights.`;

/**
 * Generic OpenCode agent that can execute AI prompts with file reading capabilities
 */
export class OpenCodeAgent {
    private serverManager: OpenCodeServerManager;
    private sessionManager: OpenCodeSessionManager | null = null;
    private eventHandler: OpenCodeEventHandler;
    private client: OpenCodeClient | null = null;
    private logger?: Logger;

    constructor(private options: AgentOptions) {
        this.logger = options.logger;

        // Set defaults if not provided
        if (!this.options.providerId) {
            this.options.providerId = DEFAULT_PROVIDER;
        }
        if (!this.options.modelId) {
            this.options.modelId = DEFAULT_MODEL;
        }

        this.serverManager = new OpenCodeServerManager(this.logger);
        this.eventHandler = new OpenCodeEventHandler(this.logger);
    }

    /**
     * Initialize the agent and establish connection
     */
    public async initialize(): Promise<void> {
        SFPLogger.log('🚀 Initializing OpenCode agent...', LoggerLevel.DEBUG, this.logger);
        SFPLogger.log(`🤖 Provider: ${this.options.providerId}, Model: ${this.options.modelId}`, LoggerLevel.INFO, this.logger);

        // Start server and get client
        this.client = await this.serverManager.start();

        // Configure authentication
        const authManager = new AuthManager(this.client, this.logger);
        const hasAuth = await authManager.configureAuth(this.options.providerId!);
        if (!hasAuth) {
            throw new Error(`Authentication not configured for ${this.options.providerId}`);
        }

        // Create session
        this.sessionManager = new OpenCodeSessionManager(
            this.client,
            this.options.providerId!,
            this.options.modelId!,
            this.logger
        );
        await this.sessionManager.createSession();
    }

    /**
     * Execute a single prompt and return the response
     */
    public async executePrompt(prompt: AgentPrompt, systemPrompt: string = SYSTEM_PROMPT): Promise<AgentResponse> {
        if (!this.client || !this.sessionManager) {
            throw new Error('Agent not initialized. Call initialize() first.');
        }

        try {
            SFPLogger.log(`🔍 Executing: ${prompt.name}...`, LoggerLevel.INFO, this.logger);

            const promptBody = {
                model: this.sessionManager.getModelConfig(),
                system: systemPrompt,
                parts: [
                    {
                        type: 'text',
                        text: this.buildPromptMessage(prompt)
                    }
                ]
            };

            // Start event subscription in background
            let eventController: AbortController | null = null;

            try {
                if (this.client.event && this.client.event.subscribe) {
                    SFPLogger.log('🔌 Connecting to event stream...', LoggerLevel.DEBUG, this.logger);
                    eventController = new AbortController();
                    this.startEventListener(eventController.signal);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (err) {
                SFPLogger.log(`Event subscription error: ${err.message}`, LoggerLevel.DEBUG, this.logger);
            }

            // Execute prompt
            const response = await this.client.session.prompt({
                path: {
                    id: this.sessionManager.getSessionId()
                },
                body: promptBody
            });

            // Stop event listener
            if (eventController) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                eventController.abort();
            }

            // Extract content
            const responseData = response?.data || response;
            if (!responseData) {
                throw new Error('No response received from AI');
            }

            const content = this.extractContent(responseData);
            if (!content) {
                throw new Error('No content extracted from AI response');
            }

            SFPLogger.log(`✓ Completed: ${prompt.name}`, LoggerLevel.INFO, this.logger);

            return {
                content: content,
                metadata: {
                    promptName: prompt.name,
                    model: this.options.modelId,
                    provider: this.options.providerId
                }
            };
        } catch (error) {
            SFPLogger.log(
                `Failed to execute ${prompt.name}: ${error.message}`,
                LoggerLevel.ERROR,
                this.logger
            );
            throw error;
        }
    }

    /**
     * Execute multiple prompts sequentially
     */
    public async executePrompts(prompts: AgentPrompt[], systemPrompt?: string): Promise<AgentResponse[]> {
        const responses: AgentResponse[] = [];

        for (const prompt of prompts) {
            const response = await this.executePrompt(prompt, systemPrompt);
            responses.push(response);
        }

        return responses;
    }

    /**
     * Clean up resources
     */
    public async cleanup(): Promise<void> {
        if (this.sessionManager) {
            await this.sessionManager.deleteSession();
            this.sessionManager = null;
        }

        await this.serverManager.stop();
        this.client = null;
    }

    private buildPromptMessage(prompt: AgentPrompt): string {
        let message = `Project Location: ${this.options.projectPath}\n\n`;

        if (prompt.context) {
            message += 'Context:\n';
            for (const [key, value] of Object.entries(prompt.context)) {
                message += `${key}: ${value}\n`;
            }
            message += '\n';
        }

        message += `Task: ${prompt.name}\n`;
        message += '================\n\n';
        message += prompt.content;

        return message.trim();
    }

    private startEventListener(signal: AbortSignal): void {
        (async () => {
            try {
                const response = await this.client!.event.subscribe();

                if (response && response.stream) {
                    SFPLogger.log('📡 Event subscription established', LoggerLevel.DEBUG, this.logger);

                    let eventCount = 0;
                    let toolEventCount = 0;

                    for await (const event of response.stream) {
                        if (signal.aborted) {
                            SFPLogger.log(`Event stream stopped after ${eventCount} events (${toolEventCount} tool events)`, LoggerLevel.INFO, this.logger);
                            break;
                        }

                        eventCount++;

                        const sessionId = this.sessionManager!.getSessionId();
                        const isMessagePartUpdate = event.event === 'message-part-updated' ||
                                                    event.type === 'message-part-updated' ||
                                                    event.properties?.part !== undefined;

                        const isToolEvent = event.properties?.part?.type === 'tool' ||
                                          event.part?.type === 'tool';

                        if (isMessagePartUpdate && event.properties?.part?.sessionID === sessionId) {
                            if (isToolEvent) {
                                toolEventCount++;
                            }
                            this.eventHandler.handleEvent(event);
                        } else if (event.sessionID === sessionId ||
                                   event.properties?.sessionID === sessionId) {
                            this.eventHandler.handleEvent(event);
                        } else if (isToolEvent) {
                            toolEventCount++;
                            this.eventHandler.handleEvent(event);
                        }
                    }

                    SFPLogger.log(`Event stream ended after ${eventCount} events (${toolEventCount} tool events)`, LoggerLevel.INFO, this.logger);
                }
            } catch (err) {
                SFPLogger.log(`Event stream error: ${err.message}`, LoggerLevel.DEBUG, this.logger);
            }
        })().catch((err) => {
            SFPLogger.log(`Background event listener error: ${err.message}`, LoggerLevel.DEBUG, this.logger);
        });
    }

    private extractContent(responseData: any): string {
        let content = '';

        if (responseData.info?.parts) {
            for (const part of responseData.info.parts) {
                if (part.type === 'text' && part.text) {
                    content += part.text;
                }
            }
        } else if (responseData.parts) {
            for (const part of responseData.parts) {
                if (part.type === 'text' && part.text) {
                    content += part.text;
                }
            }
        } else if (typeof responseData === 'string') {
            content = responseData;
        }

        return content;
    }
}