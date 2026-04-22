import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

type TipoCaso = 'fuerte' | 'medio' | 'nulo';

interface RagDependencia {
  nombre: string;
}

interface RagResultadoInferencia {
  dependencias?: RagDependencia[];
  dependenciaPrincipal?: string;
  dependenciaSecundaria?: string;
}

interface EstadoInferenciaInput {
  ragResultado?: RagResultadoInferencia;
  dependenciaActual?: string;
  descripcionActual?: string;
}

interface DependenciaRecord {
  id: string;
  nombre: string;
  normalized?: string;
  keywords?: string[];
  metadata?: {
    jerarquiaDecision?: number;
    sector?: string;
    normativa?: {
      constitucional?: string[];
      legal?: string[];
      reglamentaria?: string[];
    };
  };
}

interface GuiaRegla {
  orden: number;
  condicion: string;
  dependencia?: string;
  dependencias?: string[];
}

interface NormativaEntry {
  id: string;
  tipo: 'ley' | 'competencia';
  entidad?: string;
  nombre: string;
  descripcion: string;
  aplicaPara: string[];
  keywords: string[];
  nivel: 'nacional' | 'territorial';
  prioridad: number;
}

interface DependenciaScore {
  nombre: string;
  score: number;
  jerarquia: number;
  sector?: string;
}

export interface ResultadoInferencia {
  tipoCaso: TipoCaso;
  confianza: number;
  dependenciaPrincipal: string;
  dependenciaSecundaria?: string;
  esCasoMixto: boolean;
  normativaAplicable: {
    principal: string;
    secundaria?: string;
    entradas: Array<{ id: string; tipo: string; nombre: string; descripcion: string }>;
  };
  requiereConfirmacion: boolean;
}

export type MotivoAdmisibilidad = 'valido' | 'incompleto' | 'ambiguo' | 'improcedente';

export interface CasoInferidoAdmisibilidad {
  inputUsuario: string;
  descripcion?: string;
  ubicacion?: string;
  direccion?: string;
  barrio?: string;
  comuna?: string;
  tipoCaso: TipoCaso;
  confianza: number;
  dependenciaPrincipal?: string;
  dependenciaSecundaria?: string;
}

export interface ResultadoAdmisibilidad {
  esAdmisible: boolean;
  motivo: MotivoAdmisibilidad;
  requiereMasInfo: boolean;
  mensajeUsuario: string;
  bloquearRadicacion: boolean;
}

const DEPS_VECTOR_PATH = join(process.cwd(), 'infrastructure', 'config', 'dependencias.vector.db.json');
const DEPS_PATH = join(process.cwd(), 'infrastructure', 'config', 'dependencias.json');
const NORMATIVA_PATH = join(process.cwd(), 'infrastructure', 'config', 'normativa.juridica.json');

@Injectable()
export class InferenciasService {
  private readonly logger = new Logger(InferenciasService.name);
  private dependenciasCache: DependenciaRecord[] | null = null;
  private reglasCache: GuiaRegla[] | null = null;
  private normativaCache: NormativaEntry[] | null = null;

  resolverCaso(inputUsuario: string, estadoConversacion: EstadoInferenciaInput = {}): ResultadoInferencia {
    const inputNorm = this.normalizar(inputUsuario);
    const baseDescripcion = this.normalizar(estadoConversacion.descripcionActual ?? '');
    const texto = [baseDescripcion, inputNorm].filter(Boolean).join(' ').trim();

    const dependencias = this.getDependencias();
    const scores = new Map<string, DependenciaScore>();

    this.acumularPorKeywords(texto, scores, dependencias);
    this.acumularPorReglas(texto, scores);
    this.acumularPorRag(estadoConversacion.ragResultado, scores);
    this.acumularPorDependenciaActual(estadoConversacion.dependenciaActual, scores);

    const ordenadas = Array.from(scores.values()).sort((a, b) => {
      const diff = b.score - a.score;
      if (Math.abs(diff) > 0.0001) return diff;
      if (a.jerarquia !== b.jerarquia) return a.jerarquia - b.jerarquia;
      return a.nombre.localeCompare(b.nombre);
    });

    const principal = ordenadas[0]?.nombre ?? 'Secretaría de Gobierno y Gestión del Gabinete';
    const secundaria = this.seleccionarSecundaria(ordenadas);
    const tipoCaso = this.calcularTipoCaso(ordenadas);
    const confianza = this.calcularConfianza(ordenadas, tipoCaso);
    const esCasoMixto = !!secundaria;
    const requiereConfirmacion = tipoCaso !== 'fuerte' || confianza < 0.75;

    return {
      tipoCaso,
      confianza,
      dependenciaPrincipal: principal,
      dependenciaSecundaria: secundaria,
      esCasoMixto,
      normativaAplicable: this.obtenerNormativaAplicable(principal, secundaria),
      requiereConfirmacion,
    };
  }

