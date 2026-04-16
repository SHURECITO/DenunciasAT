import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DenunciaEstado {
  RECIBIDA = 'RECIBIDA',
  EN_GESTION = 'EN_GESTION',
  RADICADA = 'RADICADA',
  CON_RESPUESTA = 'CON_RESPUESTA',
}

@Entity('denuncias')
export class Denuncia {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  radicado: string;

  @Column()
  nombreCiudadano: string;

  @Column()
  cedula: string;

  @Column()
  telefono: string;

  @Column()
  ubicacion: string;

  @Column('text')
  descripcion: string;

  @Index()
  @Column({
    type: 'enum',
    enum: DenunciaEstado,
    default: DenunciaEstado.RECIBIDA,
  })
  estado: DenunciaEstado;

  @Index()
  @Column({ nullable: true })
  dependenciaAsignada: string;

  @Column({ default: false })
  esEspecial: boolean;

  @Column({ default: false })
  origenManual: boolean;

  @Column({ default: false })
  documentoRevisado: boolean;

  // Campos para trazabilidad del documento generado por document-service
  @Column({ nullable: true })
  documentoUrl: string;

  @Column({ default: false })
  documentoGeneradoOk: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  documentoGeneradoEn: Date;

  // true mientras document-service aún no ha generado el .docx (pendiente Entrega 4)
  @Column({ default: false })
  documentoPendiente: boolean;

  // Denuncia incompleta guardada desde el chatbot antes de que el ciudadano terminara el flujo
  @Column({ default: false })
  incompleta: boolean;

  @CreateDateColumn()
  fechaCreacion: Date;

  @UpdateDateColumn()
  fechaActualizacion: Date;
}
