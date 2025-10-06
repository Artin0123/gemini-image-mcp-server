export type ToolName =
    | 'analyze_image'
    | 'analyze_image_local'
    | 'analyze_video'
    | 'analyze_video_local'
    | 'analyze_youtube_video';

export type ServerOptions = {
    modelName: string;
    disabledTools: Set<ToolName>;
};

export const SERVER_VERSION = '1.2.0';
export const DEFAULT_MODEL_NAME = 'gemini-flash-lite-latest';

export const KNOWN_TOOL_NAMES: readonly ToolName[] = [
    'analyze_image',
    'analyze_image_local',
    'analyze_video',
    'analyze_video_local',
    'analyze_youtube_video',
];

export function isKnownToolName(value: string): value is ToolName {
    return (KNOWN_TOOL_NAMES as readonly string[]).includes(value);
}

export function parseList(value: string | undefined): string[] {
    if (!value) {
        return [];
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
                    .filter((item) => item.length > 0);
            }
        } catch (error) {
            console.warn(
                `Failed to parse list value as JSON. Falling back to delimiter parsing. ${error instanceof Error ? error.message : String(
                    error
                )}`
            );
        }
    }

    return trimmed
        .split(/[,;\n]/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
}

export function parseDisabledTools(raw: string | undefined): Set<ToolName> {
    const disabled = new Set<ToolName>();

    for (const entry of parseList(raw)) {
        const normalized = entry.toLowerCase();
        if (isKnownToolName(normalized)) {
            disabled.add(normalized);
        } else {
            console.warn(`Ignoring unknown tool name in disabledTools configuration: ${entry}`);
        }
    }

    return disabled;
}

export function loadServerOptions(env: NodeJS.ProcessEnv): ServerOptions {
    const modelCandidate =
        env.GEMINI_MODEL ?? env.GEMINI_MODEL_NAME ?? env.MCP_GEMINI_MODEL ?? env.GOOGLE_GEMINI_MODEL;
    const modelName = typeof modelCandidate === 'string' && modelCandidate.trim().length > 0
        ? modelCandidate.trim()
        : DEFAULT_MODEL_NAME;

    const disabledTools = parseDisabledTools(
        env.DISABLED_TOOLS ?? env.MCP_DISABLED_TOOLS ?? env.MCP_DISABLED_TOOL ?? env.GEMINI_DISABLED_TOOLS
    );

    return {
        modelName,
        disabledTools,
    };
}
