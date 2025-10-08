export type ServerOptions = {
    modelName: string;
};

export const SERVER_VERSION = '1.4.3';
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