  evaluarAdmisibilidad(casoInferido: CasoInferidoAdmisibilidad): ResultadoAdmisibilidad {
    const descripcionBase = (casoInferido.descripcion?.trim() || casoInferido.inputUsuario?.trim() || '');
    const descripcionNorm = this.normalizar(descripcionBase);
    const ubicacionTexto = [
      casoInferido.ubicacion,
      casoInferido.direccion,
      casoInferido.barrio,
      casoInferido.comuna,
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0).join(' ');
    const ubicacionNorm = this.normalizar(ubicacionTexto);

    if (this.esSolicitudDesproporcionada(descripcionNorm)) {
      return this.decisionAdmisibilidad(
        casoInferido,
        'improcedente',
        false,
        true,
        'Este tipo de solicitud corresponde a procesos de planeación a gran escala y no puede gestionarse como denuncia ciudadana. Sin embargo, puedo orientarte sobre otros canales.',
      );
    }

    if (this.mencionaEntidadExterna(descripcionNorm)) {
      return this.decisionAdmisibilidad(
        casoInferido,
        'improcedente',
        false,
        true,
        'La situación reportada no corresponde a gestión distrital directa en este canal. Puedo orientarte para continuar por la ruta institucional adecuada.',
      );
    }

    const descripcionSuficiente = this.esDescripcionSuficiente(descripcionNorm);
    const ubicacionSuficiente = this.tieneUbicacionConcreta(casoInferido, ubicacionNorm);

    if (!descripcionSuficiente || !ubicacionSuficiente) {
      return this.decisionAdmisibilidad(
        casoInferido,
        'incompleto',
        true,
        false,
        '¿Podrías indicarme qué tipo de problema estás presentando y en qué lugar exacto ocurre?',
      );
    }

    if (!this.esDependenciaInstitucional(casoInferido.dependenciaPrincipal)) {
      return this.decisionAdmisibilidad(
        casoInferido,
        'improcedente',
        false,
        true,
        'La situación descrita no evidencia una competencia distrital clara para radicación en este canal.',
      );
    }

    const confianza = Number.isFinite(casoInferido.confianza) ? casoInferido.confianza : 0;

    if (casoInferido.tipoCaso === 'nulo') {
      const motivo: MotivoAdmisibilidad = this.esDescripcionAmbigua(descripcionNorm) ? 'ambiguo' : 'incompleto';
      const mensaje = motivo === 'ambiguo'
        ? '¿El problema es de infraestructura, seguridad, servicios públicos u otro tipo?'
        : '¿Podrías indicarme qué tipo de problema estás presentando y en qué lugar exacto ocurre?';

      return this.decisionAdmisibilidad(casoInferido, motivo, true, false, mensaje);
    }

    if (this.esDescripcionAmbigua(descripcionNorm) || confianza < 0.7) {
      return this.decisionAdmisibilidad(
        casoInferido,
        'ambiguo',
        true,
        false,
        '¿El problema es de infraestructura, seguridad, servicios públicos u otro tipo?',
      );
    }

    return this.decisionAdmisibilidad(casoInferido, 'valido', false, false, 'Continuemos con tu denuncia.');
  }

