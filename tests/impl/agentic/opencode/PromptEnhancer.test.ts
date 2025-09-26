import { expect, jest } from '@jest/globals';
import { PromptEnhancer, EnhancementContext, PackageMetadata } from '../../../../src/impl/agentic/opencode/PromptEnhancer';
import ProjectConfig from '../../../../src/core/project/ProjectConfig';
import SFPLogger from '@flxbl-io/sfp-logger';

// Mock dependencies
jest.mock('../../../../src/core/project/ProjectConfig');
jest.mock('@flxbl-io/sfp-logger');

describe('PromptEnhancer', () => {
    let promptEnhancer: PromptEnhancer;
    const mockProjectPath = '/mock/project/path';
    const mockProjectConfig = {
        packageDirectories: [
            {
                path: 'packages/core',
                package: 'core-package',
                versionNumber: '1.0.0',
                dependencies: []
            },
            {
                path: 'packages/ui',
                package: 'ui-package',
                versionNumber: '2.0.0',
                dependencies: [{ package: 'core-package' }]
            }
        ],
        packageAliases: {
            'core-package': '04t000000000000',
            'ui-package': '04t000000000001'
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (ProjectConfig.getSFDXProjectConfig as jest.Mock).mockReturnValue(mockProjectConfig);
        (ProjectConfig.getAllPackagesFromProjectConfig as jest.Mock).mockReturnValue(['core-package', 'ui-package']);
        (ProjectConfig.getPackageDescriptorFromConfig as jest.Mock).mockImplementation((pkgName) => {
            if (pkgName === 'core-package') {
                return mockProjectConfig.packageDirectories[0];
            }
            if (pkgName === 'ui-package') {
                return mockProjectConfig.packageDirectories[1];
            }
            return null;
        });

        promptEnhancer = new PromptEnhancer(mockProjectPath);
    });

    describe('determineScope', () => {
        it('should return "packages" when packageNames are provided', () => {
            const scope = promptEnhancer.determineScope({ packageNames: ['core-package'] });
            expect(scope).toBe('packages');
        });

        it('should return "domain" when domain is provided', () => {
            const scope = promptEnhancer.determineScope({ domain: 'sales' });
            expect(scope).toBe('domain');
        });

        it('should return "repository" when no options are provided', () => {
            const scope = promptEnhancer.determineScope({});
            expect(scope).toBe('repository');
        });

        it('should prioritize packages over domain', () => {
            const scope = promptEnhancer.determineScope({
                packageNames: ['core-package'],
                domain: 'sales'
            });
            expect(scope).toBe('packages');
        });
    });

    describe('injectContext', () => {
        it('should replace single variable in prompt', () => {
            const prompt = 'Analyzing {{packageName}} package';
            const context: EnhancementContext = {
                scope: 'packages',
                projectPath: mockProjectPath,
                variables: {
                    packageName: 'core-package'
                }
            };

            const result = promptEnhancer.injectContext(prompt, context);
            expect(result).toBe('Analyzing core-package package');
        });

        it('should replace multiple variables in prompt', () => {
            const prompt = 'Package {{packageName}} has {{dependencyCount}} dependencies';
            const context: EnhancementContext = {
                scope: 'packages',
                projectPath: mockProjectPath,
                variables: {
                    packageName: 'ui-package',
                    dependencyCount: 1
                }
            };

            const result = promptEnhancer.injectContext(prompt, context);
            expect(result).toBe('Package ui-package has 1 dependencies');
        });

        it('should handle variables with spaces in template', () => {
            const prompt = 'Package {{ packageName }} at {{ packagePath }}';
            const context: EnhancementContext = {
                scope: 'packages',
                projectPath: mockProjectPath,
                variables: {
                    packageName: 'core-package',
                    packagePath: 'packages/core'
                }
            };

            const result = promptEnhancer.injectContext(prompt, context);
            expect(result).toBe('Package core-package at packages/core');
        });

        it('should return original prompt when no variables provided', () => {
            const prompt = 'Analyzing {{packageName}} package';
            const context: EnhancementContext = {
                scope: 'packages',
                projectPath: mockProjectPath
            };

            const result = promptEnhancer.injectContext(prompt, context);
            expect(result).toBe('Analyzing {{packageName}} package');
        });

        it('should handle missing variables gracefully', () => {
            const prompt = 'Package {{packageName}} version {{version}}';
            const context: EnhancementContext = {
                scope: 'packages',
                projectPath: mockProjectPath,
                variables: {
                    packageName: 'core-package'
                }
            };

            const result = promptEnhancer.injectContext(prompt, context);
            expect(result).toBe('Package core-package version {{version}}');
        });
    });

    describe('enhanceForPackages', () => {
        it('should enhance context for single package', async () => {
            const context = await promptEnhancer.enhanceForPackages(['core-package']);

            expect(context.scope).toBe('packages');
            expect(context.packages).toHaveLength(1);
            expect(context.packages![0].name).toBe('core-package');
            expect(context.packages![0].type).toBe('unlocked');
            expect(context.variables?.packageName).toBe('core-package');
            expect(context.variables?.packagePath).toBe('packages/core');
            expect(context.variables?.packageCount).toBe(1);
        });

        it('should enhance context for multiple packages', async () => {
            const context = await promptEnhancer.enhanceForPackages(['core-package', 'ui-package']);

            expect(context.scope).toBe('packages');
            expect(context.packages).toHaveLength(2);
            expect(context.variables?.packageCount).toBe(2);
            expect(context.variables?.packageNames).toBe('core-package, ui-package');
            expect(context.variables?.packageTypes).toContain('unlocked');
        });

        it('should handle non-existent packages gracefully', async () => {
            const context = await promptEnhancer.enhanceForPackages(['non-existent']);

            expect(context.scope).toBe('packages');
            expect(context.packages).toHaveLength(0);
            expect(context.variables?.packageCount).toBe(0);
        });
    });

    describe('enhanceForDomain', () => {
        it('should return basic domain context', async () => {
            const context = await promptEnhancer.enhanceForDomain('sales');

            expect(context.scope).toBe('domain');
            expect(context.domain).toBe('sales');
            expect(context.packages).toEqual([]);
            expect(context.variables?.domainName).toBe('sales');
        });
    });

    describe('enhanceForRepository', () => {
        it('should enhance context for entire repository', async () => {
            const context = await promptEnhancer.enhanceForRepository();

            expect(context.scope).toBe('repository');
            expect(context.packages).toHaveLength(2);
            expect(context.variables?.totalPackages).toBe(2);
            expect(context.variables?.projectPath).toBe(mockProjectPath);
            expect(context.variables?.projectName).toBe('path');
            expect(context.variables?.unlockedPackages).toEqual(['core-package', 'ui-package']);
        });
    });

    describe('edge cases', () => {
        it('should handle project config load failure', () => {
            (ProjectConfig.getSFDXProjectConfig as jest.Mock).mockImplementation(() => {
                throw new Error('Config not found');
            });

            expect(() => new PromptEnhancer(mockProjectPath)).not.toThrow();
        });

        it('should handle source packages without packageAliases', async () => {
            const modifiedConfig = { ...mockProjectConfig, packageAliases: {} };
            (ProjectConfig.getSFDXProjectConfig as jest.Mock).mockReturnValue(modifiedConfig);

            promptEnhancer = new PromptEnhancer(mockProjectPath);
            const context = await promptEnhancer.enhanceForPackages(['core-package']);

            expect(context.packages![0].type).toBe('source');
        });

        it('should detect data package type', async () => {
            const dataPackageDescriptor = {
                path: 'packages/data',
                package: 'data-package',
                type: 'data'
            };
            (ProjectConfig.getPackageDescriptorFromConfig as jest.Mock).mockReturnValue(dataPackageDescriptor);

            const context = await promptEnhancer.enhanceForPackages(['data-package']);
            expect(context.packages![0].type).toBe('data');
        });

        it('should detect diff package type', async () => {
            const diffPackageDescriptor = {
                path: 'packages/diff',
                package: 'diff-package',
                type: 'diff'
            };
            (ProjectConfig.getPackageDescriptorFromConfig as jest.Mock).mockReturnValue(diffPackageDescriptor);

            const context = await promptEnhancer.enhanceForPackages(['diff-package']);
            expect(context.packages![0].type).toBe('diff');
        });
    });
});