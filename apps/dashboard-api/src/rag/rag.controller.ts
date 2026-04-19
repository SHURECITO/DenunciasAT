import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RagProxyService } from './rag.service';

@ApiTags('rag')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagProxyService) {}

  @Get('dependencias')
  @ApiOperation({ summary: 'Listar dependencias indexadas en rag-service' })
  getDependencias() {
    return this.ragService.getDependencias();
  }

  @Post('reindexar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Forzar reindexación de embeddings en rag-service' })
  reindexar() {
    return this.ragService.reindexar();
  }
}
