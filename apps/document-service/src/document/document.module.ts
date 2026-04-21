import { Module } from '@nestjs/common';
import { GeminiService, InferenciasService } from '@app/ai';
import { StorageModule } from '@app/storage';
import { DocumentController, HealthController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentBuilderService } from './document-builder.service';
import { DashboardApiService } from './dashboard-api.service';

@Module({
  imports: [StorageModule],
  controllers: [DocumentController, HealthController],
  providers: [DocumentService, DocumentBuilderService, DashboardApiService, GeminiService, InferenciasService],
})
export class DocumentModule {}
