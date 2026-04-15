import {
  Column,
  CreateDateColumn,
  Entity,
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

  @Column({
    type: 'enum',
    enum: DenunciaEstado,
    default: DenunciaEstado.RECIBIDA,
  })
  estado: DenunciaEstado;

  @Column({ nullable: true })
  dependenciaAsignada: string;

  @Column({ default: false })
  esEspecial: boolean;

  @Column({ default: false })
  origenManual: boolean;

  @Column({ default: false })
  documentoRevisado: boolean;

  @CreateDateColumn()
  fechaCreacion: Date;

  @UpdateDateColumn()
  fechaActualizacion: Date;
}
