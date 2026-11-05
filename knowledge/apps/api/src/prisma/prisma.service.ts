import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { databaseUrl, dbPath } from './db-path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ datasourceUrl: databaseUrl() });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // 只读查询不需要 WAL，但索引重建期间会写入，WAL 让读不被写阻塞
    // 注：这三个 PRAGMA 都会返回结果行（journal_mode / busy_timeout 返回当前值），
    // 只能用 $queryRawUnsafe；$executeRawUnsafe 在 SQLite 上遇到结果集会直接报错
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await this.$queryRawUnsafe('PRAGMA foreign_keys = ON');
    this.logger.log(`已连接 ${dbPath()}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
