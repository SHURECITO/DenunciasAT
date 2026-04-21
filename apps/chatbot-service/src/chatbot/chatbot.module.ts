import { Module } from '@nestjs/common';
import { GeminiService, InferenciasService } from '@app/ai';
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
    InferenciasService,
    GeminiService,
  ],
})
export class ChatbotModule {}
