import { createMongoLog } from '@/main/facades';
import { ELASTICSEARCH, LOGGER } from '@/util/constants';
import ecsFormat from '@elastic/ecs-winston-format';
import path from 'path';
import { createLogger, format, Logger, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { ElasticsearchTransport } from 'winston-elasticsearch';

import { elasticAPM } from '../../apm';
import { cli, file, json } from './formats';
import { GenericTransport } from './transports';

type LogParams = {
  level:
    | 'error'
    | 'warn'
    | 'info'
    | 'http'
    | 'verbose'
    | 'debug'
    | 'silly'
    | String;
  message: string;
  payload?: object;
  [key: string]: any;
};

const apm = elasticAPM().getAPM();

const { combine, timestamp, colorize } = format;

const defaultTimestamp = timestamp({ format: 'YYYY-MM-DD HH:mm:ss' });

const esTemplate = {
  index_patterns: ['logs-*'],
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    index: {
      refresh_interval: '5s',
    },
  },
  mappings: {
    _source: { enabled: true },
  },
};

export class CustomLogger {
  private static instance: CustomLogger;

  private logger!: Logger;

  constructor() {
    this.logger = createLogger({
      transports: [
        new DailyRotateFile({
          filename: 'logs',
          extension: '.log',
          datePattern: 'YYYY-MM-DD',
          dirname: path.resolve('logs'),
          level: 'verbose',
          format: combine(defaultTimestamp, file),
        }),
        new transports.Console({
          level: LOGGER.CONSOLE.LEVEL,
          format: combine(defaultTimestamp, cli, colorize({ all: true })),
        }),
      ],
    });

    if (ELASTICSEARCH.ENABLED) {
      const esClientOpts = {
        node: ELASTICSEARCH.SERVER_URL,
        auth: {
          username: ELASTICSEARCH.USERNAME,
          password: ELASTICSEARCH.PASSWORD,
        },
      };
      this.logger.push(
        new ElasticsearchTransport({
          apm,
          level: 'verbose',
          indexTemplate: esTemplate,
          indexPrefix: 'logs',
          format: ecsFormat({
            apmIntegration: true,
            convertErr: true,
          }),
          clientOpts: esClientOpts,
        })
      );
    }

    if (LOGGER.DATABASE.ENABLED) {
      this.logger.transports.push(
        new GenericTransport({
          level: 'verbose',
          format: combine(defaultTimestamp, json),
          receiver: createMongoLog,
        })
      );
    }
  }

  public static getInstance(): CustomLogger {
    if (!CustomLogger.instance) {
      CustomLogger.instance = new CustomLogger();
    }

    return CustomLogger.instance;
  }

  public log(error: Error): void;
  public log(params: LogParams): void;
  public log(params: LogParams | Error): void {
    const { traceId, transactionId } = (() => {
      if (apm) {
        const transactionId = apm.currentTransaction?.ids['transaction.id'];
        const traceId = apm.currentTransaction?.ids['trace.id'];
        return { transactionId, traceId };
      }

      return { transactionId: undefined, traceId: undefined };
    })();

    if (params instanceof Error) {
      if (apm) {
        apm.captureError(params);
      }

      this.logger.log({
        traceId,
        transactionId,
        name: params.name,
        message: params.message,
        stack: params.stack,
        level: 'error',
      });

      return;
    }

    const { level, message, ...any } = params;

    this.logger.log({
      traceId,
      transactionId,
      message,
      level: <string>level,
      ...any,
    });
  }
}
