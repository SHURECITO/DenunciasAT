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
    const esCasoMixto = !!secundaria;
    const requiereConfirmacion = tipoCaso !== 'fuerte' || (ordenadas[0]?.score ?? 0) < 1.25;

    return {
      tipoCaso,
      dependenciaPrincipal: principal,
      dependenciaSecundaria: secundaria,
      esCasoMixto,
      normativaAplicable: this.obtenerNormativaAplicable(principal, secundaria),
      requiereConfirmacion,
    };
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
