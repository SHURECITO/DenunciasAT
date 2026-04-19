import { Module } from '@nestjs/common';
import { GeminiService } from '@app/ai';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ConversacionService } from './conversacion.service';
import { DashboardApiService } from './dashboard-api.service';
import { RagApiService } from './rag-api.service';

@Module({
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ConversacionService,
    DashboardApiService,
    RagApiService,
    GeminiService,
  ],
})
export class ChatbotModule {}
