/**
 * Production-ready logging utility
 * Conditionally logs based on environment and log level
 */

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';

// Log levels
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Enable all logs in dev, only warn/error in production
const MIN_LOG_LEVEL: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const PRODUCTION_MIN_LEVEL = 2; // warn and above
const DEVELOPMENT_MIN_LEVEL = 0; // all logs

const currentMinLevel = isDevelopment ? DEVELOPMENT_MIN_LEVEL : PRODUCTION_MIN_LEVEL;

/**
 * Check if a log level should be shown
 */
const shouldLog = (level: LogLevel): boolean => {
  return MIN_LOG_LEVEL[level] >= currentMinLevel;
};

/**
 * Logger object with methods for each log level
 */
export const logger = {
  /**
   * Debug level - only shown in development
   */
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) {
      console.log(...args);
    }
  },

  /**
   * Info level - only shown in development
   */
  info: (...args: unknown[]) => {
    if (shouldLog('info')) {
      console.log(...args);
    }
  },

  /**
   * Warning level - shown in production
   */
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) {
      console.warn(...args);
    }
  },

  /**
   * Error level - always shown
   */
  error: (...args: unknown[]) => {
    if (shouldLog('error')) {
      console.error(...args);
    }
  },

  /**
   * Always log regardless of level (for critical messages)
   */
  always: (...args: unknown[]) => {
    console.log(...args);
  },
};

/**
 * Create a scoped logger with a prefix
 */
export const createScopedLogger = (scope: string) => ({
  debug: (...args: unknown[]) => logger.debug(`[${scope}]`, ...args),
  info: (...args: unknown[]) => logger.info(`[${scope}]`, ...args),
  warn: (...args: unknown[]) => logger.warn(`[${scope}]`, ...args),
  error: (...args: unknown[]) => logger.error(`[${scope}]`, ...args),
  always: (...args: unknown[]) => logger.always(`[${scope}]`, ...args),
});

export default logger;
