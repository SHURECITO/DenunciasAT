import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEPENDENCIAS_PATH = join(process.cwd(), 'infrastructure', 'config', 'dependencias.json');
const VECTOR_DB_PATH = join(process.cwd(), 'infrastructure', 'config', 'dependencias.vector.db.json');

const VECTOR_DIMENSIONS = 256;

const MANUAL_ALIASES: Record<string, string> = {
  'secretaria de recreacion y deporte': 'INDER',
  'secretaria de deportes': 'INDER',
  'instituto de deporte y recreacion': 'INDER',
  'instituto de recreacion y deporte': 'INDER',
  'inder medellin': 'INDER',
  'secretaria de infraestructura': 'Secretaría de Infraestructura Física',
  'secretaria de control territorial': 'Secretaría de Gestión y Control Territorial',
  'secretaria de no violencia': 'Secretaría de Paz y Derechos Humanos',
  'secretaria de derechos humanos': 'Secretaría de Paz y Derechos Humanos',
  'secretaria de inclusion': 'Secretaría de Inclusión Social, Familia y DDHH',
  'secretaria de inclusion social': 'Secretaría de Inclusión Social, Familia y DDHH',
  'secretaria de turismo': 'Secretaría de Turismo y Entretenimiento',
};

interface DependenciaConfig {
  areasTematicas?: string[];
  cargoTitular?: string;
  entidadCompleta?: string;
  nivel?: string;
  tipo?: string;
  jerarquiaDecision?: number;
}

interface DependenciasConfig {
  [key: string]: DependenciaConfig | Record<string, string> | unknown;
}

export interface DependenciaVectorRecord {
  id: string;
  nombre: string;
  normalized: string;
  alias: string[];
  keywords: string[];
  vectorSparse: Array<[number, number]>;
  metadata: {
    nivel: string;
    tipo: string;
    jerarquiaDecision: number;
  };
}

export interface DependenciasVectorDb {
  version: string;
  generatedAt: string;
  dimensions: number;
  metric: 'cosine';
  records: DependenciaVectorRecord[];
}

export interface DependenciasKnowledgeBase {
  nombresDependencias: string[];
  catalogoTexto: string;
  vectorDb: DependenciasVectorDb;
  resolveDependencia: (raw: string, contexto?: string) => string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((t) => t.length >= 2);
}

function hashToken(token: string, dimensions: number): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return Math.abs(hash >>> 0) % dimensions;
}

function buildSparseVector(text: string, dimensions: number): Array<[number, number]> {
  const map = new Map<number, number>();
  for (const token of tokenize(text)) {
    const idx = hashToken(token, dimensions);
    map.set(idx, (map.get(idx) ?? 0) + 1);
  }

  let norm = 0;
  for (const value of map.values()) {
    norm += value * value;
  }
  norm = Math.sqrt(norm) || 1;

  const sparse: Array<[number, number]> = [];
  for (const [idx, value] of map.entries()) {
    sparse.push([idx, value / norm]);
  }
  sparse.sort((a, b) => a[0] - b[0]);
  return sparse;
}

function sparseToMap(sparse: Array<[number, number]>): Map<number, number> {
  const map = new Map<number, number>();
  for (const [idx, value] of sparse) {
    map.set(idx, value);
  }
  return map;
}

function cosineSparse(query: Map<number, number>, target: Array<[number, number]>): number {
  let score = 0;
  for (const [idx, value] of target) {
    score += (query.get(idx) ?? 0) * value;
  }
  return score;
}

function buildAutoAlias(nombreDependencia: string): string[] {
  const normalized = normalizeText(nombreDependencia);
  const aliases = new Set<string>([normalized]);

  const withoutPrefixes = normalized
    .replace(/^secretaria\s+de\s+/, '')
    .replace(/^departamento\s+administrativo\s+de\s+/, '')
    .replace(/^gerencia\s+de\s+/, '')
    .replace(/^empresa\s+de\s+/, '')
    .trim();

  if (withoutPrefixes && withoutPrefixes !== normalized) {
    aliases.add(withoutPrefixes);
  }

  return [...aliases];
}

