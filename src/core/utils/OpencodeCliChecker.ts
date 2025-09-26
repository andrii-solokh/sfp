import { execSync } from 'child_process';
import SFPLogger, { LoggerLevel, Logger } from '@flxbl-io/sfp-logger';

export class OpencodeCliChecker {
    /**
     * Check if the OpenCode CLI is installed on the system
     * @returns true if OpenCode CLI is installed, false otherwise
     */
    public static isInstalled(): boolean {
        try {
            // Try to execute 'opencode --version' to check if it's installed
            // Use different commands based on the platform
            const command = process.platform === 'win32' ? 'where opencode' : 'which opencode';
            execSync(command, { stdio: 'ignore' });
            return true;
        } catch (error) {
            // Command not found
            return false;
        }
    }

    /**
     * Display error message and installation instructions for OpenCode CLI
     * @param logger Optional logger instance
     */
    public static displayInstallationInstructions(logger?: Logger): void {
        SFPLogger.log(
            '\n❌ OpenCode CLI is required for OAuth authentication but is not installed.',
            LoggerLevel.ERROR,
            logger
        );
        SFPLogger.log(
            '   Please install it using one of the following methods:',
            LoggerLevel.INFO,
            logger
        );
        SFPLogger.log(
            '   • npm install -g opencode-ai',
            LoggerLevel.INFO,
            logger
        );
        SFPLogger.log(
            '   • Or download from: https://github.com/opencode-ai/opencode/releases',
            LoggerLevel.INFO,
            logger
        );
        SFPLogger.log(
            '\n   After installation, please retry the authentication command.',
            LoggerLevel.INFO,
            logger
        );
    }

    /**
     * Check if OpenCode CLI is installed and display instructions if not
     * @param context Context where the check is being performed (e.g., "OAuth authentication")
     * @param logger Optional logger instance
     * @returns true if installed, false if not (after displaying instructions)
     */
    public static checkAndWarn(context: string, logger?: Logger): boolean {
        if (!this.isInstalled()) {
            SFPLogger.log(
                `\n⚠️  OpenCode CLI is required for ${context}`,
                LoggerLevel.WARN,
                logger
            );
            this.displayInstallationInstructions(logger);
            return false;
        }
        return true;
    }
}