/**
 * @vetios/logger
 *
 * Structured JSON logger for the VetIOS platform.
 * Supports contextual fields (tenant_id, trace_id, user_id)
 * for consistent, queryable log output across all modules.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
    tenant_id?: string;
    trace_id?: string;
    user_id?: string;
    encounter_id?: string;
    [key: string]: unknown;
}

interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    context: LogContext;
    data?: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

function getMinLevel(): LogLevel {
    const env = (typeof process !== 'undefined' && process.env?.['LOG_LEVEL']) || 'info';
    if (env in LOG_LEVEL_PRIORITY) {
        return env as LogLevel;
    }
    return 'info';
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getMinLevel()];
}

function formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
}

function emit(level: LogLevel, message: string, context: LogContext, data?: unknown): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        context,
        ...(data !== undefined && { data }),
    };

    const output = formatEntry(entry);

    switch (level) {
        case 'error':
            console.error(output);
            break;
        case 'warn':
            console.warn(output);
            break;
        case 'debug':
            console.debug(output);
            break;
        default:
            console.log(output);
    }
}

export interface Logger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    child(additionalContext: LogContext): Logger;
}

/**
 * Creates a structured logger bound to a specific context.
 *
 * Usage:
 *   const log = createLogger({ tenant_id: 'clinic-1', trace_id: 'abc-123' });
 *   log.info('Encounter started', { encounter_id: 'enc-456' });
 *   log.error('AI inference failed', { model: 'gpt-4', latency_ms: 3200 });
 */
export function createLogger(context: LogContext = {}): Logger {
    return {
        debug(message: string, data?: unknown) {
            emit('debug', message, context, data);
        },
        info(message: string, data?: unknown) {
            emit('info', message, context, data);
        },
        warn(message: string, data?: unknown) {
            emit('warn', message, context, data);
        },
        error(message: string, data?: unknown) {
            emit('error', message, context, data);
        },
        child(additionalContext: LogContext): Logger {
            return createLogger({ ...context, ...additionalContext });
        },
    };
}