  obtenerNormativaAplicable(dependenciaPrincipal: string, dependenciaSecundaria?: string): {
    principal: string;
    secundaria?: string;
    entradas: Array<{ id: string; tipo: string; nombre: string; descripcion: string }>;
  } {
    const normativa = this.getNormativa();
    const entradas = new Map<string, { id: string; tipo: string; nombre: string; descripcion: string }>();

    const agregar = (entry?: NormativaEntry) => {
      if (!entry) return;
      entradas.set(entry.id, {
        id: entry.id,
        tipo: entry.tipo,
        nombre: entry.nombre,
        descripcion: entry.descripcion,
      });
    };

    const buscarPorDependencia = (dependencia: string) => {
      const depNorm = this.normalizar(dependencia);
      return normativa.find((n) => this.normalizar(n.entidad ?? '').includes(depNorm) || depNorm.includes(this.normalizar(n.entidad ?? '')));
    };

    agregar(buscarPorDependencia(dependenciaPrincipal));
    if (dependenciaSecundaria) {
      agregar(buscarPorDependencia(dependenciaSecundaria));
    }

    for (const baseId of ['ley-constitucion-1991', 'ley-1755-2015', 'ley-1437-2011']) {
      agregar(normativa.find((n) => n.id === baseId));
    }

    return {
      principal: dependenciaPrincipal,
      secundaria: dependenciaSecundaria,
      entradas: Array.from(entradas.values()),
    };
  }

  private acumularPorKeywords(texto: string, scores: Map<string, DependenciaScore>, dependencias: DependenciaRecord[]) {
    if (!texto) return;

    for (const dep of dependencias) {
      const keywords = Array.isArray(dep.keywords) ? dep.keywords : [];
      if (keywords.length === 0) continue;

      let sum = 0;
      for (const kw of keywords) {
        const kwNorm = this.normalizar(kw);
        if (!kwNorm) continue;
        if (texto.includes(kwNorm)) sum += 0.35;
      }

      if (sum > 0) {
        this.addScore(scores, dep.nombre, sum, dep.metadata?.jerarquiaDecision ?? 99, dep.metadata?.sector);
      }
    }
  }

  private acumularPorReglas(texto: string, scores: Map<string, DependenciaScore>) {
    if (!texto) return;

    for (const regla of this.getReglas()) {
      const terminos = this.extraerTerminosRegla(regla.condicion);
      const match = terminos.some((t) => texto.includes(t));
      if (!match) continue;

      const deps = regla.dependencia
        ? [regla.dependencia]
        : Array.isArray(regla.dependencias)
          ? regla.dependencias
          : [];

      for (const dep of deps) {
        const jerarquia = this.getJerarquia(dep);
        const sector = this.getSector(dep);
        this.addScore(scores, dep, 1.2, jerarquia, sector);
      }
    }
  }

  private acumularPorRag(rag: RagResultadoInferencia | undefined, scores: Map<string, DependenciaScore>) {
    if (!rag) return;

    const principal = rag.dependenciaPrincipal ?? rag.dependencias?.[0]?.nombre;
    if (principal) {
      this.addScore(scores, principal, 1.6, this.getJerarquia(principal), this.getSector(principal));
    }

    const secundaria = rag.dependenciaSecundaria ?? rag.dependencias?.[1]?.nombre;
    if (secundaria) {
      this.addScore(scores, secundaria, 1.2, this.getJerarquia(secundaria), this.getSector(secundaria));
    }

    for (const extra of rag.dependencias?.slice(2) ?? []) {
      this.addScore(scores, extra.nombre, 0.8, this.getJerarquia(extra.nombre), this.getSector(extra.nombre));
    }
  }

  private acumularPorDependenciaActual(dependenciaActual: string | undefined, scores: Map<string, DependenciaScore>) {
    if (!dependenciaActual?.trim()) return;
    const deps = dependenciaActual.split(/[,;]/).map((d) => d.trim()).filter(Boolean);
    if (deps.length === 0) return;

    this.addScore(scores, deps[0], 0.8, this.getJerarquia(deps[0]), this.getSector(deps[0]));
    if (deps[1]) {
      this.addScore(scores, deps[1], 0.55, this.getJerarquia(deps[1]), this.getSector(deps[1]));
    }
  }

  private seleccionarSecundaria(ordenadas: DependenciaScore[]): string | undefined {
    if (ordenadas.length < 2) return undefined;

    const principal = ordenadas[0];
    const candidata = ordenadas[1];
    const gap = principal.score - candidata.score;
    const ratio = candidata.score / Math.max(principal.score, 0.0001);
    const sectorDistinto = principal.sector && candidata.sector
      ? principal.sector !== candidata.sector
      : principal.nombre !== candidata.nombre;

    if (candidata.score >= 1.0 && gap <= 0.4 && ratio >= 0.72 && sectorDistinto) {
      return candidata.nombre;
    }

    return undefined;
  }

