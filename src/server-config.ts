export type ServerOptions = {
    modelName: string;
};

export const SERVER_VERSION = '1.3.0';
export const DEFAULT_MODEL_NAME = 'gemini-flash-lite-latest';
export const MODEL_ENV_VAR = 'MCP_GEMINI_MODEL';

export function loadServerOptions(env: NodeJS.ProcessEnv): ServerOptions {
    const modelCandidate = env[MODEL_ENV_VAR];

    const modelName =
        typeof modelCandidate === 'string' && modelCandidate.trim().length > 0
            ? modelCandidate.trim()
            : DEFAULT_MODEL_NAME;

    return {
        modelName,
    };
}

