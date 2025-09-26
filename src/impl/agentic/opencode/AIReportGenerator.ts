import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import { OpenCodeAgent } from './OpenCodeAgent';
import { AgentPrompt, AgentResponse, ReportGeneratorOptions, ReportSection } from './types';
import { PromptEnhancer, EnhancementContext } from './PromptEnhancer';
import { PromptLoader } from './PromptLoader';
import { ReportAssembler } from './ReportAssembler';

/**
 * AI-powered report generator that uses the generic OpenCodeAgent with context enhancement
 */
export class AIReportGenerator {
    private agent: OpenCodeAgent;
    private promptLoader: PromptLoader;
    private promptEnhancer: PromptEnhancer;
    private reportAssembler: ReportAssembler;
    private logger?: Logger;

    constructor(private options: ReportGeneratorOptions) {
        this.logger = options.logger;

        // Community edition validation
        if (!options.packageNames || options.packageNames.length === 0) {
            throw new Error('Repository-wide analysis is only available in sfp-pro edition. Please specify package names to analyze specific packages.');
        }

        if (options.domain) {
            throw new Error('Domain analysis is only available in sfp-pro edition. Please use package-specific analysis instead.');
        }

        // Create the generic agent
        this.agent = new OpenCodeAgent({
            projectPath: options.projectPath,
            providerId: options.providerId,
            modelId: options.modelId,
            logger: this.logger
        });

        this.promptLoader = new PromptLoader(undefined, this.logger);
        this.promptEnhancer = new PromptEnhancer(options.projectPath, this.logger);
        // Determine scope for header
        let scopeInfo: { type: string; details?: string } | undefined;
        if (options.packageNames && options.packageNames.length > 0) {
            scopeInfo = {
                type: 'packages',
                details: options.packageNames.join(', ')
            };
        } else if (options.domain) {
            scopeInfo = {
                type: 'domain',
                details: options.domain
            };
        }

        this.reportAssembler = new ReportAssembler(
            options.projectPath,
            options.providerId,
            options.modelId,
            scopeInfo
        );
    }

