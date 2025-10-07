import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export type ServerOptions = {
    modelName: string;
};

// 自動從 package.json 讀取版本號
function getPackageVersion(): string {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const packagePath = join(__dirname, '..', 'package.json');
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return packageJson.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

export const SERVER_VERSION = getPackageVersion();
export const DEFAULT_MODEL_NAME = 'models/gemini-flash-lite-latest';
export const MODEL_ENV_VAR = 'GEMINI_MODEL';

export function loadServerOptions(env: NodeJS.ProcessEnv): ServerOptions {
    const modelCandidate = env[MODEL_ENV_VAR];

    const modelName =
        typeof modelCandidate === 'string' && modelCandidate.trim().length > 0
            ? normalizeModelName(modelCandidate)
            : DEFAULT_MODEL_NAME;

    return {
        modelName,
    };
}

export function normalizeModelName(candidate: string): string {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
        return DEFAULT_MODEL_NAME;
    }

    return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`;
}

