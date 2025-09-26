import { Logger, LoggerLevel } from '@flxbl-io/sfp-logger';
import SFPLogger from '@flxbl-io/sfp-logger';
import ProjectConfig from '../../../core/project/ProjectConfig';
import { PackageType } from '../../../core/package/SfpPackage';
import { ReleaseConfigAggregator } from '../../release/ReleaseConfigAggregator';
import { AnalysisScope } from './types';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface PackageMetadata {
    name: string;
    path: string;
    type: 'unlocked' | 'source' | 'data' | 'diff';
    isOrgDependent?: boolean;
    dependencies?: any[];
    versionNumber?: string;
    aliasfy?: boolean;
}

export interface EnhancementContext {
    scope: AnalysisScope;
    packages?: PackageMetadata[];
    domain?: string;
    projectPath: string;
    variables?: Record<string, any>;
}

/**
 * Enhances prompts with contextual information about packages, domains, and project structure
 * This class is responsible for resolving package metadata and injecting context into prompts
 */
export class PromptEnhancer {
    private projectConfig: any;
    private logger?: Logger;

    constructor(private projectPath: string, logger?: Logger) {
        this.logger = logger;
        this.loadProjectConfig();
    }

    private loadProjectConfig(): void {
        try {
            this.projectConfig = ProjectConfig.getSFDXProjectConfig(this.projectPath);
        } catch (error) {
            SFPLogger.log(
                `Failed to load project config: ${error.message}`,
                LoggerLevel.WARN,
                this.logger
            );
            this.projectConfig = null;
        }
    }

    /**
     * Enhance prompts with package-specific context
     */
    public async enhanceForPackages(packageNames: string[]): Promise<EnhancementContext> {
        const packages: PackageMetadata[] = [];

        for (const packageName of packageNames) {
            const metadata = await this.getPackageMetadata(packageName);
            if (metadata) {
                packages.push(metadata);
            }
        }

        return {
            scope: 'packages',
            packages,
            projectPath: this.projectPath,
            variables: this.buildPackageVariables(packages)
        };
    }

    /**
     * Enhance prompts with domain-specific context
     */
    public async enhanceForDomain(domain: string): Promise<EnhancementContext> {
        // Domain analysis is not supported in community edition
        // Return empty context
        return {
            scope: 'domain',
            domain,
            packages: [],
            projectPath: this.projectPath,
            variables: this.buildDomainVariables(domain, [])
        };
    }

    /**
     * Enhance prompts for repository-wide analysis
     */
    public async enhanceForRepository(): Promise<EnhancementContext> {
        const allPackages = ProjectConfig.getAllPackagesFromProjectConfig(this.projectConfig);
        const packages: PackageMetadata[] = [];

        for (const packageName of allPackages) {
            const metadata = await this.getPackageMetadata(packageName);
            if (metadata) {
                packages.push(metadata);
            }
        }

        return {
            scope: 'repository',
            packages,
            projectPath: this.projectPath,
            variables: this.buildRepositoryVariables(packages)
        };
    }

    /**
     * Get detailed metadata for a specific package
     */
    private async getPackageMetadata(packageName: string): Promise<PackageMetadata | null> {
        if (!this.projectConfig) {
            return null;
        }

        try {
            const packageDescriptor = ProjectConfig.getPackageDescriptorFromConfig(
                packageName,
                this.projectConfig
            );

            if (!packageDescriptor) {
                SFPLogger.log(
                    `Package descriptor not found for ${packageName}`,
                    LoggerLevel.WARN,
                    this.logger
                );
                return null;
            }

            const packageType = this.determinePackageType(packageName, packageDescriptor);
            const isOrgDependent = await this.checkIfOrgDependent(packageName, packageType);

            return {
                name: packageName,
                path: packageDescriptor.path,
                type: packageType,
                isOrgDependent,
                dependencies: packageDescriptor.dependencies,
                versionNumber: packageDescriptor.versionNumber,
                aliasfy: packageDescriptor.aliasfy
            };
        } catch (error) {
            SFPLogger.log(
                `Failed to get metadata for package ${packageName}: ${error.message}`,
                LoggerLevel.WARN,
                this.logger
            );
            return null;
        }
    }

