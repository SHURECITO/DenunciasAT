import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

interface JwtPayload {
  sub: number;
  email: string;
}

@ApiTags('feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Registrar feedback del abogado y marcar documento como revisado' })
  create(
    @Body() dto: CreateFeedbackDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.feedbackService.create(dto, req.user.sub);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Estadísticas agregadas de precisión de la IA' })
  getStats() {
    return this.feedbackService.getStats();
  }

  @Get('denuncia/:denunciaId')
  @ApiOperation({ summary: 'Historial de feedback para una denuncia' })
  findByDenuncia(@Param('denunciaId', ParseIntPipe) denunciaId: number) {
    return this.feedbackService.findByDenuncia(denunciaId);
  }
}
