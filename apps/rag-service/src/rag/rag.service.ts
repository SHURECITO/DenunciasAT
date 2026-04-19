import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  [key: string]: unknown;
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
  asunto: string;
}

const VECTOR_DIMENSIONS = 768;
const DEFAULT_TOP_K = 3;
const DEPS_PATH = join(process.cwd(), 'infrastructure', 'config', 'dependencias.json');

@Injectable()
export class RagService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagService.name);
  private readonly pool: Pool;
  private readonly internalKey: string;

  private readonly embeddingModel: GenerativeModel | null;
  private readonly clasificacionModel: GenerativeModel | null;
  private embeddingGeminiDisponible = true;
  private clasificacionGeminiDisponible = true;

  constructor(private readonly config: ConfigService) {
    const databaseUrl = this.config.get<string>(
      'DATABASE_URL',
      'postgresql://denunciasat:denunciasat2026@postgres:5432/denunciasat',
    );

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    });

    this.internalKey = this.config.get<string>('DASHBOARD_API_INTERNAL_KEY', '').trim();

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

  async health() {
    const [{ ok }] = (await this.pool.query<{ ok: number }>('SELECT 1 AS ok')).rows;
    return { status: ok === 1 ? 'ok' : 'degraded', service: 'rag-service' };
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

    // Sin créditos/llave de Gemini, usar ranking léxico robusto para mantener operatividad.
    if (!this.embeddingModel || !this.embeddingGeminiDisponible) {
      return this.buscarFallbackLexico(descripcion, limit);
    }

    const embedding = await this.generarEmbeddingSeguro(descripcion);
    if (!this.embeddingGeminiDisponible) {
      return this.buscarFallbackLexico(descripcion, limit);
    }

    const vector = this.toVectorLiteral(embedding);

    const rows = await this.pool.query<DependenciaVectorRow>(
      `SELECT nombre, metadata, actualizado_en,
              1 - (embedding <=> $1::vector) AS similitud
       FROM dependencias_vectores
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vector, limit],
    );

    return rows.rows.map((row) => ({
      nombre: row.nombre,
      similitud: Number(row.similitud),
      metadata: row.metadata,
      actualizadoEn: row.actualizado_en,
    }));
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

    return scored
      .sort((a, b) => {
        if (b.similitud !== a.similitud) return b.similitud - a.similitud;
        return a.nombre.localeCompare(b.nombre);
      })
      .slice(0, limit)
      .map((r) => ({
        ...r,
        similitud: Number(Math.max(0, Math.min(1, r.similitud)).toFixed(6)),
      }));
  }

  async clasificar(descripcion: string, ubicacion?: string): Promise<ClasificacionResultado> {
    const candidatos = await this.buscar(descripcion, DEFAULT_TOP_K);

    if (candidatos.length === 0) {
      return {
        esEspecial: this.esCasoEspecial(descripcion),
        dependencias: [],
        asunto: this.construirAsuntoFallback(descripcion),
      };
    }

    const candidatosTexto = candidatos
      .map((c, i) => {
        const areas = Array.isArray(c.metadata?.areasTematicas)
          ? (c.metadata.areasTematicas as string[]).join(', ')
          : 'Sin áreas temáticas registradas';
        const similitud = `${Math.max(0, Math.min(100, c.similitud * 100)).toFixed(2)}%`;
        return `${i + 1}. ${c.nombre} (similitud: ${similitud}) — ${areas}`;
      })
      .join('\n');

    const prompt = `Analiza esta denuncia ciudadana de Medellín:
Descripción: ${descripcion}
${ubicacion ? `Ubicación: ${ubicacion}` : ''}

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

    if (this.clasificacionModel && this.clasificacionGeminiDisponible) {
      try {
        const result = await this.clasificacionModel.generateContent(prompt);
        const raw = result.response.text();
        const parsed = this.parseJson<Partial<ClasificacionResultado>>(raw) ?? {};

        const nombresValidos = new Set(candidatos.map((c) => c.nombre));
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
            ? dependencias
            : [
                {
                  nombre: candidatos[0].nombre,
                  justificacion: 'Mayor similitud semántica según embeddings',
                  solicitudEspecifica: 'Atender y responder formalmente la situación reportada.',
                },
              ];

        return {
          esEspecial: parsed.esEspecial === true || this.esCasoEspecial(descripcion),
          dependencias: dependenciasFinales,
          asunto: (parsed.asunto ?? this.construirAsuntoFallback(descripcion)).toUpperCase().trim(),
        };
      } catch (err) {
        this.clasificacionGeminiDisponible = false;
        this.logger.warn(
          `Clasificación Gemini no disponible, usando fallback local: ${(err as Error).message?.substring(0, 120)}`,
        );
      }
    }

    return this.clasificacionFallback(candidatos, descripcion);
  }

  async reindexarForzado(): Promise<ResultadoReindexado> {
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
    if (this.embeddingModel && this.embeddingGeminiDisponible) {
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
          `Embeddings Gemini no disponibles, activando fallback local: ${(err as Error).message?.substring(0, 120)}`,
        );
      }
    }

    return this.generarEmbeddingLocal(texto);
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

    if (/(basura|aseo|residuo|escombro)/.test(consultaNorm) && depNorm.includes('emvarias')) {
      boost += 1.5;
    }

    if (/(agua|acueducto|alcantarillado|luz|energia|gas)/.test(consultaNorm) && depNorm.includes('epm')) {
      boost += 1.5;
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
}
