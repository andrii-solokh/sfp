import SFPLogger, { LoggerLevel } from '@flxbl-io/sfp-logger';
import { Messages } from '@salesforce/core';
import { Flags } from '@oclif/core';
import SfpCommand from '../../SfpCommand';
import { loglevel } from '../../flags/sfdxflags';
import { AIAuthService } from '../../impl/ai/auth/AIAuthService';

Messages.importMessagesDirectory(__dirname);

export default class AICheck extends SfpCommand {
    public static description = 'Check AI provider inference capabilities';
    public static enableJsonFlag = true;

    public static examples = [
        '$ sfp ai check                          # Check all configured providers with default models',
        '$ sfp ai check --provider anthropic     # Check specific provider with default model',
        '$ sfp ai check --provider anthropic --model claude-3-5-sonnet-latest  # Check with specific model',
        '$ sfp ai check --provider amazon-bedrock  # Uses default: anthropic.claude-sonnet-4-20250514-v1:0',
    ];

    public static flags = {
        ...SfpCommand.flags,
        provider: Flags.string({
            description: 'Test specific provider',
        }),
        model: Flags.string({
            description: 'Specific model to test (optional)',
        }),
        verbose: Flags.boolean({
            description: 'Show detailed response',
            default: false,
        }),
        loglevel,
    };

    public async execute(): Promise<void> {
        const { flags } = await this.parse(AICheck);
        const authService = new AIAuthService();

        if (flags.provider) {
            await this.checkProvider(authService, flags.provider, flags.model, flags.verbose);
        } else {
            await this.checkAllProviders(authService, flags.verbose);
        }
    }

    private async checkProvider(
        authService: AIAuthService,
        providerId: string,
        modelId?: string,
        verbose?: boolean
    ): Promise<void> {
        const provider = authService.getProvider(providerId);

        if (!provider) {
            SFPLogger.log(`Unknown provider: ${providerId}`, LoggerLevel.ERROR);
            return;
        }

        SFPLogger.log(`\n${provider.icon} Testing ${provider.name}`, LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        // Check authentication
        if (!await authService.hasAuth(providerId)) {
            SFPLogger.log('✗ Authentication not configured', LoggerLevel.ERROR);
            SFPLogger.log(`Run: sfp ai auth --provider ${providerId} --auth`, LoggerLevel.INFO);
            return;
        }

        SFPLogger.log('✓ Authentication found', LoggerLevel.INFO);

        // Show model being used
        const modelToUse = modelId || authService.getDefaultModel(providerId);
        if (!modelId && modelToUse) {
            SFPLogger.log(`Using default model: ${modelToUse}`, LoggerLevel.INFO);
        } else if (modelId) {
            SFPLogger.log(`Using specified model: ${modelId}`, LoggerLevel.INFO);
        }

        SFPLogger.log('Testing inference capability...', LoggerLevel.INFO);

        const result = await authService.checkProvider(providerId, modelId);

        if (result.success) {
            SFPLogger.log(
                `✓ Inference successful (${result.responseTime}ms)`,
                LoggerLevel.INFO
            );

            if (result.model) {
                SFPLogger.log(`Model: ${result.model}`, LoggerLevel.INFO);
            }

            if (verbose) {
                SFPLogger.log('\nResponse received successfully', LoggerLevel.INFO);
                SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);
                SFPLogger.log('Test completed - provider is working correctly', LoggerLevel.INFO);
            }
        } else {
            SFPLogger.log(
                `✗ Inference failed: ${result.error}`,
                LoggerLevel.ERROR
            );

            // Common error guidance
            if (result.error && (result.error.includes('auth') || result.error.includes('credentials'))) {
                SFPLogger.log('\nTroubleshooting:', LoggerLevel.INFO);
                SFPLogger.log(`  1. Check authentication: sfp ai auth --provider ${providerId}`, LoggerLevel.INFO);
                SFPLogger.log('  2. Verify environment variables are set correctly', LoggerLevel.INFO);

                if (providerId === 'amazon-bedrock') {
                    SFPLogger.log('  3. Ensure both AWS_BEARER_TOKEN_BEDROCK and AWS_REGION are set', LoggerLevel.INFO);
                }
            }
        }

        if (this.jsonEnabled()) {
            SFPLogger.log(JSON.stringify(result, null, 2), LoggerLevel.INFO);
        }
    }

    private async checkAllProviders(authService: AIAuthService, _verbose?: boolean): Promise<void> {
        SFPLogger.log('\nTesting All AI Providers', LoggerLevel.INFO);
        SFPLogger.log('═'.repeat(50), LoggerLevel.INFO);

        const results = await authService.checkAllProviders();

        // Display individual test results
        for (const result of results) {
            const provider = authService.getProvider(result.provider);
            if (provider) {
                SFPLogger.log(
                    `\n${provider.icon} ${provider.name}`,
                    LoggerLevel.INFO
                );

                if (result.success) {
                    SFPLogger.log(
                        `  ✓ Test passed (${result.responseTime}ms)`,
                        LoggerLevel.INFO
                    );
                } else {
                    SFPLogger.log(
                        `  ✗ Test failed: ${result.error}`,
                        LoggerLevel.ERROR
                    );
                }
            }
        }

        // Summary
        SFPLogger.log('\n\nTest Summary', LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        const passed = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        SFPLogger.log(
            `Passed: ${passed}/${results.length}`,
            passed > 0 ? LoggerLevel.INFO : LoggerLevel.WARN
        );

        if (failed > 0) {
            SFPLogger.log(
                `Failed: ${failed}/${results.length}`,
                LoggerLevel.WARN
            );
        }

        // List all providers with their status
        const statuses = await authService.getAllProvidersStatus();
        SFPLogger.log('\n\nProvider Status:', LoggerLevel.INFO);
        SFPLogger.log('─'.repeat(50), LoggerLevel.INFO);

        for (const status of statuses) {
            const testResult = results.find(r => r.provider === status.provider);
            const statusText = testResult?.success
                ? '✓ Working'
                : status.configured
                ? '⚠ Configured but failed test'
                : '- Not configured';

            SFPLogger.log(
                `${status.icon} ${status.name.padEnd(20)} ${statusText}`,
                LoggerLevel.INFO
            );
        }

        if (this.jsonEnabled()) {
            SFPLogger.log(JSON.stringify({
                results,
                summary: {
                    total: results.length,
                    passed,
                    failed
                }
            }, null, 2), LoggerLevel.INFO);
        }
    }
}