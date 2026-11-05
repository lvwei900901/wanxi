import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Visibility Dashboard API')
    .setDescription(
      'AsterVision AI 可见度看板。聚合接口返回结构与 dashboard_summary.json 一致。',
    )
    .setVersion('1.0')
    .addTag('dashboard')
    .addTag('records')
    .addTag('meta')
    .addTag('insight')
    .addTag('health')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`API      http://localhost:${port}/api/dashboard`, 'Bootstrap');
  Logger.log(`Swagger  http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
