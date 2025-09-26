import { Logger } from '@flxbl-io/sfp-logger';

export interface AgentOptions {
    projectPath: string;
    providerId?: string;
    modelId?: string;
    logger?: Logger;
}

export interface AgentPrompt {
    name: string;
    content: string;
    context?: Record<string, any>;
}

export interface AgentResponse {
    content: string;
    metadata?: Record<string, any>;
}

export interface SessionConfig {
    providerId: string;
    modelId: string;
    temperature?: number;
    maxTokens?: number;
}

// Re-export OpenCode client type
export type OpenCodeClient = any; // ESM module type

// Report-specific types
export interface AnalysisPrompt {
    name: string;
    order: number;
    content: string;
}

export interface ReportSection {
    title: string;
    content: string;
}

export type AnalysisScope = 'repository' | 'domain' | 'packages';

export interface ReportGeneratorOptions {
    projectPath: string;
    providerId?: string;
    modelId?: string;
    promptCount?: number;
    packageNames?: string[];
    domain?: string;
    logger?: Logger;
    enableProgressiveContext?: boolean;  // Enable progressive context accumulation (default: true)
    maxContextSize?: number;             // Max characters per context summary (default: 1000)
}