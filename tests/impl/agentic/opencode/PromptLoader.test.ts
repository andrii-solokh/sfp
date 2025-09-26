import { expect, jest } from '@jest/globals';
import { PromptLoader } from '../../../../src/impl/agentic/opencode/PromptLoader';
import { AnalysisPrompt } from '../../../../src/impl/agentic/opencode/types';
import ResourceLoader from '../../../../src/utils/ResourceLoader';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('../../../../src/utils/ResourceLoader');
jest.mock('@flxbl-io/sfp-logger');

const mockPathExists = fs.pathExists as unknown as jest.Mock<any>;
const mockReaddir = fs.readdir as unknown as jest.Mock<any>;
const mockReadFile = fs.readFile as unknown as jest.Mock<any>;

describe('PromptLoader', () => {
    let promptLoader: PromptLoader;
    const mockBasePath = '/mock/resources/analysis-prompts';
    const mockResourcePath = '/mock/resources';

    beforeEach(() => {
        jest.clearAllMocks();
        (ResourceLoader.getResourcePath as jest.Mock).mockReturnValue(mockResourcePath);
        promptLoader = new PromptLoader();
    });

    describe('constructor', () => {
        it('should use default base path when not provided', () => {
            expect(promptLoader.getBasePath()).toBe(mockBasePath);
        });

        it('should use custom base path when provided', () => {
            const customPath = '/custom/path';
            promptLoader = new PromptLoader(customPath);
            expect(promptLoader.getBasePath()).toBe(customPath);
        });
    });

    describe('loadPrompts', () => {
        const mockPrompt1: AnalysisPrompt = {
            name: 'Architecture Analysis',
            content: 'Analyze the architecture',
            order: 1
        };

        const mockPrompt2: AnalysisPrompt = {
            name: 'Quality Review',
            content: 'Review code quality',
            order: 2
        };

        const mockPrompt3: AnalysisPrompt = {
            name: 'Dependencies',
            content: 'Check dependencies',
            order: 3
        };

        beforeEach(() => {
            mockPathExists.mockResolvedValue(true);
            mockReaddir.mockResolvedValue([
                '01-architecture.yaml',
                '02-quality.yml',
                '03-dependencies.yaml',
                'readme.md'
            ]);
        });

        it('should load prompts from repository scope', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: Architecture Analysis\ncontent: Analyze the architecture\norder: 1')
                .mockResolvedValueOnce('name: Quality Review\ncontent: Review code quality\norder: 2')
                .mockResolvedValueOnce('name: Dependencies\ncontent: Check dependencies\norder: 3');

            const prompts = await promptLoader.loadPrompts('repository');

            expect(prompts).toHaveLength(3);
            expect(prompts[0].name).toBe('Architecture Analysis');
            expect(prompts[1].name).toBe('Quality Review');
            expect(prompts[2].name).toBe('Dependencies');
            expect(fs.readdir).toHaveBeenCalledWith(path.join(mockBasePath, 'repository'));
        });

        it('should load prompts from packages scope', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: Package Overview\ncontent: Overview of package\norder: 1')
                .mockResolvedValueOnce('name: Package Dependencies\ncontent: Package deps\norder: 2');

            mockReaddir.mockResolvedValue([
                '01-package-overview.yaml',
                '02-package-deps.yaml'
            ]);

            const prompts = await promptLoader.loadPrompts('packages');

            expect(prompts).toHaveLength(2);
            expect(prompts[0].name).toBe('Package Overview');
            expect(fs.pathExists).toHaveBeenCalledWith(path.join(mockBasePath, 'packages'));
        });

        it('should fallback to base path if scoped directory does not exist', async () => {
            mockPathExists
                .mockResolvedValueOnce(false) // Scoped path doesn't exist
                .mockResolvedValueOnce(true);  // Base path exists

            mockReadFile
                .mockResolvedValueOnce('name: Default Prompt\ncontent: Default content\norder: 1');

            mockReaddir.mockResolvedValue(['01-default.yaml']);

            const prompts = await promptLoader.loadPrompts('domain');

            expect(prompts).toHaveLength(1);
            expect(prompts[0].name).toBe('Default Prompt');
            expect(fs.readdir).toHaveBeenCalledWith(mockBasePath);
        });

        it('should sort prompts by order field', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: Third\ncontent: Content\norder: 3')
                .mockResolvedValueOnce('name: First\ncontent: Content\norder: 1')
                .mockResolvedValueOnce('name: Second\ncontent: Content\norder: 2');

            mockReaddir.mockResolvedValue([
                '03-third.yaml',
                '01-first.yaml',
                '02-second.yaml'
            ]);

            const prompts = await promptLoader.loadPrompts();

            expect(prompts[0].name).toBe('First');
            expect(prompts[1].name).toBe('Second');
            expect(prompts[2].name).toBe('Third');
        });

        it('should handle prompts without order field', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: Has Order\ncontent: Content\norder: 1')
                .mockResolvedValueOnce('name: No Order\ncontent: Content');

            mockReaddir.mockResolvedValue([
                '01-has-order.yaml',
                'no-order.yaml'
            ]);

            const prompts = await promptLoader.loadPrompts();

            expect(prompts[0].name).toBe('Has Order');
            expect(prompts[1].name).toBe('No Order');
        });

        it('should skip invalid prompt files', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: Valid Prompt\ncontent: Valid content')
                .mockResolvedValueOnce('invalid: yaml content')
                .mockResolvedValueOnce('name: \ncontent: Empty name')
                .mockResolvedValueOnce('name: No Content\n');

            mockReaddir.mockResolvedValue([
                '01-valid.yaml',
                '02-invalid.yaml',
                '03-empty-name.yaml',
                '04-no-content.yaml'
            ]);

            const prompts = await promptLoader.loadPrompts();

            expect(prompts).toHaveLength(1);
            expect(prompts[0].name).toBe('Valid Prompt');
        });

        it('should skip non-YAML files', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: YAML File\ncontent: Content');

            mockReaddir.mockResolvedValue([
                '01-prompt.yaml',
                'README.md',
                'config.json',
                '.gitignore'
            ]);

            const prompts = await promptLoader.loadPrompts();

            expect(prompts).toHaveLength(1);
            expect(fs.readFile).toHaveBeenCalledTimes(1);
        });

        it('should handle YAML parsing errors gracefully', async () => {
            mockReadFile
                .mockResolvedValueOnce('name: Valid\ncontent: Valid')
                .mockResolvedValueOnce('{{invalid yaml}}')
                .mockResolvedValueOnce('name: Another Valid\ncontent: Content');

            mockReaddir.mockResolvedValue([
                '01-valid.yaml',
                '02-invalid.yaml',
                '03-another-valid.yaml'
            ]);

            const prompts = await promptLoader.loadPrompts();

            expect(prompts).toHaveLength(2);
            expect(prompts[0].name).toBe('Valid');
            expect(prompts[1].name).toBe('Another Valid');
        });

        it('should throw error when prompts directory does not exist', async () => {
            mockPathExists.mockResolvedValue(false);

            await expect(promptLoader.loadPrompts()).rejects.toThrow(
                `Error loading prompts: Prompts directory not found at ${mockBasePath}`
            );
        });

        it('should throw error when no valid prompts found', async () => {
            mockPathExists.mockResolvedValue(true);
            mockReaddir.mockResolvedValue(['README.md', '.gitignore']);

            await expect(promptLoader.loadPrompts()).rejects.toThrow(
                'Error loading prompts: No valid prompts found in repository directory'
            );
        });

        it('should handle file read errors gracefully', async () => {
            mockReadFile
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockResolvedValueOnce('name: Valid\ncontent: Content');

            mockReaddir.mockResolvedValue([
                '01-error.yaml',
                '02-valid.yaml'
            ]);

            const prompts = await promptLoader.loadPrompts();

            expect(prompts).toHaveLength(1);
            expect(prompts[0].name).toBe('Valid');
        });
    });

    describe('getPromptsPath', () => {
        it('should return correct path for repository scope', () => {
            const path = promptLoader.getPromptsPath('repository');
            expect(path).toBe('/mock/resources/analysis-prompts/repository');
        });

        it('should return correct path for packages scope', () => {
            const path = promptLoader.getPromptsPath('packages');
            expect(path).toBe('/mock/resources/analysis-prompts/packages');
        });

        it('should return correct path for domain scope', () => {
            const path = promptLoader.getPromptsPath('domain');
            expect(path).toBe('/mock/resources/analysis-prompts/domain');
        });

        it('should default to repository scope when not specified', () => {
            const path = promptLoader.getPromptsPath();
            expect(path).toBe('/mock/resources/analysis-prompts/repository');
        });
    });

    describe('isValidPrompt', () => {
        it('should validate prompts correctly', async () => {
            const validPrompts = [
                'name: Test\ncontent: Content',
                'name: Test\ncontent: Content\norder: 1'
            ];

            const invalidPrompts = [
                'content: No name',
                'name: No content',
                'name: \ncontent: Empty name',
                'name: Test\ncontent: ',
                'invalid: format'
            ];

            // Test valid prompts
            for (const yamlContent of validPrompts) {
                mockReadFile.mockResolvedValueOnce(yamlContent);
                mockReaddir.mockResolvedValueOnce(['test.yaml']);

                const prompts = await promptLoader.loadPrompts();
                expect(prompts.length).toBeGreaterThan(0);
                jest.clearAllMocks();
                mockPathExists.mockResolvedValue(true);
            }

            // Test invalid prompts
            for (const yamlContent of invalidPrompts) {
                mockReadFile.mockResolvedValueOnce(yamlContent);
                mockReaddir.mockResolvedValueOnce(['test.yaml']);

                await expect(promptLoader.loadPrompts()).rejects.toThrow(
                    'No valid prompts found'
                );
                jest.clearAllMocks();
                mockPathExists.mockResolvedValue(true);
            }
        });
    });
});