export function buildDependenciasKnowledgeBase(): DependenciasKnowledgeBase {
  const raw = JSON.parse(readFileSync(DEPENDENCIAS_PATH, 'utf8')) as DependenciasConfig;

  const nombresDependencias = Object.keys(raw).filter((k) => !k.startsWith('_'));

  const aliasMap = new Map<string, string>();
  for (const nombre of nombresDependencias) {
    for (const alias of buildAutoAlias(nombre)) {
      aliasMap.set(alias, nombre);
    }
  }

  const aliasesFromJson = (raw['_aliases'] ?? {}) as Record<string, string>;
  for (const [alias, dependencia] of Object.entries(aliasesFromJson)) {
    if (nombresDependencias.includes(dependencia)) {
      aliasMap.set(normalizeText(alias), dependencia);
    }
  }

  for (const [alias, dependencia] of Object.entries(MANUAL_ALIASES)) {
    if (nombresDependencias.includes(dependencia)) {
      aliasMap.set(normalizeText(alias), dependencia);
    }
  }

  const records: DependenciaVectorRecord[] = nombresDependencias.map((nombre) => {
    const cfg = (raw[nombre] ?? {}) as DependenciaConfig;
    const aliases = [...aliasMap.entries()]
      .filter(([, dep]) => dep === nombre)
      .map(([alias]) => alias);

    const keywords = Array.from(
      new Set<string>([
        nombre,
        cfg.cargoTitular ?? '',
        cfg.entidadCompleta ?? '',
        ...(cfg.areasTematicas ?? []),
        ...aliases,
      ].filter(Boolean).map((v) => normalizeText(v))),
    );

    const vectorSparse = buildSparseVector(keywords.join(' '), VECTOR_DIMENSIONS);

    return {
      id: normalizeText(nombre).replace(/\s+/g, '-'),
      nombre,
      normalized: normalizeText(nombre),
      alias: aliases,
      keywords,
      vectorSparse,
      metadata: {
        nivel: cfg.nivel ?? 'central',
        tipo: cfg.tipo ?? 'dependencia',
        jerarquiaDecision: cfg.jerarquiaDecision ?? 5,
      },
    };
  });

  const vectorDb: DependenciasVectorDb = {
    version: '2026.04.18',
    generatedAt: new Date().toISOString(),
    dimensions: VECTOR_DIMENSIONS,
    metric: 'cosine',
    records,
  };

  try {
    writeFileSync(VECTOR_DB_PATH, JSON.stringify(vectorDb, null, 2), 'utf8');
  } catch {
    // Si no se puede persistir (read-only), continuamos con el índice en memoria.
  }

  const catalogoTexto = nombresDependencias.map((d) => `- ${d}`).join('\n');

  const resolveDependencia = (rawDependencia: string, contexto = ''): string => {
    const rawNormalized = normalizeText(rawDependencia);
    if (!rawNormalized) return '';

    const directo = aliasMap.get(rawNormalized);
    if (directo) return directo;

    for (const record of records) {
      if (rawNormalized.includes(record.normalized) || record.normalized.includes(rawNormalized)) {
        return record.nombre;
      }
    }

    const query = sparseToMap(buildSparseVector(`${rawDependencia} ${contexto}`, VECTOR_DIMENSIONS));

    let best: { nombre: string; score: number } = { nombre: '', score: 0 };
    for (const record of records) {
      const score = cosineSparse(query, record.vectorSparse);
      if (score > best.score) {
        best = { nombre: record.nombre, score };
      }
    }

    return best.score >= 0.22 ? best.nombre : '';
  };

  return {
    nombresDependencias,
    catalogoTexto,
    vectorDb,
    resolveDependencia,
  };
}