  private calcularTipoCaso(ordenadas: DependenciaScore[]): TipoCaso {
    const principal = ordenadas[0];
    if (!principal) return 'nulo';
    if (principal.score >= 1.5) return 'fuerte';
    if (principal.score >= 0.7) return 'medio';
    return 'nulo';
  }

  private calcularConfianza(ordenadas: DependenciaScore[], tipoCaso: TipoCaso): number {
    const principal = ordenadas[0];
    if (!principal) return 0;

    const secundaria = ordenadas[1]?.score ?? 0;
    const base = Math.min(principal.score / 2.2, 1);
    const separacion = Math.max((principal.score - secundaria) / Math.max(principal.score, 0.0001), 0);
    const ajusteTipo = tipoCaso === 'fuerte' ? 0.1 : tipoCaso === 'medio' ? 0 : -0.2;
    const confianza = Math.max(0, Math.min(1, base * 0.7 + separacion * 0.3 + ajusteTipo));

    return Number(confianza.toFixed(2));
  }

  private decisionAdmisibilidad(
    casoInferido: CasoInferidoAdmisibilidad,
    motivo: MotivoAdmisibilidad,
    requiereMasInfo: boolean,
    bloquearRadicacion: boolean,
    mensajeUsuario: string,
  ): ResultadoAdmisibilidad {
    const resultado: ResultadoAdmisibilidad = {
      esAdmisible: motivo === 'valido',
      motivo,
      requiereMasInfo,
      mensajeUsuario,
      bloquearRadicacion,
    };

    const decisionFinal = bloquearRadicacion
      ? 'bloquear_radicacion'
      : requiereMasInfo
        ? 'solicitar_mas_info'
        : 'continuar';

    this.logger.log(
      `[ADMISIBILIDAD] ${JSON.stringify({
        inputUsuario: casoInferido.inputUsuario,
        tipoCaso: casoInferido.tipoCaso,
        confianza: Number((casoInferido.confianza ?? 0).toFixed(2)),
        motivoAdmisibilidad: motivo,
        decisionFinal,
      })}`,
    );

    return resultado;
  }

  private esDescripcionSuficiente(descripcionNorm: string): boolean {
    if (!descripcionNorm) return false;
    const palabras = descripcionNorm.split(/\s+/).filter(Boolean);
    if (palabras.length < 5) return false;
    if (this.esDescripcionGenerica(descripcionNorm)) return false;
    return true;
  }

  private esDescripcionAmbigua(descripcionNorm: string): boolean {
    if (!descripcionNorm) return true;

    const vagos = [
      'situacion',
      'problema',
      'cosas malas',
      'todo esta mal',
      'algo raro',
      'inconveniente',
      'tema',
    ];
    const accionables = [
      'hueco', 'basura', 'ruido', 'semaforo', 'inundacion', 'deslizamiento',
      'arbol', 'luz', 'agua', 'gas', 'anden', 'transito', 'alcantarillado',
      'extorsion', 'amenaza', 'escombro', 'quebrada', 'fotomulta',
    ];

    const contieneVago = vagos.some((v) => descripcionNorm.includes(v));
    const contieneAccionable = accionables.some((a) => descripcionNorm.includes(a));

    return contieneVago && !contieneAccionable;
  }

  private esDescripcionGenerica(descripcionNorm: string): boolean {
    const genericas = [
      'hay un problema',
      'algo raro pasa',
      'situacion',
      'todo esta mal',
      'cosas malas',
    ];
    return genericas.some((g) => descripcionNorm === g || descripcionNorm.startsWith(`${g} `));
  }

  private tieneUbicacionConcreta(casoInferido: CasoInferidoAdmisibilidad, ubicacionNorm: string): boolean {
    if (casoInferido.barrio?.trim()) return true;
    if (casoInferido.comuna?.trim()) return true;

    const direccionNorm = this.normalizar(casoInferido.direccion ?? '');
    const tieneVia = /\b(calle|carrera|avenida|diagonal|transversal|autopista|circular|cl|cra|kr|tv)\b/.test(direccionNorm);
    const tieneNumero = /\d/.test(direccionNorm);
    if (tieneVia && tieneNumero) return true;

    if (!ubicacionNorm) return false;
    if (/\b(barrio|comuna|sector|vereda|corregimiento|frente a|cerca de)\b/.test(ubicacionNorm)) return true;
    if (/\d/.test(ubicacionNorm) && ubicacionNorm.split(/\s+/).length >= 2) return true;

    return false;
  }

