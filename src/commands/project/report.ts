import SFPLogger, { LoggerLevel, ConsoleLogger } from '@flxbl-io/sfp-logger';
import { Messages, SfProject } from '@salesforce/core';
import { Flags } from '@oclif/core';
import SfpCommand from '../../SfpCommand';
import { loglevel } from '../../flags/sfdxflags';
import { AIReportGenerator } from '../../impl/agentic/opencode/AIReportGenerator';
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from '../../impl/agentic/opencode';
import { AUTH_PROVIDERS } from '../../impl/agentic/opencode/auth/AuthManager';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@flxbl-io/sfp', 'project_analyze');

export default class ProjectAnalyze extends SfpCommand {
    static aliases = ['project:ai-analyze',"project:report"];
    public static description = messages.getMessage('commandDescription');
    protected static requiresProject = true;
    public static enableJsonFlag = true;

    public static examples = [
        '$ sfp project report --package core-package',
        '$ sfp project report --package feature-management',
        '$ sfp project report --package salespkg --package unpackaged',
        '$ sfp project report --package sales --provider anthropic --model claude-3-5-sonnet-20241022',
        '$ sfp project report --package mypackage --provider github-copilot',
        '$ sfp project report --package sales --output reports/audit-$(date +%Y%m%d).md',
    ];

    public static flags = {
        ...SfpCommand.flags,
        output: Flags.string({
            description: 'Output markdown file path',
            default: 'analysis-report.md',
        }),
        package: Flags.string({
            char: 'p',
            description: 'The name of the package to analyze',
            exclusive: ['domain'],
            multiple: true,
            required: true,
        }),
        domain: Flags.string({
            char: 'd',
            description: 'Domain analysis (sfp-pro edition only)',
            exclusive: ['package'],
        }),
        provider: Flags.string({
            description: 'AI provider to use',
            default: DEFAULT_PROVIDER,
            options: Object.keys(AUTH_PROVIDERS),
        }),
        model: Flags.string({
            description: 'Model ID to use (provider-specific)',
            default: DEFAULT_MODEL,
        }),
        'prompt-count': Flags.integer({
            description: 'Number of prompts to run (useful for testing)',
            min: 1,
        }),
        loglevel,
    };

    public async execute(): Promise<void> {
        const { flags } = await this.parse(ProjectAnalyze);

        const project = await SfProject.resolve();
        const projectPath = project.getPath();

        SFPLogger.log(`Starting AI-powered analysis of packages at ${projectPath}`, LoggerLevel.INFO);
        SFPLogger.log(`Provider: ${flags.provider}, Model: ${flags.model}`, LoggerLevel.INFO);
        SFPLogger.log(`Output will be saved to: ${flags.output}`, LoggerLevel.INFO);

        // Check authentication status
        const providerInfo = AUTH_PROVIDERS[flags.provider];
        if (providerInfo) {
            // Check for environment variable authentication
            const hasEnvAuth = providerInfo.env.length > 0 && providerInfo.env.some(envVar => process.env[envVar]);

            // Check for stored authentication
            const authFilePath = path.join(os.homedir(), '.sfp', 'ai-auth.json');
            let hasStoredAuth = false;
            try {
                if (await fs.pathExists(authFilePath)) {
                    const authData = await fs.readJson(authFilePath);
                    hasStoredAuth = !!authData[flags.provider];
                }
            } catch {
                // Ignore errors reading auth file
            }

            if (!hasEnvAuth && !hasStoredAuth) {
                SFPLogger.log(
                    `⚠️  No authentication found for ${flags.provider}`,
                    LoggerLevel.WARN
                );
                if (providerInfo.env.length > 0) {
                    SFPLogger.log(
                        `   Set one of these environment variables: ${providerInfo.env.join(', ')}`,
                        LoggerLevel.INFO
                    );
                }
                SFPLogger.log(
                    `   Or use 'sfp ai auth' for OAuth authentication`,
                    LoggerLevel.INFO
                );
            }
        }

        // Show informational messages for pro-only features
        if (flags.domain) {
            SFPLogger.log(
                '❌ Domain analysis is only available in sfp-pro edition.',
                LoggerLevel.ERROR
            );
            SFPLogger.log(
                'Package analysis is available. Use --package flag to analyze specific packages.',
                LoggerLevel.INFO
            );
            SFPLogger.log(
                'Learn more at https://flxbl.io/sfp-pro',
                LoggerLevel.INFO
            );
            throw new Error('Feature not available in community edition');
        }

        if (!flags.package || flags.package.length === 0) {
            SFPLogger.log(
                '❌ Repository-wide analysis is only available in sfp-pro edition.',
                LoggerLevel.ERROR
            );
            SFPLogger.log(
                'Package analysis is available. Use --package flag to analyze specific packages.',
                LoggerLevel.INFO
            );
            SFPLogger.log(
                'Learn more at https://flxbl.io/sfp-pro',
                LoggerLevel.INFO
            );
            throw new Error('Package flag is required in community edition');
        }

        try {
            // Initialize report generator with package options
            const generator = new AIReportGenerator({
                projectPath,
                providerId: flags.provider,
                modelId: flags.model,
                promptCount: flags['prompt-count'],
                packageNames: flags.package,
                logger: new ConsoleLogger(),
            });

            // Generate report
            SFPLogger.log('Initializing AI agent...', LoggerLevel.INFO);
            SFPLogger.log(`Analyzing packages: ${flags.package.join(', ')}`, LoggerLevel.INFO);

            // Ensure we start with a clean slate - remove existing file if it exists
            if (await fs.pathExists(flags.output)) {
                await fs.remove(flags.output);
                SFPLogger.log(`🧹 Cleaned existing report file`, LoggerLevel.DEBUG);
            }

            const report = await generator.generate();

            // Write output
            await fs.outputFile(flags.output, report);
            SFPLogger.log(`✅ Report successfully generated: ${flags.output}`, LoggerLevel.INFO);

            // If JSON flag is set, return structured output
            if (flags.json) {
                this.logJson({
                    success: true,
                    outputFile: flags.output,
                    provider: flags.provider,
                    model: flags.model,
                    packages: flags.package,
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (error) {
            // Check if this is a pro-edition error
            if (error.message?.includes('sfp-pro edition')) {
                throw error;
            }
            SFPLogger.log(`❌ Failed to generate report: ${error.message}`, LoggerLevel.ERROR);
            throw error;
        }
    }
}