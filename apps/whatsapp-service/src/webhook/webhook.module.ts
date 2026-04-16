import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { EvolutionService } from './evolution.service';
import { ChatbotClientService } from './chatbot-client.service';

@Module({
  controllers: [WebhookController],
  providers: [EvolutionService, ChatbotClientService],
})
export class WebhookModule {}
