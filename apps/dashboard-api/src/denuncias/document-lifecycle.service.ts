import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { GcsStorageService } from '@app/storage';
import { Denuncia, DenunciaEstado } from './entities/denuncia.entity';

const DIAS_RETENCION = 5;

@Injectable()
export class DocumentLifecycleService {
  private readonly logger = new Logger(DocumentLifecycleService.name);
  private readonly bucketDocumentos: string;

  constructor(
    @InjectRepository(Denuncia)
    private readonly repo: Repository<Denuncia>,
    private readonly storage: GcsStorageService,
    private readonly config: ConfigService,
  ) {
    this.bucketDocumentos = this.config.get<string>('GCS_BUCKET_DOCUMENTOS', 'denunciasat-documentos');
  }

  /** Se ejecuta todos los días a las 3:00 AM */
  @Cron('0 3 * * *')
  async limpiarDocumentosVencidos(): Promise<void> {
    this.logger.log('Iniciando limpieza de documentos vencidos en GCS...');

    const corte = new Date();
    corte.setDate(corte.getDate() - DIAS_RETENCION);

    const denuncias = await this.repo.find({
      where: {
        estado: DenunciaEstado.CON_RESPUESTA,
        documentoGeneradoOk: true,
        documentoGeneradoEn: LessThan(corte),
      },
      select: ['id', 'radicado', 'documentoUrl'],
    });

    if (denuncias.length === 0) {
      this.logger.log('No hay documentos vencidos para limpiar.');
      return;
    }

    this.logger.log(`Limpiando ${denuncias.length} documentos con más de ${DIAS_RETENCION} días en CON_RESPUESTA...`);

    let eliminados = 0;
    for (const d of denuncias) {
      const objectName = d.documentoUrl ?? `${d.radicado}.docx`;
      try {
        const existe = await this.storage.objectExists(this.bucketDocumentos, objectName);
        if (existe) {
          await this.storage.deleteObject(this.bucketDocumentos, objectName);
          // Marcar como eliminado en DB (documentoUrl = null)
          await this.repo.update(d.id, { documentoUrl: null, documentoGeneradoOk: false });
          eliminados++;
          this.logger.debug(`Eliminado: ${this.bucketDocumentos}/${objectName}`);
        }
      } catch (err) {
        this.logger.error(`Error eliminando documento de denuncia #${d.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Limpieza completada: ${eliminados}/${denuncias.length} documentos eliminados.`);
  }
}
