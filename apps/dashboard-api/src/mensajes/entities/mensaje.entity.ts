import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Denuncia } from '../../denuncias/entities/denuncia.entity';

export enum TipoMensaje {
  TEXTO = 'TEXTO',
  AUDIO_TRANSCRITO = 'AUDIO_TRANSCRITO',
  IMAGEN = 'IMAGEN',
  PDF = 'PDF',
}

export enum DireccionMensaje {
  ENTRANTE = 'ENTRANTE',
  SALIENTE = 'SALIENTE',
}

@Entity('mensajes')
export class Mensaje {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  denunciaId: number;

  @ManyToOne(() => Denuncia, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'denunciaId' })
  denuncia: Denuncia;

  @Column('text')
  contenido: string;

  @Column({ type: 'enum', enum: TipoMensaje, default: TipoMensaje.TEXTO })
  tipo: TipoMensaje;

  @Column({ type: 'enum', enum: DireccionMensaje })
  direccion: DireccionMensaje;

  @CreateDateColumn()
  timestamp: Date;
}
