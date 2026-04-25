import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FeedbackDenuncia } from './entities/feedback-denuncia.entity';
import { Denuncia } from '../denuncias/entities/denuncia.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(FeedbackDenuncia)
    private readonly feedbackRepo: Repository<FeedbackDenuncia>,
    @InjectRepository(Denuncia)
    private readonly denunciaRepo: Repository<Denuncia>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateFeedbackDto, usuarioId: number): Promise<{ feedback: FeedbackDenuncia; denuncia: Denuncia }> {
    const denuncia = await this.denunciaRepo.findOne({ where: { id: dto.denunciaId } });
    if (!denuncia) {
      throw new NotFoundException(`Denuncia ${dto.denunciaId} no encontrada`);
    }

    if (dto.calidadHechos < 1 || dto.calidadHechos > 5) {
      throw new BadRequestException('calidadHechos debe estar entre 1 y 5');
    }

    return this.dataSource.transaction(async (manager) => {
      const feedback = manager.create(FeedbackDenuncia, {
        denunciaId: dto.denunciaId,
        usuarioId,
        dependenciaOriginal: dto.dependenciaOriginal,
        dependenciaCorregida: dto.dependenciaCorregida ?? null,
        dependenciaCorrecta: dto.dependenciaCorrecta,
        calidadHechos: dto.calidadHechos,
        comentarioHechos: dto.comentarioHechos ?? null,
        asuntoCorrect: dto.asuntoCorrect,
        asuntoCorregido: dto.asuntoCorregido ?? null,
        feedbackLibre: dto.feedbackLibre ?? null,
      });

      const savedFeedback = await manager.save(FeedbackDenuncia, feedback);

      await manager.update(Denuncia, dto.denunciaId, { documentoRevisado: true });
      const updatedDenuncia = await manager.findOne(Denuncia, { where: { id: dto.denunciaId } });

      return { feedback: savedFeedback, denuncia: updatedDenuncia! };
    });
  }

  async findByDenuncia(denunciaId: number): Promise<FeedbackDenuncia[]> {
    return this.feedbackRepo.find({
      where: { denunciaId },
      relations: ['usuario'],
      order: { fechaCreacion: 'DESC' },
    });
  }

  async getStats(): Promise<{
    totalFeedbacks: number;
    porcentajeDependenciaCorrecta: number;
    promedioCalidadHechos: number;
    porcentajeAsuntoCorrect: number;
    dependenciasConMasCorrecciones: { dependencia: string; total: number }[];
  }> {
    const total = await this.feedbackRepo.count();

    if (total === 0) {
      return {
        totalFeedbacks: 0,
        porcentajeDependenciaCorrecta: 0,
        promedioCalidadHechos: 0,
        porcentajeAsuntoCorrect: 0,
        dependenciasConMasCorrecciones: [],
      };
    }

    const [correctas, sumaCalidad, asuntosCorrectos] = await Promise.all([
      this.feedbackRepo.count({ where: { dependenciaCorrecta: true } }),
      this.feedbackRepo
        .createQueryBuilder('f')
        .select('AVG(f.calidadHechos)', 'avg')
        .getRawOne<{ avg: string }>(),
      this.feedbackRepo.count({ where: { asuntoCorrect: true } }),
    ]);

    const correccionesRaw: { dependencia: string; total: string }[] =
      await this.feedbackRepo
        .createQueryBuilder('f')
        .select('f.dependenciaOriginal', 'dependencia')
        .addSelect('COUNT(*)', 'total')
        .where('f.dependenciaCorrecta = false')
        .groupBy('f.dependenciaOriginal')
        .orderBy('total', 'DESC')
        .limit(5)
        .getRawMany();

    return {
      totalFeedbacks: total,
      porcentajeDependenciaCorrecta:
        Math.round((correctas / total) * 1000) / 10,
      promedioCalidadHechos:
        Math.round(parseFloat(sumaCalidad?.avg ?? '0') * 10) / 10,
      porcentajeAsuntoCorrect:
        Math.round((asuntosCorrectos / total) * 1000) / 10,
      dependenciasConMasCorrecciones: correccionesRaw.map((r) => ({
        dependencia: r.dependencia,
        total: parseInt(r.total, 10),
      })),
    };
  }
}
