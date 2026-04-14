import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { Denuncia, DenunciaEstado } from './entities/denuncia.entity';

const ESTADOS_ORDEN: DenunciaEstado[] = [
  DenunciaEstado.RECIBIDA,
  DenunciaEstado.EN_GESTION,
  DenunciaEstado.RADICADA,
  DenunciaEstado.CON_RESPUESTA,
];

@Injectable()
export class DenunciasService {
  constructor(
    @InjectRepository(Denuncia)
    private readonly denunciasRepo: Repository<Denuncia>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateDenunciaDto): Promise<Denuncia> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await queryRunner.query(
        `SELECT nextval('radicado_seq') AS seq`,
      );
      const seq: number = result[0].seq;
      const radicado = `DAT-${String(seq).padStart(6, '0')}`;

      const denuncia = queryRunner.manager.create(Denuncia, {
        ...dto,
        radicado,
        estado: DenunciaEstado.RECIBIDA,
      });
      const saved = await queryRunner.manager.save(denuncia);
      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  findAll(estado?: DenunciaEstado): Promise<Denuncia[]> {
    const where = estado ? { estado } : {};
    return this.denunciasRepo.find({
      where,
      order: { fechaCreacion: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Denuncia> {
    const denuncia = await this.denunciasRepo.findOne({ where: { id } });
    if (!denuncia) throw new NotFoundException(`Denuncia #${id} no encontrada`);
    return denuncia;
  }

  async updateEstado(id: number, dto: UpdateEstadoDto): Promise<Denuncia> {
    const denuncia = await this.findOne(id);

    const idxActual = ESTADOS_ORDEN.indexOf(denuncia.estado);
    const idxNuevo = ESTADOS_ORDEN.indexOf(dto.estado);

    if (idxNuevo <= idxActual) {
      throw new BadRequestException(
        `No se puede retroceder de "${denuncia.estado}" a "${dto.estado}"`,
      );
    }

    denuncia.estado = dto.estado;
    return this.denunciasRepo.save(denuncia);
  }
}
