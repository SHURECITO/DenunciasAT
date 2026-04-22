import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

interface DependenciaConfig {
  cargoTitular?: string;
  entidadCompleta?: string;
  areasTematicas?: string[];
  jerarquiaDecision?: number;
  [key: string]: unknown;
}

interface GuiaFiltradoRegla {
  orden: number;
  condicion: string;
  dependencia?: string;
  dependencias?: string[];
}

interface GuiaFiltradoConfig {
  reglas?: GuiaFiltradoRegla[];
}

type FuerzaMatchRegla = 'fuerte' | 'media' | 'nula';

interface EvaluacionRegla {
  fuerza: FuerzaMatchRegla;
  regla?: GuiaFiltradoRegla;
  dependencias: string[];
}

interface CandidatoBusqueda {
  nombre: string;
  similitud: number;
  metadata: Record<string, unknown>;
  actualizadoEn: Date;
}

interface DependenciaSeleccionable {
  clasificada: ClasificacionDependencia;
  score: number;
  jerarquia: number;
  metadata?: Record<string, unknown>;
}

interface DependenciaVectorRow {
  nombre: string;
  metadata: Record<string, unknown>;
  similitud: string | number;
  actualizado_en: Date;
}

interface DependenciaLexicaRow {
  nombre: string;
  contenido: string;
  metadata: Record<string, unknown>;
  actualizado_en: Date;
}

interface DependenciaIndexada {
  nombre: string;
  contenido: string;
  metadata: Record<string, unknown>;
}

export interface ResultadoReindexado {
  regenerado: boolean;
  hash: string;
  indexadas: number;
}

interface ClasificacionDependencia {
  nombre: string;
  justificacion: string;
  solicitudEspecifica: string;
}

export interface ClasificacionResultado {
  esEspecial: boolean;
  dependencias: ClasificacionDependencia[];
  dependenciaPrincipal?: string;
  dependenciaSecundaria?: string;
  asunto: string;
}

const VECTOR_DIMENSIONS = 768;
const DEFAULT_TOP_K = 3;
const DEPS_PATH = join(process.cwd(), 'infrastructure', 'config', 'dependencias.json');
const RAG_GEMINI_UNAVAILABLE_CODE = 'RAG_GEMINI_UNAVAILABLE';
const SECONDARY_MIN_SCORE = 0.3;
const SECONDARY_MAX_GAP = 0.12;
const SECONDARY_MIN_RATIO = 0.78;
const STOPWORDS_REGLAS = new Set([
  'de', 'la', 'el', 'los', 'las', 'y', 'o', 'en', 'con', 'sin', 'por', 'para', 'sobre', 'del', 'al',
  'una', 'uno', 'un', 'que', 'se', 'su', 'sus', 'a', 'u', 'e', 'es', 'son', 'como', 'ante',
]);

const HINTS_REGLA_POR_ORDEN: Record<number, { fuerte: string[]; media: string[] }> = {
  1: {
    fuerte: ['robo', 'hurto', 'extorsion', 'amenaza', 'combo', 'sicariato', 'balacera', 'grupo armado'],
    media: ['inseguridad', 'orden publico', 'situacion de seguridad'],
  },
  2: {
    fuerte: ['funcionario corrupto', 'maltrato de funcionario', 'tramite negado sin razon'],
    media: ['problema con tramite', 'queja de servidor publico', 'mala atencion'],
  },
  3: {
    fuerte: ['luz danada', 'sin luz', 'agua sucia', 'sin agua', 'fuga de agua', 'alcantarillado', 'gas'],
    media: ['problema de servicios publicos', 'servicios publicos'],
  },
  4: {
    fuerte: ['basura acumulada', 'basura', 'escombro', 'residuos acumulados', 'recoleccion de basura'],
    media: ['problema de aseo', 'residuos en la calle'],
  },
  5: {
    fuerte: ['hueco', 'huecos', 'via deteriorada', 'calle danada', 'anden roto', 'puente danado'],
    media: ['problema en la calle', 'dano en la via', 'obra publica'],
  },
  6: {
    fuerte: ['construccion ilegal', 'invasion de espacio publico', 'sin licencia de construccion'],
    media: ['problema urbanistico', 'ocupacion de espacio publico'],
  },
  8: {
    fuerte: ['semaforo danado', 'semaforo', 'transito', 'fotomulta', 'pico y placa', 'transporte publico'],
    media: ['problema de movilidad', 'problema de transporte'],
  },
  9: {
    fuerte: ['ruido fuerte', 'ruido', 'contaminacion', 'arbol caido', 'quebrada contaminada'],
    media: ['problema ambiental', 'mal olor ambiental'],
  },
  10: {
    fuerte: ['eps no atiende', 'ips no atiende', 'hospital colapsado', 'urgencias saturadas'],
    media: ['problema de salud', 'atencion medica'],
  },
  11: {
    fuerte: ['colegio sin profesor', 'pae', 'infraestructura educativa', 'salon en mal estado'],
    media: ['problema en colegio', 'problema educativo'],
  },
  12: {
    fuerte: ['cancha danada', 'polideportivo', 'gimnasio al aire libre', 'escenario deportivo'],
    media: ['problema de deporte', 'recreacion'],
  },
  13: {
    fuerte: ['subsidio de vivienda', 'mejoramiento de vivienda', 'reasentamiento'],
    media: ['problema de vivienda'],
  },
  14: {
    fuerte: ['violencia de genero', 'violencia contra la mujer', 'agresion a mujer'],
    media: ['riesgo para mujer'],
  },
  15: {
    fuerte: ['deslizamiento', 'inundacion', 'emergencia', 'desastre natural'],
    media: ['riesgo de desastre', 'situacion de emergencia'],
  },
};

