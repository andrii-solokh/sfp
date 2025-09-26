import { ReportSection } from './types';

export class ReportAssembler {
    constructor(
        private projectPath: string,
        private providerId?: string,
        private modelId?: string,
        private scope?: { type: string; details?: string }
    ) {}

    assembleMarkdown(sections: ReportSection[]): string {
        const timestamp = new Date().toISOString();
        const date = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        let report = this.generateHeader();
        report += this.generateTableOfContents(sections);
        report += this.generateSections(sections);
        report += this.generateFooter(timestamp, date);

        return report;
    }

    private generateHeader(): string {
        let scopeText = 'Repository';
        if (this.scope) {
            if (this.scope.type === 'packages' && this.scope.details) {
                scopeText = `Package: ${this.scope.details}`;
            } else if (this.scope.type === 'domain' && this.scope.details) {
                scopeText = `Domain: ${this.scope.details}`;
            }
        }

        return `# Flxbl nSights Report: ${scopeText}

> **⚠️ DRAFT REPORT - REQUIRES REVIEW**
> This is an AI-generated analysis. Please use your judgment and verify findings before sharing with stakeholders.
> AI insights should complement, not replace, human expertise and context.

---

`;
    }

    private generateTableOfContents(sections: ReportSection[]): string {
        let toc = `## Table of Contents\n\n`;

        sections.forEach((section, idx) => {
            const anchor = this.slugify(section.title);
            toc += `${idx + 1}. [${section.title}](#${anchor})\n`;
        });

        return toc + '\n---\n\n';
    }

    private generateSections(sections: ReportSection[]): string {
        let content = '';

        sections.forEach(section => {
            content += `## ${section.title}\n\n`;
            content += section.content;

            if (!section.content.endsWith('\n')) {
                content += '\n';
            }

            content += '\n---\n\n';
        });

        return content;
    }

    private generateFooter(timestamp: string, date: string): string {
        const providerName = this.getProviderDisplayName(this.providerId);
        const modelName = this.modelId || 'Default Model';

        return `## Report Metadata

- **Analysis Tool:** sfp
- **AI Provider:** ${providerName}
- **AI Model:** ${modelName}
- **Generated:** ${date}
- **Timestamp:** ${timestamp}
- **Project Path:** ${this.projectPath}

<sub>*🔍 Unlock deeper architectural insights with expert analysis - [Flxbl nSights](https://flxbl.io/)*</sub>
`;
    }

    private getProviderDisplayName(providerId?: string): string {
        const providerNames: Record<string, string> = {
            'anthropic': 'Anthropic (Claude)',
            'openai': 'OpenAI',
            'google': 'Google (Gemini)',
            'github-copilot': 'GitHub Copilot',
            'amazon-bedrock': 'Amazon Bedrock'
        };
        return providerId ? (providerNames[providerId] || providerId) : 'Unknown';
    }

    private slugify(text: string): string {
        return text
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
    }
}