    public async generate(): Promise<string> {
        try {
            // Determine scope and get enhancement context
            const scope = this.promptEnhancer.determineScope({
                packageNames: this.options.packageNames,
                domain: this.options.domain
            });

            SFPLogger.log(`🚀 Starting AI-powered ${scope} analysis...`, LoggerLevel.INFO, this.logger);

            // Get enhancement context based on scope
            let context: EnhancementContext;
            if (this.options.packageNames && this.options.packageNames.length > 0) {
                context = await this.promptEnhancer.enhanceForPackages(this.options.packageNames);
                SFPLogger.log(
                    `📦 Analyzing ${this.options.packageNames.length} package(s): ${this.options.packageNames.join(', ')}`,
                    LoggerLevel.INFO,
                    this.logger
                );
            } else if (this.options.domain) {
                context = await this.promptEnhancer.enhanceForDomain(this.options.domain);
                SFPLogger.log(
                    `🏢 Analyzing domain: ${this.options.domain}`,
                    LoggerLevel.INFO,
                    this.logger
                );
            } else {
                context = await this.promptEnhancer.enhanceForRepository();
                SFPLogger.log(
                    `📂 Analyzing entire repository`,
                    LoggerLevel.INFO,
                    this.logger
                );
            }

            // Initialize the agent
            await this.agent.initialize();

            // Load prompts for the appropriate scope
            const prompts = await this.promptLoader.loadPrompts(scope);
            SFPLogger.log(`📝 Loaded ${prompts.length} ${scope}-scoped prompts`, LoggerLevel.INFO, this.logger);

            // Limit prompts if prompt count is specified
            let promptsToRun = prompts;
            if (this.options.promptCount && this.options.promptCount > 0) {
                promptsToRun = prompts.slice(0, this.options.promptCount);
                SFPLogger.log(
                    `🎯 Running ${promptsToRun.length} of ${prompts.length} prompts as requested`,
                    LoggerLevel.INFO,
                    this.logger
                );
            }

            // Separate consolidation prompt if it exists (order 99)
            const consolidationPrompt = promptsToRun.find(p => p.order === 99);
            const analysisPrompts = promptsToRun.filter(p => p.order !== 99);

            // Build context-aware system prompt
            const systemPrompt = this.buildSystemPrompt(context);

            // Execute analysis prompts sequentially with progressive context accumulation
            const responses: AgentResponse[] = [];
            const accumulatedContext: string[] = [];

            for (const [index, prompt] of analysisPrompts.entries()) {
                // Log progress with context awareness
                SFPLogger.log(
                    `📊 Executing analysis ${index + 1}/${analysisPrompts.length}: ${prompt.name}`,
                    LoggerLevel.INFO,
                    this.logger
                );

                if (index > 0) {
                    SFPLogger.log(
                        `  ↳ Building on ${index} previous ${index === 1 ? 'analysis' : 'analyses'}`,
                        LoggerLevel.INFO,
                        this.logger
                    );
                }

                // Enhance prompt with injected context
                const enhancedContent = this.promptEnhancer.injectContext(prompt.content, context);

                // Build progressive prompt with accumulated context from previous analyses
                const progressivePrompt = this.buildProgressivePrompt(
                    {
                        name: prompt.name,
                        content: enhancedContent
                    },
                    accumulatedContext,
                    index
                );

                // Execute the prompt
                const response = await this.agent.executePrompt(progressivePrompt, systemPrompt);
                responses.push(response);

                // Add summary to accumulated context for next prompt
                if (index < analysisPrompts.length - 1) {
                    const summary = this.summarizeForContext(prompt.name, response.content);
                    accumulatedContext.push(summary);
                }
            }

            // Convert responses to report sections
            const sections: ReportSection[] = responses.map(response => ({
                title: response.metadata?.promptName || 'Section',
                content: response.content
            }));

            // If consolidation prompt exists, run it with all previous analyses as context
            if (consolidationPrompt) {
                SFPLogger.log(
                    `🎯 Executing final consolidation: ${consolidationPrompt.name}`,
                    LoggerLevel.INFO,
                    this.logger
                );

                const consolidationContext = this.buildConsolidationContext(sections);
                const enhancedConsolidationPrompt = this.promptEnhancer.injectContext(
                    consolidationPrompt.content,
                    context
                );

                const consolidationAgentPrompt: AgentPrompt = {
                    name: consolidationPrompt.name,
                    content: `${enhancedConsolidationPrompt}

## Progressive Analysis Results
Note: Each analysis was informed by previous findings, creating a cohesive understanding.

${consolidationContext}`
                };

                const consolidationResponse = await this.agent.executePrompt(
                    consolidationAgentPrompt,
                    systemPrompt
                );

                // Add consolidation as the first section (Executive Summary should be at the top)
                sections.unshift({
                    title: consolidationResponse.metadata?.promptName || 'Executive Summary',
                    content: consolidationResponse.content
                });
            }

            // Assemble and return the report
            return this.reportAssembler.assembleMarkdown(sections);

        } catch (error) {
            SFPLogger.log(`Report generation failed: ${error.message}`, LoggerLevel.ERROR, this.logger);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    private buildConsolidationContext(sections: ReportSection[]): string {
        return sections.map(section =>
            `### ${section.title}\n${section.content}\n`
        ).join('\n---\n\n');
    }

    /**
     * Build a progressive prompt that includes context from previous analyses
     */
    private buildProgressivePrompt(
        prompt: AgentPrompt,
        previousAnalyses: string[],
        index: number
    ): AgentPrompt {
        // First prompt runs without context
        if (index === 0 || previousAnalyses.length === 0) {
            return prompt;
        }

        // Enhance prompt with previous findings
        const contextSection = `
## Previous Analysis Context
The following analyses have already been completed for this ${this.options.domain ? 'domain' : this.options.packageNames ? 'package' : 'repository'}:

${previousAnalyses.join('\n\n')}

Please build upon these findings in your analysis. Reference previous discoveries where relevant, avoid duplicating information already covered, and identify any patterns or connections across the different analyses.
`;

        return {
            ...prompt,
            content: prompt.content + '\n\n' + contextSection
        };
    }

    /**
     * Summarize analysis content for inclusion in progressive context
     * Keeps summaries concise to avoid token explosion
     */
    private summarizeForContext(analysisName: string, content: string): string {
        const maxContextSize = this.options.maxContextSize || 1000;
        const lines = content.split('\n');
        const keyFindings: string[] = [];
        let currentSize = 0;

        // Extract key findings - prioritize headers, critical items, and bullet points
        for (const line of lines) {
            const trimmedLine = line.trim();

            // Skip empty lines
            if (!trimmedLine) continue;

            // Prioritize important content
            const isImportant =
                trimmedLine.startsWith('#') ||                    // Headers
                trimmedLine.startsWith('-') ||                    // Bullet points
                trimmedLine.startsWith('•') ||                    // Alternative bullets
                trimmedLine.match(/^\d+\./) ||                    // Numbered lists
                trimmedLine.toLowerCase().includes('critical') ||  // Critical findings
                trimmedLine.toLowerCase().includes('issue') ||     // Issues
                trimmedLine.toLowerCase().includes('recommend') || // Recommendations
                trimmedLine.toLowerCase().includes('risk');        // Risks

            if (isImportant) {
                // Add line if it fits within size limit
                if (currentSize + trimmedLine.length < maxContextSize - 100) { // Leave buffer for header
                    keyFindings.push(trimmedLine);
                    currentSize += trimmedLine.length;
                } else {
                    break; // Stop if we've reached the size limit
                }
            }
        }

        // Format the summary
        return `### ${analysisName}
Key findings (${keyFindings.length} points):
${keyFindings.slice(0, 15).join('\n')}`; // Limit to top 15 findings
    }

    private buildSystemPrompt(context: EnhancementContext): string {
        let systemPrompt = `You are an AI assistant specializing in Salesforce codebase analysis and reporting.
You have access to file reading tools. Use them to explore the codebase thoroughly.
When analyzing code, be specific with file counts, package names, and concrete examples.
Focus on providing actionable insights that would be valuable for technical leadership and stakeholders.
Format your responses in clean, readable markdown.

IMPORTANT FORMATTING RULES:
- Start with ### (h3) for your main section headers, not # (h1) or ## (h2)
- Use #### (h4) for subsections
- Do NOT include introductory phrases like "Based on my analysis..." or "I can now provide..."
- Start directly with the content without preamble
- Be direct and professional in tone

`;

        if (context.scope === 'packages' && context.packages) {
            systemPrompt += `\nYou are analyzing specific package(s) in a Flxbl-based Salesforce project:\n`;
            context.packages.forEach(pkg => {
                systemPrompt += `- Package: ${pkg.name} (Type: ${pkg.type}`;
                if (pkg.isOrgDependent !== undefined) {
                    systemPrompt += `, Org-Dependent: ${pkg.isOrgDependent}`;
                }
                systemPrompt += `)\n  Path: ${pkg.path}\n`;
            });
            systemPrompt += `\nFocus your analysis on these specific packages and their characteristics based on their package types.`;
        } else if (context.scope === 'domain' && context.domain) {
            systemPrompt += `\nYou are analyzing the "${context.domain}" domain which contains ${context.packages?.length || 0} packages.`;
            systemPrompt += `\nFocus on cross-package patterns, shared dependencies, and domain cohesion.`;
        }

        return systemPrompt;
    }

    private async cleanup(): Promise<void> {
        await this.agent.cleanup();
    }
}