@Injectable()
export class RagService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagService.name);
  private readonly pool: Pool;
  private readonly internalKey: string;
  private readonly guiaFiltradoReglas: GuiaFiltradoRegla[];
  private readonly jerarquiaPorDependencia: Map<string, number>;
  private readonly areasPorDependencia: Map<string, string[]>;

  private readonly embeddingModel: GenerativeModel | null;
  private readonly clasificacionModel: GenerativeModel | null;
  private embeddingGeminiDisponible = true;
  private clasificacionGeminiDisponible = true;

  constructor(private readonly config: ConfigService) {
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('FATAL: DATABASE_URL no configurada en rag-service');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    });

    this.internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();

    const guia = this.cargarGuiaFiltradoYJerarquia();
    this.guiaFiltradoReglas = guia.reglas;
    this.jerarquiaPorDependencia = guia.jerarquiaPorDependencia;
    this.areasPorDependencia = guia.areasPorDependencia;

    const geminiApiKey = this.config.get<string>('GEMINI_API_KEY', '').trim();
    if (!geminiApiKey) {
      this.logger.warn('GEMINI_API_KEY no configurada. Se deshabilita indexación y clasificación semántica.');
      this.embeddingModel = null;
      this.clasificacionModel = null;
      this.embeddingGeminiDisponible = false;
      this.clasificacionGeminiDisponible = false;
      return;
    }

    const gemini = new GoogleGenerativeAI(geminiApiKey);
    this.embeddingModel = gemini.getGenerativeModel({ model: 'text-embedding-004' });
    this.clasificacionModel = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  async onModuleInit() {
    try {
      await this.ensureSchema();

      if (!this.embeddingModel || !this.embeddingGeminiDisponible) {
        this.logger.warn('RAG inicializado sin Gemini disponible. Clasificación semántica temporalmente deshabilitada.');
        return;
      }

      await this.indexarSiCambio();
    } catch (err) {
      this.logger.error(
        `Error inicializando rag-service. Continúa en modo degradado: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  validarInternalKey(headerValue?: string): boolean {
    return !!this.internalKey && headerValue?.trim() === this.internalKey;
  }

  private throwGeminiUnavailable(): never {
    throw new ServiceUnavailableException({
      code: RAG_GEMINI_UNAVAILABLE_CODE,
      message: 'Servicio de IA temporalmente no disponible',
    });
  }

  private assertEmbeddingDisponible() {
    if (!this.embeddingModel || !this.embeddingGeminiDisponible) {
      this.throwGeminiUnavailable();
    }
  }

  private assertClasificacionDisponible() {
    if (!this.clasificacionModel || !this.clasificacionGeminiDisponible) {
      this.throwGeminiUnavailable();
    }
  }

  async health() {
    const [{ ok }] = (await this.pool.query<{ ok: number }>('SELECT 1 AS ok')).rows;
    const iaDisponible =
      !!this.embeddingModel &&
      !!this.clasificacionModel &&
      this.embeddingGeminiDisponible &&
      this.clasificacionGeminiDisponible;

    return {
      status: ok === 1 && iaDisponible ? 'ok' : 'degraded',
      service: 'rag-service',
      iaDisponible,
    };
  }

  async listarDependencias() {
    const rows = await this.pool.query<{
      nombre: string;
      metadata: Record<string, unknown>;
      actualizado_en: Date;
    }>(
      `SELECT nombre, metadata, actualizado_en
       FROM dependencias_vectores
       ORDER BY nombre ASC`,
    );

    return rows.rows.map((row) => ({
      nombre: row.nombre,
      metadata: row.metadata,
      actualizadoEn: row.actualizado_en,
    }));
  }

  async buscar(descripcion: string, topK = DEFAULT_TOP_K) {
    const limit = Number.isFinite(topK) ? Math.max(1, Math.min(10, topK)) : DEFAULT_TOP_K;

    this.assertEmbeddingDisponible();
    const embedding = await this.generarEmbeddingSeguro(descripcion);
    const vector = this.toVectorLiteral(embedding);

    const rows = await this.pool.query<DependenciaVectorRow>(
      `SELECT nombre, metadata, actualizado_en,
              1 - (embedding <=> $1::vector) AS similitud
       FROM dependencias_vectores
       ORDER BY embedding <=> $1::vector,
                COALESCE((metadata->>'jerarquiaDecision')::int, 99) ASC,
                nombre ASC
       LIMIT $2`,
      [vector, limit],
    );

    return this.ordenarCandidatosConJerarquia(rows.rows.map((row) => ({
      nombre: row.nombre,
      similitud: Number(row.similitud),
      metadata: row.metadata,
      actualizadoEn: row.actualizado_en,
    })));
  }

  private async buscarFallbackLexico(descripcion: string, limit: number) {
    const rows = await this.pool.query<DependenciaLexicaRow>(
      `SELECT nombre, contenido, metadata, actualizado_en
       FROM dependencias_vectores`,
    );

    const tokensConsulta = this.expandirTokens(this.tokenizar(descripcion));
    const consultaSet = new Set(tokensConsulta);

    const scored = rows.rows.map((row) => {
      const areas = Array.isArray(row.metadata?.areasTematicas)
        ? (row.metadata.areasTematicas as string[]).join(' ')
        : '';
      const textoDep = `${row.nombre} ${row.contenido} ${areas}`;
      const tokensDep = this.expandirTokens(this.tokenizar(textoDep));
      const depSet = new Set(tokensDep);

      let interseccion = 0;
      for (const token of consultaSet) {
        if (depSet.has(token)) interseccion += 1;
      }

      const union = consultaSet.size + depSet.size - interseccion;
      let similitud = union > 0 ? interseccion / union : 0;

      const consultaNorm = this.normalizarTexto(descripcion);
      similitud += this.boostDependencia(consultaNorm, row.nombre);

      return {
        nombre: row.nombre,
        similitud,
        metadata: row.metadata,
        actualizadoEn: row.actualizado_en,
      };
    });

    return this.ordenarCandidatosConJerarquia(scored)
      .slice(0, limit)
      .map((r) => ({
        ...r,
        similitud: Number(Math.max(0, Math.min(1, r.similitud)).toFixed(6)),
      }));
  }

  async clasificar(descripcion: string, ubicacion?: string): Promise<ClasificacionResultado> {
    const evaluacionReglas = this.evaluarReglasAntesRag(descripcion);

    if (evaluacionReglas.fuerza === 'fuerte' && evaluacionReglas.dependencias.length > 0) {
      const dependenciaDirecta = this.ordenarDependenciasPorJerarquia(evaluacionReglas.dependencias)[0];
      return {
        esEspecial: this.esCasoEspecial(descripcion),
        dependencias: [
          {
            nombre: dependenciaDirecta,
            justificacion: `Coincidencia fuerte con regla de filtrado${evaluacionReglas.regla ? ` #${evaluacionReglas.regla.orden}` : ''}.`,
            solicitudEspecifica: 'Atender y responder formalmente la situación reportada por la ciudadanía.',
          },
        ],
        dependenciaPrincipal: dependenciaDirecta,
        asunto: this.construirAsuntoFallback(descripcion),
      };
    }

    const topK = evaluacionReglas.fuerza === 'media' ? 5 : DEFAULT_TOP_K;
    const candidatos = await this.buscar(descripcion, topK);

    if (candidatos.length === 0) {
      if (evaluacionReglas.fuerza === 'media' && evaluacionReglas.dependencias.length > 0) {
        const dependenciaMedia = this.ordenarDependenciasPorJerarquia(evaluacionReglas.dependencias)[0];
        return {
          esEspecial: this.esCasoEspecial(descripcion),
          dependencias: [
            {
              nombre: dependenciaMedia,
              justificacion: 'Coincidencia media por regla; se prioriza dependencia con mejor jerarquía de decisión.',
              solicitudEspecifica: 'Atender y responder formalmente la situación reportada por la ciudadanía.',
            },
          ],
          dependenciaPrincipal: dependenciaMedia,
          asunto: this.construirAsuntoFallback(descripcion),
        };
      }

      return {
        esEspecial: this.esCasoEspecial(descripcion),
        dependencias: [],
        asunto: this.construirAsuntoFallback(descripcion),
      };
    }

    const candidatosOrdenados = this.ordenarCandidatosConJerarquia(candidatos);

    const candidatosTexto = candidatosOrdenados
      .map((c, i) => {
        const areas = Array.isArray(c.metadata?.areasTematicas)
          ? (c.metadata.areasTematicas as string[]).join(', ')
          : 'Sin áreas temáticas registradas';
        const similitud = `${Math.max(0, Math.min(100, c.similitud * 100)).toFixed(2)}%`;
        const jerarquia = this.obtenerJerarquiaDependencia(c.nombre, c.metadata);
        return `${i + 1}. ${c.nombre} (similitud: ${similitud}, jerarquía: ${jerarquia}) — ${areas}`;
      })
      .join('\n');

    const guiaReglaTexto = evaluacionReglas.fuerza === 'media' && evaluacionReglas.regla
      ? `\nGuía de filtrado detectada (coincidencia MEDIA): regla #${evaluacionReglas.regla.orden} - ${evaluacionReglas.regla.condicion}.\nDependencias sugeridas por regla: ${this.ordenarDependenciasPorJerarquia(evaluacionReglas.dependencias).join(', ')}.`
      : '';

    const prompt = `Analiza esta denuncia ciudadana de Medellín:
Descripción: ${descripcion}
${ubicacion ? `Ubicación: ${ubicacion}` : ''}
${guiaReglaTexto}

Las dependencias más relevantes según búsqueda semántica son:
${candidatosTexto}

REGLA: Selecciona SOLO las dependencias que tengan competencia directa y real sobre este problema específico. La mayoría de casos requieren UNA sola dependencia.

Responde SOLO con JSON:
{
  "esEspecial": boolean,
  "dependencias": [
    {
      "nombre": "exactamente como aparece arriba",
      "justificacion": "por qué esta",
      "solicitudEspecifica": "qué pedirle"
    }
  ],
  "asunto": "VERBO + DESCRIPCIÓN EN MAYÚSCULAS"
}`;

    this.assertClasificacionDisponible();
    try {
      const result = await this.clasificacionModel.generateContent(prompt);
      const raw = result.response.text();
      const parsed = this.parseJson<Partial<ClasificacionResultado>>(raw) ?? {};

      const nombresValidos = new Set(candidatosOrdenados.map((c) => c.nombre));
      const dependencias = (Array.isArray(parsed.dependencias) ? parsed.dependencias : [])
        .filter((d): d is ClasificacionDependencia => !!d && typeof d.nombre === 'string')
        .filter((d) => nombresValidos.has(d.nombre))
        .map((d) => ({
          nombre: d.nombre,
          justificacion: d.justificacion ?? 'Coincidencia semántica con la descripción reportada',
          solicitudEspecifica: d.solicitudEspecifica ?? 'Atender y responder formalmente la situación reportada.',
        }));

      const dependenciasFinales =
        dependencias.length > 0
          ? this.ordenarDependenciasClasificadas(dependencias)
          : [
              {
                nombre: candidatosOrdenados[0].nombre,
                justificacion: 'Mayor similitud semántica según embeddings',
                solicitudEspecifica: 'Atender y responder formalmente la situación reportada.',
              },
            ];

      const seleccion = this.seleccionarPrincipalYSecundaria(
        dependenciasFinales,
        candidatosOrdenados,
        evaluacionReglas,
      );

      const dependenciasConArticulacion = [
        seleccion.principal,
        ...(seleccion.secundaria ? [seleccion.secundaria] : []),
      ];

      if (seleccion.secundaria) {
        this.logger.debug(
          JSON.stringify({
            principal: seleccion.principal.nombre,
            secundaria: seleccion.secundaria.nombre,
            motivo: 'caso_mixto',
            scores: seleccion.scores,
          }),
        );
      }

      return {
        esEspecial: parsed.esEspecial === true || this.esCasoEspecial(descripcion),
        dependencias: dependenciasConArticulacion,
        dependenciaPrincipal: seleccion.principal.nombre,
        dependenciaSecundaria: seleccion.secundaria?.nombre,
        asunto: (parsed.asunto ?? this.construirAsuntoFallback(descripcion)).toUpperCase().trim(),
      };
    } catch (err) {
      this.clasificacionGeminiDisponible = false;
      this.logger.warn(
        `Clasificación Gemini no disponible: ${(err as Error).message?.substring(0, 120)}`,
      );
      this.throwGeminiUnavailable();
    }
  }

  async reindexarForzado(): Promise<ResultadoReindexado> {
    this.assertEmbeddingDisponible();
    return this.indexarSiCambio(true);
  }

  private async ensureSchema() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS dependencias_vectores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) UNIQUE,
        contenido TEXT,
        embedding vector(${VECTOR_DIMENSIONS}),
        metadata JSONB,
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rag_index_meta (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        dependencias_hash VARCHAR(64) NOT NULL,
        actualizado_en TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  private async indexarSiCambio(forzar = false): Promise<ResultadoReindexado> {
    const { hash, dependencias } = this.leerDependencias();

    const countRes = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM dependencias_vectores',
    );
    const indexadasActuales = Number(countRes.rows[0]?.count ?? '0');

    const hashRes = await this.pool.query<{ dependencias_hash: string }>(
      'SELECT dependencias_hash FROM rag_index_meta WHERE id = 1',
    );
    const hashActual = hashRes.rows[0]?.dependencias_hash;

    if (!forzar && indexadasActuales > 0 && hashActual === hash) {
      this.logger.log('dependencias.json sin cambios. Se conserva índice existente.');
      return { regenerado: false, hash, indexadas: indexadasActuales };
    }

    const registros: Array<DependenciaIndexada & { embedding: number[] }> = [];

    for (const dep of dependencias) {
      try {
        const embedding = await this.generarEmbeddingSeguro(dep.contenido);
        registros.push({ ...dep, embedding });
      } catch (err) {
        this.logger.warn(
          `No se pudo indexar ${dep.nombre}: ${(err as Error).message?.substring(0, 120)}`,
        );
      }
    }

    if (registros.length === 0) {
      this.logger.warn('No se pudo generar ningún embedding. Se conserva el índice anterior.');
      return { regenerado: false, hash, indexadas: indexadasActuales };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE dependencias_vectores RESTART IDENTITY');

      for (const row of registros) {
        await client.query(
          `INSERT INTO dependencias_vectores (nombre, contenido, embedding, metadata, actualizado_en)
           VALUES ($1, $2, $3::vector, $4::jsonb, NOW())`,
          [
            row.nombre,
            row.contenido,
            this.toVectorLiteral(row.embedding),
            JSON.stringify(row.metadata),
          ],
        );
      }

      await client.query(
        `INSERT INTO rag_index_meta (id, dependencias_hash, actualizado_en)
         VALUES (1, $1, NOW())
         ON CONFLICT (id)
         DO UPDATE SET dependencias_hash = EXCLUDED.dependencias_hash, actualizado_en = NOW()`,
        [hash],
      );

      await client.query('COMMIT');
      this.logger.log(`Indexación completada. Dependencias indexadas: ${registros.length}`);

      return {
        regenerado: true,
        hash,
        indexadas: registros.length,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private leerDependencias(): { hash: string; dependencias: DependenciaIndexada[] } {
    const raw = readFileSync(DEPS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, DependenciaConfig | unknown>;

    const dependencias: DependenciaIndexada[] = Object.entries(parsed)
      .filter(([nombre]) => !nombre.startsWith('_'))
      .map(([nombre, val]) => {
        const dep = (val ?? {}) as DependenciaConfig;
        const areas = Array.isArray(dep.areasTematicas) ? dep.areasTematicas : [];

        const contenido = [
          nombre,
          dep.cargoTitular ?? '',
          areas.join(' '),
          dep.entidadCompleta ?? '',
        ]
          .join(' ')
          .trim();

        return {
          nombre,
          contenido,
          metadata: {
            ...dep,
            areasTematicas: areas,
          },
        };
      });

    const hash = createHash('sha256').update(raw).digest('hex');
    return { hash, dependencias };
  }

  private async generarEmbeddingSeguro(texto: string): Promise<number[]> {
    this.assertEmbeddingDisponible();

    try {
      const result = await this.embeddingModel.embedContent(texto);
      const values = result.embedding?.values ?? [];

      if (!Array.isArray(values) || values.length !== VECTOR_DIMENSIONS) {
        throw new Error(
          `Embedding inválido. Dimensión esperada: ${VECTOR_DIMENSIONS}, obtenida: ${values.length}`,
        );
      }

      return values;
    } catch (err) {
      this.embeddingGeminiDisponible = false;
      this.logger.warn(
        `Embeddings Gemini no disponibles: ${(err as Error).message?.substring(0, 120)}`,
      );
      this.throwGeminiUnavailable();
    }
  }

  private generarEmbeddingLocal(texto: string): number[] {
    const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
    const tokens = this.tokenizar(texto);

    if (tokens.length === 0) {
      vector[0] = 1;
      return vector;
    }

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const baseWeight = 1 + Math.min(4, token.length / 8);

      this.acumularTokenEnVector(vector, token, baseWeight);

      if (i < tokens.length - 1) {
        const bigrama = `${token}_${tokens[i + 1]}`;
        this.acumularTokenEnVector(vector, bigrama, baseWeight * 0.6);
      }
    }

    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
    if (!Number.isFinite(norm) || norm <= 0) {
      vector[0] = 1;
      return vector;
    }

    return vector.map((v) => v / norm);
  }

  private acumularTokenEnVector(vector: number[], token: string, weight: number) {
    const h = this.hashToken(token);
    const idx = h % VECTOR_DIMENSIONS;
    const sign = (h & 1) === 0 ? 1 : -1;
    vector[idx] += sign * weight;
  }

  private hashToken(token: string): number {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private tokenizar(texto: string): string[] {
    const clean = this.normalizarTexto(texto);
    const rawTokens = clean.split(/\s+/).filter(Boolean);
    return rawTokens.map((t) => this.stemBasico(t)).filter((t) => t.length > 1);
  }

  private expandirTokens(tokens: string[]): string[] {
    const expansion: Record<string, string[]> = {
      hueco: ['vial', 'via', 'infraestructura', 'malla', 'anden'],
      calle: ['via', 'vial', 'andene'],
      carr: ['via', 'movilidad'],
      gimnasio: ['deporte', 'deportivo', 'escenario', 'cancha', 'parque', 'inder'],
      parque: ['deporte', 'escenario', 'recreacion', 'inder'],
      cancha: ['deporte', 'escenario', 'inder'],
      deporte: ['deportivo', 'recreacion', 'inder', 'cancha'],
      semaforo: ['movilidad', 'transito'],
      basura: ['aseo', 'residuo', 'emvaria'],
      agua: ['acueducto', 'epm'],
      luz: ['energia', 'epm'],
      gas: ['epm'],
    };

    const expanded = new Set<string>(tokens);
    for (const token of tokens) {
      const extras = expansion[token] ?? [];
      for (const extra of extras) expanded.add(extra);
    }
    return Array.from(expanded);
  }

  private normalizarTexto(texto: string): string {
    return texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private stemBasico(token: string): string {
    if (token.length > 5 && token.endsWith('es')) {
      return token.slice(0, -2);
    }
    if (token.length > 4 && token.endsWith('s')) {
      return token.slice(0, -1);
    }
    return token;
  }

  private esCasoEspecial(descripcion: string): boolean {
    const texto = this.normalizarTexto(descripcion);
    return /(corrupcion|extorsion|vacuna|sicariato|grupo armad|amenaza|homicidio|terrorismo)/.test(texto);
  }

  private boostDependencia(consultaNorm: string, nombreDependencia: string): number {
    const depNorm = this.normalizarTexto(nombreDependencia);
    let boost = 0;

    if (/(hueco|huecos|malla vial|via|calle|anden)/.test(consultaNorm) && depNorm.includes('infraestructura fisica')) {
      boost += 2.0;
    }

    if (/(gimnasio|cancha|deporte|escenario deportivo|parque)/.test(consultaNorm) && depNorm.includes('inder')) {
      boost += 2.0;
    }

    if (/(basura|basura acumulada|aseo|residuo|escombro)/.test(consultaNorm) && depNorm.includes('emvarias')) {
      boost += 1.5;
    }

    if (/(agua|agua sucia|acueducto|alcantarillado|luz|luz danada|energia|gas)/.test(consultaNorm) && depNorm.includes('epm')) {
      boost += 1.5;
    }

    if (/(ruido fuerte|ruido|contaminacion)/.test(consultaNorm) && depNorm.includes('medio ambiente')) {
      boost += 1.2;
    }

    if (/(semaforo|movilidad|transito|fotomulta|transporte)/.test(consultaNorm) && depNorm.includes('movilidad')) {
      boost += 1.2;
    }

    return boost;
  }

  private construirAsuntoFallback(descripcion: string): string {
    const texto = descripcion
      .toUpperCase()
      .replace(/[^A-Z0-9ÁÉÍÓÚÜÑ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fragmento = texto.split(' ').filter(Boolean).slice(0, 10).join(' ');
    return `ATENDER ${fragmento || 'DENUNCIA CIUDADANA EN MEDELLIN'}`.trim();
  }

  private clasificacionFallback(
    candidatos: Array<{ nombre: string }>,
    descripcion: string,
  ): ClasificacionResultado {
    const principal = candidatos[0]?.nombre ?? 'Secretaría de Gobierno y Gestión del Gabinete';

    return {
      esEspecial: this.esCasoEspecial(descripcion),
      dependencias: [
        {
          nombre: principal,
          justificacion: 'Clasificación de respaldo por similitud semántica (fallback sin créditos IA).',
          solicitudEspecifica: 'Atender y responder formalmente la situación reportada por la ciudadanía.',
        },
      ],
      asunto: this.construirAsuntoFallback(descripcion),
    };
  }

  private toVectorLiteral(values: number[]): string {
    return `[${values.join(',')}]`;
  }

  private parseJson<T>(raw: string): T | null {
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      return null;
    }

    try {
      return JSON.parse(clean.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }

  private cargarGuiaFiltradoYJerarquia(): {
    reglas: GuiaFiltradoRegla[];
    jerarquiaPorDependencia: Map<string, number>;
    areasPorDependencia: Map<string, string[]>;
  } {
    const jerarquiaPorDependencia = new Map<string, number>();
    const areasPorDependencia = new Map<string, string[]>();

    try {
      const raw = readFileSync(DEPS_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown> & { _guiaFiltrado?: GuiaFiltradoConfig };

      for (const [nombre, value] of Object.entries(parsed)) {
        if (nombre.startsWith('_')) continue;
        const cfg = (value ?? {}) as DependenciaConfig;
        const jerarquia = Number(cfg.jerarquiaDecision ?? 99);
        jerarquiaPorDependencia.set(nombre, Number.isFinite(jerarquia) ? jerarquia : 99);
        const areas = Array.isArray(cfg.areasTematicas)
          ? cfg.areasTematicas.filter((area): area is string => typeof area === 'string')
          : [];
        areasPorDependencia.set(nombre, areas);
      }

      const reglasRaw = Array.isArray(parsed._guiaFiltrado?.reglas) ? parsed._guiaFiltrado?.reglas : [];
      const reglas = reglasRaw
        .filter((regla): regla is GuiaFiltradoRegla => !!regla && typeof regla.condicion === 'string' && typeof regla.orden === 'number')
        .map((regla) => ({
          ...regla,
          dependencia: typeof regla.dependencia === 'string' ? regla.dependencia : undefined,
          dependencias: Array.isArray(regla.dependencias)
            ? regla.dependencias.filter((dep): dep is string => typeof dep === 'string')
            : undefined,
        }))
        .sort((a, b) => a.orden - b.orden);

      return { reglas, jerarquiaPorDependencia, areasPorDependencia };
    } catch (err) {
      this.logger.warn(`No se pudo cargar guía de filtrado: ${(err as Error).message}`);
      return { reglas: [], jerarquiaPorDependencia, areasPorDependencia };
    }
  }

  private obtenerDependenciasRegla(regla: GuiaFiltradoRegla): string[] {
    if (regla.dependencia) {
      return [regla.dependencia];
    }
    if (Array.isArray(regla.dependencias)) {
      return regla.dependencias;
    }
    return [];
  }

  private escapeRegex(texto: string): string {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private contieneTermino(textoNormalizado: string, termino: string): boolean {
    const term = this.normalizarTexto(termino);
    if (!term) return false;

    if (term.includes(' ')) {
      return textoNormalizado.includes(term);
    }

    const regex = new RegExp(`\\b${this.escapeRegex(term)}\\b`);
    return regex.test(textoNormalizado);
  }

  private extraerTerminosCondicion(condicion: string): string[] {
    const normalizada = this.normalizarTexto(condicion);
    const segmentos = normalizada
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);

    const tokens = normalizada
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length >= 4 && !STOPWORDS_REGLAS.has(t));

    return Array.from(new Set([...segmentos, ...tokens]));
  }

  private evaluarReglasAntesRag(descripcion: string): EvaluacionRegla {
    const texto = this.normalizarTexto(descripcion);
    if (!texto || this.guiaFiltradoReglas.length === 0) {
      return { fuerza: 'nula', dependencias: [] };
    }

    const strongMatches: Array<{ regla: GuiaFiltradoRegla; dependencias: string[] }> = [];
    let mediumMatch: EvaluacionRegla | null = null;

    for (const regla of this.guiaFiltradoReglas) {
      const dependenciasRegla = this.obtenerDependenciasRegla(regla);
      if (dependenciasRegla.length === 0) continue;

      const hints = HINTS_REGLA_POR_ORDEN[regla.orden] ?? { fuerte: [], media: [] };
      const terminosFuertes = Array.from(new Set(hints.fuerte.map((t) => this.normalizarTexto(t)).filter(Boolean)));
      const terminosMedios = Array.from(
        new Set([
          ...hints.media,
          ...this.extraerTerminosCondicion(regla.condicion),
        ].map((t) => this.normalizarTexto(t)).filter(Boolean)),
      );

      const matchFuerte = terminosFuertes.some((termino) => this.contieneTermino(texto, termino));
      if (matchFuerte) {
        strongMatches.push({ regla, dependencias: dependenciasRegla });
        continue;
      }

      const matchMedio = terminosMedios.some((termino) => this.contieneTermino(texto, termino));
      if (matchMedio && !mediumMatch) {
        mediumMatch = { fuerza: 'media', regla, dependencias: dependenciasRegla };
      }
    }

    if (strongMatches.length === 1 && strongMatches[0].dependencias.length === 1) {
      return {
        fuerza: 'fuerte',
        regla: strongMatches[0].regla,
        dependencias: strongMatches[0].dependencias,
      };
    }

    if (strongMatches.length > 0) {
      const dependencias = Array.from(
        new Set(strongMatches.flatMap((m) => m.dependencias)),
      );
      return {
        fuerza: 'media',
        regla: strongMatches[0].regla,
        dependencias,
      };
    }

    if (mediumMatch) {
      return mediumMatch;
    }

    return { fuerza: 'nula', dependencias: [] };
  }

  private obtenerJerarquiaDependencia(nombre: string, metadata?: Record<string, unknown>): number {
    const metaRaw = metadata?.jerarquiaDecision;
    const meta = typeof metaRaw === 'number' ? metaRaw : Number(metaRaw ?? NaN);
    if (Number.isFinite(meta) && meta > 0) {
      return meta;
    }

    return this.jerarquiaPorDependencia.get(nombre) ?? 99;
  }

  private ordenarDependenciasPorJerarquia(dependencias: string[]): string[] {
    return [...dependencias].sort((a, b) => {
      const jerA = this.obtenerJerarquiaDependencia(a);
      const jerB = this.obtenerJerarquiaDependencia(b);
      if (jerA !== jerB) return jerA - jerB;
      return a.localeCompare(b);
    });
  }

  private ordenarDependenciasClasificadas(dependencias: ClasificacionDependencia[]): ClasificacionDependencia[] {
    return [...dependencias].sort((a, b) => {
      const jerA = this.obtenerJerarquiaDependencia(a.nombre);
      const jerB = this.obtenerJerarquiaDependencia(b.nombre);
      if (jerA !== jerB) return jerA - jerB;
      return a.nombre.localeCompare(b.nombre);
    });
  }

  private ordenarCandidatosConJerarquia(candidatos: CandidatoBusqueda[]): CandidatoBusqueda[] {
    return [...candidatos].sort((a, b) => {
      const diff = Math.abs(b.similitud - a.similitud);
      if (diff > 0.000001) return b.similitud - a.similitud;

      const jerA = this.obtenerJerarquiaDependencia(a.nombre, a.metadata);
      const jerB = this.obtenerJerarquiaDependencia(b.nombre, b.metadata);
      if (jerA !== jerB) return jerA - jerB;

      return a.nombre.localeCompare(b.nombre);
    });
  }

  private construirDependenciaClasificadaDefault(nombre: string, score: number): ClasificacionDependencia {
    if (score >= 0.5) {
      return {
        nombre,
        justificacion: 'Coincidencia semántica alta con la problemática reportada.',
        solicitudEspecifica: 'Atender y responder formalmente la situación reportada por la ciudadanía.',
      };
    }

    return {
      nombre,
      justificacion: 'Coincidencia complementaria para atención articulada de la situación.',
      solicitudEspecifica: 'Articular acciones con la dependencia principal para una atención integral.',
    };
  }

  private obtenerMapCandidatos(candidatos: CandidatoBusqueda[]): Map<string, CandidatoBusqueda> {
    const map = new Map<string, CandidatoBusqueda>();
    for (const candidato of candidatos) {
      map.set(candidato.nombre, candidato);
    }
    return map;
  }

  private esSecundariaViable(
    principal: DependenciaSeleccionable,
    candidata: DependenciaSeleccionable,
    hayDosSenalesClaras: boolean,
  ): boolean {
    if (!hayDosSenalesClaras) return false;

    const scoreGap = principal.score - candidata.score;
    const scoreRatio = candidata.score / Math.max(principal.score, 0.0001);
    const scoreCercano =
      candidata.score >= SECONDARY_MIN_SCORE &&
      (scoreGap <= SECONDARY_MAX_GAP || scoreRatio >= SECONDARY_MIN_RATIO);

    if (!scoreCercano) return false;

    return this.sonTematicasDiferentes(principal, candidata);
  }

  private sonTematicasDiferentes(
    principal: DependenciaSeleccionable,
    candidata: DependenciaSeleccionable,
  ): boolean {
    const temasPrincipal = this.obtenerSetTemas(principal.clasificada.nombre, principal.metadata);
    const temasSecundaria = this.obtenerSetTemas(candidata.clasificada.nombre, candidata.metadata);

    if (temasPrincipal.size === 0 || temasSecundaria.size === 0) {
      return principal.clasificada.nombre !== candidata.clasificada.nombre;
    }

    let interseccion = 0;
    for (const tema of temasPrincipal) {
      if (temasSecundaria.has(tema)) interseccion += 1;
    }

    const base = Math.max(1, Math.min(temasPrincipal.size, temasSecundaria.size));
    const similitud = interseccion / base;
    return similitud < 0.45;
  }

  private obtenerSetTemas(
    nombre: string,
    metadata?: Record<string, unknown>,
  ): Set<string> {
    const areasMeta = Array.isArray(metadata?.areasTematicas)
      ? (metadata?.areasTematicas as unknown[])
      : [];

    const areas = [
      ...areasMeta.filter((area): area is string => typeof area === 'string'),
      ...(this.areasPorDependencia.get(nombre) ?? []),
    ];

    const tokens = new Set<string>();
    for (const area of areas) {
      for (const token of this.tokenizar(area)) {
        tokens.add(token);
      }
    }
    return tokens;
  }

  private seleccionarPrincipalYSecundaria(
    dependenciasClasificadas: ClasificacionDependencia[],
    candidatosOrdenados: CandidatoBusqueda[],
    evaluacionReglas: EvaluacionRegla,
  ): {
    principal: ClasificacionDependencia;
    secundaria?: ClasificacionDependencia;
    scores: Array<{ dependencia: string; score: number; jerarquia: number }>;
  } {
    const mapClasificadas = new Map<string, ClasificacionDependencia>();
    for (const dep of dependenciasClasificadas) {
      mapClasificadas.set(dep.nombre, dep);
    }

    const candidatosMap = this.obtenerMapCandidatos(candidatosOrdenados);
    const poolNombres = Array.from(
      new Set([
        ...dependenciasClasificadas.map((d) => d.nombre),
        ...evaluacionReglas.dependencias,
        ...candidatosOrdenados.slice(0, 3).map((c) => c.nombre),
      ]),
    );

    const seleccionables: DependenciaSeleccionable[] = poolNombres
      .map((nombre) => {
        const candidato = candidatosMap.get(nombre);
        const score = candidato
          ? Number(Math.max(0, Math.min(1, candidato.similitud)).toFixed(6))
          : (evaluacionReglas.dependencias.includes(nombre) ? 0.35 : 0);
        const jerarquia = this.obtenerJerarquiaDependencia(nombre, candidato?.metadata);
        const clasificada = mapClasificadas.get(nombre) ?? this.construirDependenciaClasificadaDefault(nombre, score);

        return {
          clasificada,
          score,
          jerarquia,
          metadata: candidato?.metadata,
        };
      })
      .sort((a, b) => {
        const diff = Math.abs(b.score - a.score);
        if (diff > 0.000001) return b.score - a.score;
        if (a.jerarquia !== b.jerarquia) return a.jerarquia - b.jerarquia;
        return a.clasificada.nombre.localeCompare(b.clasificada.nombre);
      });

    const principal = seleccionables[0] ?? {
      clasificada: dependenciasClasificadas[0],
      score: 0,
      jerarquia: this.obtenerJerarquiaDependencia(dependenciasClasificadas[0].nombre),
    };

    const hayDosSenalesClaras =
      evaluacionReglas.dependencias.length >= 2 ||
      candidatosOrdenados.filter((c) => c.similitud >= 0.45).length >= 2;

    const secundaria = seleccionables
      .slice(1)
      .find((cand) => this.esSecundariaViable(principal, cand, hayDosSenalesClaras));

    return {
      principal: principal.clasificada,
      secundaria: secundaria?.clasificada,
      scores: seleccionables.map((s) => ({
        dependencia: s.clasificada.nombre,
        score: Number(s.score.toFixed(6)),
        jerarquia: s.jerarquia,
      })),
    };
  }
}
