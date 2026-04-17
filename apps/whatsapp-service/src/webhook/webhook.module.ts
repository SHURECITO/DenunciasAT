import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { WebhookController } from './webhook.controller';
import { HealthController, QrController } from './qr.controller';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

@Module({
  controllers: [WebhookController, QrController, HealthController],
  providers: [
    EvolutionService,
    ChatbotClientService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL', 'redis://redis:6379')),
      inject: [ConfigService],
    },
  ],
})
export class WebhookModule {}
