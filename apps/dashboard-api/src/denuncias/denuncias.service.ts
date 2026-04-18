import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateDenunciaDto } from './dto/create-denuncia.dto';
import { CreateIncompletaDto } from './dto/create-incompleta.dto';
import { CreateParcialDto } from './dto/create-parcial.dto';
import { UpdateDenunciaDto } from './dto/update-denuncia.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { EditarDenunciaDto } from './dto/editar-denuncia.dto';
import { Denuncia, DenunciaEstado } from './entities/denuncia.entity';

const capitalizar = (str: string): string =>
  str.toLowerCase().split(' ').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

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

  private async createWithRunner(
    dto: CreateDenunciaDto,
    extra: Partial<Denuncia> = {},
  ): Promise<Denuncia> {
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
        documentoPendiente: false,
        incompleta: false,
        ...dto,
        nombreCiudadano: capitalizar(dto.nombreCiudadano ?? ''),
        cedula: dto.cedula ?? '',   // cedula es NOT NULL — '' para anónimos/parciales
        ...extra,
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

  create(dto: CreateDenunciaDto): Promise<Denuncia> {
    return this.createWithRunner(dto);
  }

  createManual(dto: CreateDenunciaDto): Promise<Denuncia> {
    return this.createWithRunner(dto, { origenManual: true });
  }

  createIncompleta(dto: CreateIncompletaDto): Promise<Denuncia> {
    // Campos obligatorios en DB usan string vacío como placeholder para registros incompletos
    return this.createWithRunner(
      {
        nombreCiudadano: dto.nombreCiudadano,
        cedula: dto.cedula ?? '',
        telefono: dto.telefono,
        ubicacion: dto.ubicacion ?? '',
        descripcion: dto.descripcion ?? '',
      } as CreateDenunciaDto,
      { incompleta: true },
    );
  }

  async upsertParcial(dto: CreateParcialDto): Promise<Denuncia> {
    // Buscar denuncia incompleta existente del mismo número para actualizar en lugar de duplicar
    const existente = await this.denunciasRepo.findOne({
      where: { telefono: dto.telefono, incompleta: true },
    });

    if (existente) {
      if (dto.nombreCiudadano) existente.nombreCiudadano = dto.nombreCiudadano;
      if (dto.cedula) existente.cedula = dto.cedula;
      if (dto.barrio) existente.barrio = dto.barrio;
      if (dto.comuna) existente.comuna = dto.comuna;
      if (dto.direccion) existente.ubicacion = dto.direccion;
      if (dto.descripcion) existente.descripcion = dto.descripcion;
      return this.denunciasRepo.save(existente);
    }

    return this.createWithRunner(
      {
        nombreCiudadano: dto.nombreCiudadano,
        cedula: dto.cedula ?? '',
        telefono: dto.telefono,
        ubicacion: dto.direccion ?? '',
        barrio: dto.barrio,
        comuna: dto.comuna,
        descripcion: dto.descripcion ?? '',
      } as CreateDenunciaDto,
      { incompleta: true },
    );
  }

  findAll(estado?: DenunciaEstado): Promise<Denuncia[]> {
    const where = estado ? { estado } : {};
    return this.denunciasRepo.find({
      where,
      // incompletas al final (false=0 < true=1 en ASC)
      order: { incompleta: 'ASC', fechaCreacion: 'DESC' },
    });
  }

  findEspeciales(): Promise<Denuncia[]> {
    return this.denunciasRepo.find({
      where: { esEspecial: true },
      order: { fechaCreacion: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Denuncia> {
    const denuncia = await this.denunciasRepo.findOne({ where: { id } });
    if (!denuncia) throw new NotFoundException(`Denuncia #${id} no encontrada`);
    return denuncia;
  }

  async update(id: number, dto: UpdateDenunciaDto): Promise<Denuncia> {
    const denuncia = await this.findOne(id);
    Object.assign(denuncia, dto);
    return this.denunciasRepo.save(denuncia);
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

    if (
      dto.estado === DenunciaEstado.RADICADA &&
      !denuncia.documentoRevisado
    ) {
      throw new BadRequestException(
        'El documento debe estar revisado antes de radicar la denuncia',
      );
    }

    denuncia.estado = dto.estado;
    return this.denunciasRepo.save(denuncia);
  }

  async marcarDocumentoPendiente(id: number): Promise<Denuncia> {
    const denuncia = await this.findOne(id);
    denuncia.documentoPendiente = true;
    denuncia.documentoGeneradoOk = false;
    return this.denunciasRepo.save(denuncia);
  }

  async findDatosUsuarioPorTelefono(telefono: string): Promise<{ nombreCiudadano: string; cedula: string; esAnonimo: boolean } | null> {
    const d = await this.denunciasRepo.findOne({
      where: { telefono, incompleta: false },
      order: { fechaCreacion: 'DESC' },
      select: ['nombreCiudadano', 'cedula', 'esAnonimo'],
    });
    if (!d) return null;
    return { nombreCiudadano: d.nombreCiudadano, cedula: d.cedula, esAnonimo: d.esAnonimo };
  }

  /**
   * Busca una denuncia parcial (incompleta:true) por teléfono.
   * Devuelve null si no existe (no lanza 404). Usado por el chatbot para
   * decidir si crear una nueva denuncia o completar la parcial existente.
   */
  async findParcialPorTelefono(telefono: string): Promise<Denuncia | null> {
    return this.denunciasRepo.findOne({
      where: { telefono, incompleta: true },
      order: { fechaCreacion: 'DESC' },
    });
  }

  async getDependencias(): Promise<any[]> {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(process.cwd(), 'infrastructure', 'config', 'dependencias.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    
    const result = [];
    for (const [key, val] of Object.entries(data)) {
      if (key.startsWith('_')) continue;
      const typedVal: any = val;
      result.push({
        nombre: key,
        cargoTitular: typedVal.cargoTitular,
        nivel: typedVal.nivel,
        tipo: typedVal.tipo,
      });
    }
    return result;
  }

  async editarDenuncia(id: number, dto: EditarDenunciaDto, usuario: any): Promise<Denuncia> {
    const denuncia = await this.findOne(id);
    
    const cambios: any = {};
    if (dto.dependenciasAsignadas) {
      cambios.dependenciaAsignada = {
        anterior: denuncia.dependenciaAsignada,
        nuevo: dto.dependenciasAsignadas.join(', ')
      };
      denuncia.dependenciaAsignada = dto.dependenciasAsignadas.join(', ');
      
      const depsNuevas = dto.dependenciasAsignadas;
      const respuestasAntiguas = denuncia.respuestasPorDependencia || [];
      const nuevasRespuestas = depsNuevas.map(dep => {
        const existente = respuestasAntiguas.find(r => r.dependencia === dep);
        return existente || {
          dependencia: dep,
          respondio: false,
          fechaRespuesta: null,
          observacion: null
        };
      });
      denuncia.respuestasPorDependencia = nuevasRespuestas;
    }
    
    if (dto.descripcion !== undefined) {
      cambios.descripcion = { anterior: denuncia.descripcion, nuevo: dto.descripcion };
      denuncia.descripcion = dto.descripcion;
    }
    if (dto.ubicacion !== undefined) {
      cambios.ubicacion = { anterior: denuncia.ubicacion, nuevo: dto.ubicacion };
      denuncia.ubicacion = dto.ubicacion;
    }
    if (dto.barrio !== undefined) {
      cambios.barrio = { anterior: denuncia.barrio, nuevo: dto.barrio };
      denuncia.barrio = dto.barrio;
    }
    if (dto.comuna !== undefined) {
      cambios.comuna = { anterior: denuncia.comuna, nuevo: dto.comuna };
      denuncia.comuna = dto.comuna;
    }
    if (dto.solicitudAdicional !== undefined) {
      cambios.solicitudAdicional = { anterior: denuncia.solicitudAdicional, nuevo: dto.solicitudAdicional };
      denuncia.solicitudAdicional = dto.solicitudAdicional;
    }
    
    const historial = denuncia.historialCambios || [];
    historial.push({
      usuario: usuario?.email || usuario?.nombre || 'Usuario',
      timestamp: new Date().toISOString(),
      cambios
    });
    denuncia.historialCambios = historial;
    
    if (dto.regenerarDocumento) {
      denuncia.documentoGeneradoOk = false;
      denuncia.documentoPendiente = true;
    }
    
    return this.denunciasRepo.save(denuncia);
  }
}
