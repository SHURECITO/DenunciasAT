import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { BuscarDto } from './dto/buscar.dto';
import { ClasificarDto } from './dto/clasificar.dto';
import { RagService } from './rag.service';

@Controller()
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Get('health')
  health() {
    return this.ragService.health();
  }

  @Get('dependencias')
  dependencias() {
    return this.ragService.listarDependencias();
  }

  @Post('buscar')
  @HttpCode(200)
  buscar(@Body() dto: BuscarDto) {
    return this.ragService.buscar(dto.descripcion, dto.top_k ?? 3);
  }

  @Post('clasificar')
  @HttpCode(200)
  clasificar(@Body() dto: ClasificarDto) {
    return this.ragService.clasificar(dto.descripcion, dto.ubicacion);
  }

  @Post('reindexar')
  @HttpCode(200)
  reindexar(@Headers('x-internal-key') internalKey?: string) {
    if (!this.ragService.validarInternalKey(internalKey)) {
      throw new UnauthorizedException('x-internal-key inválida');
    }

    return this.ragService.reindexarForzado();
  }
}
