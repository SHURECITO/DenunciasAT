import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Denuncia } from '../../denuncias/entities/denuncia.entity';
import { Usuario } from '../../usuarios/entities/usuario.entity';

@Entity('feedback_denuncias')
export class FeedbackDenuncia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  denunciaId: number;

  @ManyToOne(() => Denuncia, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'denunciaId' })
  denuncia: Denuncia;

  @Column()
  usuarioId: number;

  @ManyToOne(() => Usuario)
  @JoinColumn({ name: 'usuarioId' })
  usuario: Usuario;

  @Column()
  dependenciaOriginal: string;

  @Column({ nullable: true })
  dependenciaCorregida: string;

  @Column()
  dependenciaCorrecta: boolean;

  @Column({ type: 'int' })
  calidadHechos: number;

  @Column({ nullable: true, type: 'text' })
  comentarioHechos: string;

  @Column()
  asuntoCorrect: boolean;

  @Column({ nullable: true, type: 'text' })
  asuntoCorregido: string;

  @Column({ nullable: true, type: 'text' })
  feedbackLibre: string;

  @Column({ type: 'float', default: 1.0 })
  pesoConfianza: number;

  @Column({ default: false })
  procesado: boolean;

  @CreateDateColumn()
  fechaCreacion: Date;
}
