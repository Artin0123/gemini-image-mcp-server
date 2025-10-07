export type ServerOptions = {
    modelName: string;
};

export const SERVER_VERSION = '1.3.0';
export const DEFAULT_MODEL_NAME = 'gemini-flash-lite-latest';

export function loadServerOptions(env: NodeJS.ProcessEnv): ServerOptions {
    const modelCandidate =
        env.GEMINI_MODEL ??
        env.GEMINI_MODEL_NAME ??
        env.MCP_GEMINI_MODEL ??
        env.GOOGLE_GEMINI_MODEL;

    const modelName =
        typeof modelCandidate === 'string' && modelCandidate.trim().length > 0
            ? modelCandidate.trim()
            : DEFAULT_MODEL_NAME;

    return {
        modelName,
    };
}

