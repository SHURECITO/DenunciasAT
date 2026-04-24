import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { StorageModule } from '@app/storage';
import { WebhookController } from './webhook.controller';
import { HealthController, QrController } from './qr.controller';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

@Module({
  imports: [StorageModule],
  controllers: [WebhookController, QrController, HealthController],
  providers: [
    EvolutionService,
    ChatbotClientService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.get<string>('REDIS_URL', 'redis://redis:6379'), {
          commandTimeout: 3000,
          connectTimeout: 5000,
          enableReadyCheck: true,
          retryStrategy: (times) => {
            if (times > 5) return null;
            return Math.min(times * 300, 2000);
          },
          reconnectOnError: (err) => {
            const targetErrors = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];
            return targetErrors.some((e) => err.message.includes(e));
          },
        });
        client.on('error', (err) => {
          // No propagar — el webhook no debe caer por Redis
          console.error(`[REDIS_CLIENT] Redis error: ${err.message}`);
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
})
export class WebhookModule {}
