"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
const http_exception_filter_1 = require("./common/http-exception.filter");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const logger = new common_1.Logger('Bootstrap');
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: false },
    }));
    app.useGlobalFilters(new http_exception_filter_1.HttpExceptionFilter());
    const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',');
    app.enableCors({ origin: origins, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] });
    if (process.env.NODE_ENV !== 'production') {
        const config = new swagger_1.DocumentBuilder()
            .setTitle('AsterVision 产品知识中心 API')
            .setDescription('NestJS + Prisma；AskAI 走 SSE，索引重建需 Bearer 令牌')
            .setVersion('1.0')
            .addBearerAuth()
            .build();
        swagger_1.SwaggerModule.setup('docs', app, swagger_1.SwaggerModule.createDocument(app, config));
    }
    const port = Number(process.env.PORT ?? 3001);
    await app.listen(port, '127.0.0.1');
    logger.log(`API 就绪 http://127.0.0.1:${port}/api/v1 · 文档 http://127.0.0.1:${port}/docs`);
}
void bootstrap();
//# sourceMappingURL=main.js.map