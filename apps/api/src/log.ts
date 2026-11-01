/**
 * Structured JSON logger: one JSON object per line with `time`, `level`,
 * `msg` and the merged fields. Errors are reduced to name/message/stack,
 * bigints become strings, and a value that cannot be serialized never
 * throws (the line is still written with a marker).
 */
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Readonly<Record<string, unknown>>;

const SEVERITY: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  readonly level: LogLevel;
  enabled(level: Exclude<LogLevel, "silent">): boolean;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line. */
  child(fields: LogFields): Logger;
}

export type LogSink = (line: string, level: Exclude<LogLevel, "silent">) => void;

export const stdioSink: LogSink = (line, level) => {
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly base?: LogFields;
  readonly sink?: LogSink;
  readonly clock?: Clock;
}

function serializeError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (error.stack) out.stack = error.stack.split("\n").slice(0, 12).join("\n");
  return out;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return serializeError(value);
  return value;
}

export function formatLogLine(time: number, level: string, msg: string, fields: LogFields): string {
  const record = { time: new Date(time).toISOString(), level, msg, ...fields };
  try {
    return JSON.stringify(record, replacer);
  } catch {
    // Circular structures and throwing getters: keep the line, drop the fields.
    return JSON.stringify({ time: record.time, level, msg, logError: "fields could not be serialized" });
  }
}

class JsonLogger implements Logger {
  constructor(
    readonly level: LogLevel,
    private readonly base: LogFields,
    private readonly sink: LogSink,
    private readonly clock: Clock,
  ) {}

  enabled(level: Exclude<LogLevel, "silent">): boolean {
    return SEVERITY[level] >= SEVERITY[this.level];
  }

  private write(level: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields): void {
    if (!this.enabled(level)) return;
    this.sink(formatLogLine(this.clock.now(), level, msg, fields ? { ...this.base, ...fields } : this.base), level);
  }

  debug(msg: string, fields?: LogFields): void {
    this.write("debug", msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.write("info", msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.write("warn", msg, fields);
  }

  error(msg: string, fields?: LogFields): void {
    this.write("error", msg, fields);
  }

  child(fields: LogFields): Logger {
    return new JsonLogger(this.level, { ...this.base, ...fields }, this.sink, this.clock);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new JsonLogger(options.level ?? "info", options.base ?? {}, options.sink ?? stdioSink, options.clock ?? systemClock);
}

/** A logger that drops everything (tests, embedders). */
export const silentLogger: Logger = createLogger({ level: "silent" });

/** A logger that keeps lines in memory (tests). */
export function memoryLogger(level: LogLevel = "debug"): Logger & { readonly lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({ level, sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return Object.assign(logger, { lines });
}