  private esSolicitudDesproporcionada(textoNorm: string): boolean {
    if (!textoNorm) return false;
    const macro = [
      'construir metro',
      'construir metrocable',
      'nueva linea de metro',
      'obra estructural mayor',
      'macroobra',
      'megaproyecto',
      'politica publica macro',
      'plan maestro',
      'cambiar el plan de desarrollo',
    ];
    return macro.some((m) => textoNorm.includes(m));
  }

  private mencionaEntidadExterna(textoNorm: string): boolean {
    if (!textoNorm) return false;
    const entidadesExternas = [
      'fiscalia',
      'procuraduria',
      'defensoria',
      'juzgado',
      'rama judicial',
      'policia nacional',
      'ejercito',
    ];
    return entidadesExternas.some((e) => textoNorm.includes(e));
  }

  private esDependenciaInstitucional(dependenciaPrincipal?: string): boolean {
    if (!dependenciaPrincipal?.trim()) return false;
    return this.getDependencias().some(
      (d) => this.normalizar(d.nombre) === this.normalizar(dependenciaPrincipal),
    );
  }

  private addScore(
    scores: Map<string, DependenciaScore>,
    nombre: string,
    delta: number,
    jerarquia: number,
    sector?: string,
  ) {
    const actual = scores.get(nombre);
    if (!actual) {
      scores.set(nombre, { nombre, score: delta, jerarquia, sector });
      return;
    }

    actual.score += delta;
    if (jerarquia < actual.jerarquia) actual.jerarquia = jerarquia;
    if (!actual.sector && sector) actual.sector = sector;
  }

  private extraerTerminosRegla(condicion: string): string[] {
    const norm = this.normalizar(condicion);
    if (!norm) return [];

    return norm
      .split(/[;,]/)
      .map((s) => s.trim())
      .flatMap((s) => s.split(/\s+/))
      .filter((s) => s.length >= 4);
  }

  private getDependencias(): DependenciaRecord[] {
    if (this.dependenciasCache) return this.dependenciasCache;

    try {
      const raw = readFileSync(DEPS_VECTOR_PATH, 'utf8');
      const parsed = JSON.parse(raw) as { records?: DependenciaRecord[] };
      this.dependenciasCache = Array.isArray(parsed.records) ? parsed.records : [];
    } catch (err) {
      this.logger.warn(`No se pudo cargar dependencias vectoriales: ${(err as Error).message}`);
      this.dependenciasCache = [];
    }

    return this.dependenciasCache;
  }

  private getReglas(): GuiaRegla[] {
    if (this.reglasCache) return this.reglasCache;

    try {
      const raw = readFileSync(DEPS_PATH, 'utf8');
      const parsed = JSON.parse(raw) as { _guiaFiltrado?: { reglas?: GuiaRegla[] } };
      this.reglasCache = Array.isArray(parsed._guiaFiltrado?.reglas) ? parsed._guiaFiltrado?.reglas ?? [] : [];
    } catch (err) {
      this.logger.warn(`No se pudo cargar reglas de guia filtrado: ${(err as Error).message}`);
      this.reglasCache = [];
    }

    return this.reglasCache;
  }

  private getNormativa(): NormativaEntry[] {
    if (this.normativaCache) return this.normativaCache;

    try {
      const raw = readFileSync(NORMATIVA_PATH, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.normativaCache = Array.isArray(parsed) ? (parsed as NormativaEntry[]) : [];
    } catch (err) {
      this.logger.warn(`No se pudo cargar normativa juridica: ${(err as Error).message}`);
      this.normativaCache = [];
    }

    return this.normativaCache;
  }

  private getJerarquia(nombre: string): number {
    const dep = this.getDependencias().find((d) => d.nombre === nombre || d.id === nombre);
    return dep?.metadata?.jerarquiaDecision ?? 99;
  }

  private getSector(nombre: string): string | undefined {
    const dep = this.getDependencias().find((d) => d.nombre === nombre || d.id === nombre);
    return dep?.metadata?.sector;
  }

  private normalizar(texto: string): string {
    return texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