    /**
     * Determine the type of a package
     */
    private determinePackageType(
        packageName: string,
        packageDescriptor: any
    ): 'unlocked' | 'source' | 'data' | 'diff' {
        // Check if it's an unlocked package (has an alias in packageAliases)
        if (this.projectConfig['packageAliases']?.[packageName]) {
            return 'unlocked';
        }

        // Check explicit type in descriptor
        const explicitType = packageDescriptor.type?.toLowerCase();
        if (explicitType === PackageType.Data) return 'data';
        if (explicitType === PackageType.Diff) return 'diff';
        if (explicitType === PackageType.Source) return 'source';

        // Default to source if no explicit type
        return 'source';
    }

    /**
     * Check if an unlocked package is org-dependent
     */
    private async checkIfOrgDependent(
        packageName: string,
        packageType: 'unlocked' | 'source' | 'data' | 'diff'
    ): Promise<boolean | undefined> {
        if (packageType !== 'unlocked') {
            return undefined;
        }

        // In a real implementation, this would query the DevHub or check package metadata
        // For now, we'll check if the package has dependencies as a heuristic
        const packageDescriptor = ProjectConfig.getPackageDescriptorFromConfig(
            packageName,
            this.projectConfig
        );

        // Org-dependent packages typically don't have dependencies listed
        return !packageDescriptor.dependencies || packageDescriptor.dependencies.length === 0;
    }

    /**
     * Inject context variables into a prompt template
     */
    public injectContext(prompt: string, context: EnhancementContext): string {
        if (!context.variables) {
            return prompt;
        }

        let enhancedPrompt = prompt;

        // Replace variables in the format {{variableName}}
        Object.entries(context.variables).forEach(([key, value]) => {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            enhancedPrompt = enhancedPrompt.replace(regex, String(value));
        });

        return enhancedPrompt;
    }

    /**
     * Determine the scope based on provided options
     */
    public determineScope(options: {
        packageNames?: string[];
        domain?: string;
    }): AnalysisScope {
        if (options.packageNames && options.packageNames.length > 0) {
            return 'packages';
        }
        if (options.domain) {
            return 'domain';
        }
        return 'repository';
    }

    /**
     * Build variables for package-scoped analysis
     */
    private buildPackageVariables(packages: PackageMetadata[]): Record<string, any> {
        const variables: Record<string, any> = {
            packageCount: packages.length,
            projectPath: this.projectPath
        };

        if (packages.length === 1) {
            const pkg = packages[0];
            variables.packageName = pkg.name;
            variables.packagePath = pkg.path;
            variables.packageType = pkg.type;
            variables.isOrgDependent = pkg.isOrgDependent || false;
            variables.versionNumber = pkg.versionNumber;
            variables.dependencyCount = pkg.dependencies?.length || 0;
        } else if (packages.length > 1) {
            variables.packageNames = packages.map(p => p.name).join(', ');
            variables.packageTypes = [...new Set(packages.map(p => p.type))].join(', ');
        }

        return variables;
    }

    /**
     * Build variables for domain-scoped analysis
     */
    private buildDomainVariables(domain: string, packages: PackageMetadata[]): Record<string, any> {
        return {
            domainName: domain,
            packageCount: packages.length,
            packageNames: packages.map(p => p.name).join(', '),
            packageTypes: [...new Set(packages.map(p => p.type))].join(', '),
            projectPath: this.projectPath,
            unlockedPackageCount: packages.filter(p => p.type === 'unlocked').length,
            sourcePackageCount: packages.filter(p => p.type === 'source').length,
            dataPackageCount: packages.filter(p => p.type === 'data').length,
            diffPackageCount: packages.filter(p => p.type === 'diff').length
        };
    }

    /**
     * Build variables for repository-scoped analysis
     */
    private buildRepositoryVariables(packages: PackageMetadata[]): Record<string, any> {
        return {
            totalPackages: packages.length,
            projectPath: this.projectPath,
            projectName: path.basename(this.projectPath),
            unlockedPackages: packages.filter(p => p.type === 'unlocked').map(p => p.name),
            sourcePackages: packages.filter(p => p.type === 'source').map(p => p.name),
            dataPackages: packages.filter(p => p.type === 'data').map(p => p.name),
            diffPackages: packages.filter(p => p.type === 'diff').map(p => p.name),
            orgDependentPackages: packages.filter(p => p.isOrgDependent).map(p => p.name)
        };
    }
}