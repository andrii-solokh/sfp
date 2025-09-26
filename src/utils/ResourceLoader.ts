import * as path from 'path';
import * as fs from 'fs-extra';

export default class ResourceLoader {
    public static getResourcePath(resourcePath: string): string {
        // Try multiple possible locations
        const possiblePaths = [
            path.join(process.cwd(), resourcePath),
            path.join(__dirname, '../../', resourcePath),
            path.join(__dirname, '../../../', resourcePath),
            resourcePath // Try absolute path as-is
        ];

        for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
                return possiblePath;
            }
        }

        // If not found, return the original path and let the caller handle the error
        return resourcePath;
    }
}