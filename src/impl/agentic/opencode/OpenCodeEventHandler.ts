import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';

export class OpenCodeEventHandler {
    private logger?: Logger;
    private toolEventCount: number = 0;
    private lastProgressTime: number = Date.now();
    private progressInterval: number = 30000; // 30 seconds

    constructor(logger?: Logger) {
        this.logger = logger;
    }

    handleEvent(event: any): void {
        // Check if this is a message part event (most common structure from OpenCode)
        if (event.properties?.part) {
            this.handleMessagePartUpdated(event);
            return;
        }

        const eventType = event?.type || event?.event || 'unknown';

        // Handle different event structures
        if (event.event === 'message-part-updated' || eventType === 'message-part-updated') {
            this.handleMessagePartUpdated(event);
            return;
        }

        switch (eventType) {
            case 'step-start':
                this.handleStepStart(event);
                break;

            case 'step-finish':
                this.handleStepFinish(event);
                break;

            case 'tool':
                this.handleToolCall(event);
                break;

            case 'text':
                // Text events are handled separately for content extraction
                break;

            case 'error':
                this.handleError(event);
                break;

            default:
                // Silently ignore unknown events unless in debug mode
                break;
        }
    }

    private handleMessagePartUpdated(event: any): void {
        const part = event?.properties?.part;
        if (!part) return;

        if (part.type === 'tool') {
            const toolName = part.tool || 'unknown';
            const toolInput = part.input || part.state?.input;

            this.toolEventCount++;

            // Extract useful information from tool input
            let details = '';
            if (toolInput?.filePath || toolInput?.file_path || toolInput?.path) {
                // For file operations, show just the filename or last directory + filename
                const fullPath = toolInput.filePath || toolInput.file_path || toolInput.path;
                const pathParts = fullPath.split('/');
                if (pathParts.length > 2) {
                    details = `: .../${pathParts.slice(-2).join('/')}`;
                } else {
                    details = `: ${fullPath}`;
                }
            } else if (toolInput?.pattern) {
                details = `: "${toolInput.pattern}"`;
            } else if (toolInput?.command) {
                // For commands, show truncated version if too long (but keep it meaningful)
                const cmd = toolInput.command;
                details = cmd.length > 120 ? `: ${cmd.substring(0, 117)}...` : `: ${cmd}`;
            } else if (toolInput?.query) {
                details = `: "${toolInput.query}"`;
            } else if (toolInput?.glob) {
                details = `: "${toolInput.glob}"`;
            }

            // Map tool names to friendly messages
            const toolMessages: Record<string, string> = {
                'read': '📖 Reading',
                'Read': '📖 Reading',
                'glob': '📁 Searching files',
                'Glob': '📁 Searching files',
                'grep': '🔍 Searching code',
                'Grep': '🔍 Searching code',
                'bash': '💻 Running command',
                'Bash': '💻 Running command',
                'edit': '✏️ Editing',
                'Edit': '✏️ Editing',
                'write': '💾 Writing',
                'Write': '💾 Writing',
                'list': '📋 Listing',
                'List': '📋 Listing',
                'search': '🔍 Searching',
                'Search': '🔍 Searching'
            };

            const message = toolMessages[toolName] || `🔧 Using ${toolName}`;
            const fullMessage = `  ${message}${details}`;

            // Log detailed tool events at DEBUG level
            SFPLogger.log(fullMessage, LoggerLevel.DEBUG, this.logger);

            // Check if it's time for a progress update (every 30 seconds)
            const now = Date.now();
            if (now - this.lastProgressTime >= this.progressInterval) {
                // Show progress update with current activity
                SFPLogger.log(
                    `📊 Progress: ${this.toolEventCount} operations completed. Current: ${message}${details}`,
                    LoggerLevel.INFO,
                    this.logger
                );
                this.lastProgressTime = now;
            }
        }
    }

    private handleStepStart(event: any): void {
        // Don't log step starts - too noisy
    }

    private handleStepFinish(event: any): void {
        if (event.tokens) {
            const { input, output, cache } = event.tokens;
            SFPLogger.log(
                `📊 Tokens used - Input: ${input}, Output: ${output}, Cache: ${cache?.read || 0}`,
                LoggerLevel.DEBUG,
                this.logger
            );
        }
    }

    private handleToolCall(event: any): void {
        const toolName = event.tool?.name || 'unknown';
        const toolAction = event.tool?.action || '';

        // Map common tool calls to user-friendly messages
        const toolMessages: Record<string, string> = {
            'read_file': '📖 Reading file',
            'list_files': '📁 Listing files',
            'search_files': '🔍 Searching files',
            'write_file': '✏️ Writing file',
            'run_command': '⚡ Running command',
            'web_search': '🌐 Searching web',
            'bash': '💻 Executing command'
        };

        const message = toolMessages[toolName] || `🔧 Using tool: ${toolName}`;

        // Extract relevant details from tool input
        let details = '';
        if (event.tool?.input) {
            if (event.tool.input.path) {
                details = `: ${event.tool.input.path}`;
            } else if (event.tool.input.pattern) {
                details = `: ${event.tool.input.pattern}`;
            } else if (event.tool.input.command) {
                details = `: ${event.tool.input.command}`;
            } else if (event.tool.input.query) {
                details = `: ${event.tool.input.query}`;
            }
        }

        // Log at DEBUG level for detailed tracking
        SFPLogger.log(
            `${message}${details}`,
            LoggerLevel.DEBUG,
            this.logger
        );
    }

    private handleError(event: any): void {
        SFPLogger.log(
            `❌ Error: ${event.error || 'Unknown error'}`,
            LoggerLevel.ERROR,
            this.logger
        );
    }
}