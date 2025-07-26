import winston from 'winston';
import path from 'path';

// 自定义格式，包含时间、日志级别、文件名、行号和消息
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, filename, lineNumber }) => {
    const fileInfo = filename && lineNumber ? ` [${filename}:${lineNumber}]` : '';
    const stackInfo = stack ? `\n${stack}` : '';
    return `${timestamp} [${level.toUpperCase()}]${fileInfo} ${message}${stackInfo}`;
  })
);

// 控制台格式（带颜色）
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack, filename, lineNumber }) => {
    const fileInfo = filename && lineNumber ? ` [${filename}:${lineNumber}]` : '';
    const stackInfo = stack ? `\n${stack}` : '';
    return `${timestamp} [${level.toUpperCase()}]${fileInfo} ${message}${stackInfo}`;
  })
);

// 创建日志目录
const logDir = path.join(process.cwd(), 'logs');

// 创建 logger 实例
const logger = winston.createLogger({
  level: 'info',
  format: customFormat,
  defaultMeta: { service: 'cloud-bot' },
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: consoleFormat
    }),
    
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // 所有日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // 调试日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'debug.log'),
      level: 'debug',
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      tailable: true
    })
  ]
});

// 直接导出 winston logger
export const log = logger;

// 导出原始 logger 用于特殊用途
export { logger };

// 设置日志级别
export function setLogLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose') {
  logger.level = level;
}

// 获取日志文件路径
export function getLogFiles() {
  return {
    error: path.join(logDir, 'error.log'),
    combined: path.join(logDir, 'combined.log'),
    debug: path.join(logDir, 'debug.log')
  };
} 