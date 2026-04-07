export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const resolveLevel = (value: string | undefined): LogLevel => {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
};

export const createLogger = (level?: string): Logger => {
  const minLevel = resolveLevel(level);

  const write = (targetLevel: LogLevel, message: string, metadata?: Record<string, unknown>): void => {
    if (LEVEL_RANK[targetLevel] < LEVEL_RANK[minLevel]) {
      return;
    }

    const event = {
      ts: new Date().toISOString(),
      level: targetLevel,
      message,
      ...(metadata ? { metadata } : {}),
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(event));
  };

  return {
    debug: (message, metadata) => write("debug", message, metadata),
    info: (message, metadata) => write("info", message, metadata),
    warn: (message, metadata) => write("warn", message, metadata),
    error: (message, metadata) => write("error", message, metadata),
  };
};
