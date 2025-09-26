import * as path from 'path';
import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import SFPLogger, { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import ResourceLoader from '../../../utils/ResourceLoader';
import { AnalysisPrompt, AnalysisScope } from './types';

export class PromptLoader {
    private basePath: string;
    private logger?: Logger;

    constructor(basePath?: string, logger?: Logger) {
        // Use ResourceLoader to properly resolve the resources path
        const resourcesPath = ResourceLoader.getResourcePath('resources');
        this.basePath = basePath || path.join(resourcesPath, 'analysis-prompts');
        this.logger = logger;
    }

    async loadPrompts(scope: AnalysisScope = 'repository'): Promise<AnalysisPrompt[]> {
        try {
            // Construct path based on scope
            const promptsPath = path.join(this.basePath, scope);

            // Fallback to base path if scoped directory doesn't exist (backward compatibility)
            const actualPath = await fs.pathExists(promptsPath) ? promptsPath : this.basePath;

            if (!await fs.pathExists(actualPath)) {
                throw new Error(`Prompts directory not found at ${actualPath}`);
            }

            const files = await fs.readdir(actualPath);
            const prompts: AnalysisPrompt[] = [];

            for (const file of files.sort()) {
                if (file.endsWith('.yaml') || file.endsWith('.yml')) {
                    try {
                        const content = await fs.readFile(
                            path.join(actualPath, file),
                            'utf-8'
                        );
                        const prompt = yaml.load(content) as AnalysisPrompt;

                        if (this.isValidPrompt(prompt)) {
                            prompts.push(prompt);
                            SFPLogger.log(
                                `Loaded prompt: ${prompt.name} from ${scope} scope`,
                                LoggerLevel.DEBUG,
                                this.logger
                            );
                        } else {
                            SFPLogger.log(
                                `Skipping invalid prompt file: ${file}`,
                                LoggerLevel.WARN,
                                this.logger
                            );
                        }
                    } catch (error) {
                        SFPLogger.log(
                            `Failed to load prompt from ${file}: ${error.message}`,
                            LoggerLevel.WARN,
                            this.logger
                        );
                    }
                }
            }

            if (prompts.length === 0) {
                throw new Error(`No valid prompts found in ${scope} directory`);
            }

            // Sort by order field
            return prompts.sort((a, b) => (a.order || 999) - (b.order || 999));
        } catch (error) {
            throw new Error(`Error loading prompts: ${error.message}`);
        }
    }

    private isValidPrompt(prompt: any): boolean {
        return prompt &&
            typeof prompt.name === 'string' &&
            typeof prompt.content === 'string' &&
            prompt.name.length > 0 &&
            prompt.content.length > 0;
    }

    getBasePath(): string {
        return this.basePath;
    }

    getPromptsPath(scope: AnalysisScope = 'repository'): string {
        return path.join(this.basePath, scope);
    }
}