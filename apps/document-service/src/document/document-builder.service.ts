import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import axios from 'axios';
import { MinioService } from '@app/storage';
import type { DenunciaData } from './dashboard-api.service';

import AdmZip = require('adm-zip');

/** Una dependencia con su solicitud específica (para oficios multi-destinatario) */
export interface DependenciaSolicitud {
  nombre: string;
  solicitudEspecifica: string;
}

// ─── Rutas ────────────────────────────────────────────────────────────────────
const TEMPLATE_PATH = join(process.cwd(), 'infrastructure', 'templates', 'Plantilla.docx');
const DEPS_PATH     = join(process.cwd(), 'infrastructure', 'config', 'dependencias.json');

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Destinatario {
  titulo: string;   // "Doctor" | "Doctora"
  nombre: string;   // "SECRETARIO DE INFRAESTRUCTURA FÍSICA"
  cargo:  string;   // "Secretario de Infraestructura Física"
  entidad: string;  // "Secretaría de Infraestructura Física"
}

interface DestinatarioConfig {
  titulo?: string;
  nombre?: string;
  cargo?: string;
  entidad?: string;
  nombreTitular?: string;
  cargoTitular?: string;
  entidadCompleta?: string;
}

export interface BuildInput {
  denuncia:          DenunciaData;
  hechos:            string;
  asunto:            string;
  solicitudAdicional?: string;
  imagenes:          string[];
  rutaDestino:       string;
  // Solicitudes específicas por dependencia (cuando hay múltiples destinatarios).
  // Si se provee, se usa para renderizar sub-bloques en la sección SOLICITUD.
  dependenciasEstructuradas?: DependenciaSolicitud[];
}

// ─── Meses en español ────────────────────────────────────────────────────────
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatFecha(isoDate: string): string {
  const d = new Date(isoDate);
  return `Medellín, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// ─── Escape XML ───────────────────────────────────────────────────────────────
function xe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Font y tamaño base ───────────────────────────────────────────────────────
const FONT = 'Calibri';
const SZ   = 24; // 12pt en half-points

// ─── Propiedades de párrafo ───────────────────────────────────────────────────
type Align = 'left' | 'right' | 'center' | 'justified';
const JC_MAP: Record<Align, string> = {
  left:      'left',
  right:     'right',
  center:    'center',
  justified: 'both',
};

interface ParaOpts {
  bold?:         boolean;
  italic?:       boolean;
  align?:        Align;
  spacingAfter?: number;
  size?:         number;
  font?:         string;
  color?:        string;
}

/** Genera un párrafo OOXML simple con un solo run de texto */
function p(text: string, opts: ParaOpts = {}): string {
  const {
    bold = false, italic = false, align = 'left',
    spacingAfter = 120, size = SZ, font = FONT, color,
  } = opts;
  const jc   = JC_MAP[align];
  const bTag = bold   ? '<w:b/><w:bCs/>' : '';
  const iTag = italic ? '<w:i/><w:iCs/>' : '';
  const cTag = color  ? `<w:color w:val="${color}"/>` : '';
  const rpr  = `<w:rPr>${bTag}${iTag}${cTag}<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const ppr  = `<w:pPr><w:spacing w:after="${spacingAfter}" w:line="240" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>`;
  if (!text) {
    return `<w:p>${ppr}</w:p>`;
  }
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xe(text)}</w:t></w:r></w:p>`;
}

/** Tabla sin bordes (salvo borde inferior) que deja espacio de firma para Mercurio */
function signatureTableXml(): string {
  return (
    `<w:tbl>` +
    `<w:tblPr>` +
      `<w:tblW w:w="4320" w:type="dxa"/>` +
      `<w:tblBorders>` +
        `<w:top w:val="nil"/>` +
        `<w:left w:val="nil"/>` +
        `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
        `<w:right w:val="nil"/>` +
        `<w:insideH w:val="nil"/>` +
        `<w:insideV w:val="nil"/>` +
      `</w:tblBorders>` +
      `<w:tblLook w:val="04A0"/>` +
    `</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>` +
    `<w:tr>` +
      `<w:trPr><w:trHeight w:val="1440" w:hRule="exact"/></w:trPr>` +
      `<w:tc>` +
        `<w:tcPr>` +
          `<w:tcW w:w="4320" w:type="dxa"/>` +
          `<w:tcBorders>` +
            `<w:top w:val="nil"/>` +
            `<w:left w:val="nil"/>` +
            `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>` +
            `<w:right w:val="nil"/>` +
          `</w:tcBorders>` +
        `</w:tcPr>` +
        `<w:p/>` +
      `</w:tc>` +
    `</w:tr>` +
    `</w:tbl>`
  );
}

/** Párrafo de ASUNTO: "ASUNTO: " en negrita + texto normal */
function asuntoP(asunto: string): string {
  const ppr  = `<w:pPr><w:spacing w:after="240" w:line="240" w:lineRule="auto"/></w:pPr>`;
  const rprB = `<w:rPr><w:b/><w:bCs/><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:sz w:val="${SZ}"/><w:szCs w:val="${SZ}"/></w:rPr>`;
  const rprN = `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:sz w:val="${SZ}"/><w:szCs w:val="${SZ}"/></w:rPr>`;
  return `<w:p>${ppr}<w:r>${rprB}<w:t xml:space="preserve">ASUNTO: </w:t></w:r><w:r>${rprN}<w:t xml:space="preserve">${xe(asunto)}</w:t></w:r></w:p>`;
}

// ─── Imágenes ─────────────────────────────────────────────────────────────────
const MAX_CX_EMU  = 5029200; // 5.5 pulgadas
const MAX_CY_EMU  = 3657600; // 4.0 pulgadas
const MIN_CX_EMU  = 1828800; // 2.0 pulgadas
const EMU_PER_PX  = 9525;    // 96 DPI

/** Descarga imagen desde URL externa (fallback para URLs no-MinIO), devuelve Buffer o null */
async function downloadImageFromUrl(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

/**
 * Parsea una URL interna de MinIO (http://minio:9000/bucket/objectName)
 * y devuelve { bucket, objectName } o null si no es una URL de MinIO.
 */
function parseMinioUrl(url: string): { bucket: string; objectName: string } | null {
  try {
    const parsed = new URL(url);
    // Reconocer cualquier host que contenga "minio" o sea localhost con puerto 9000
    if (!parsed.hostname.includes('minio') && !(parsed.hostname === 'localhost' && parsed.port === '9000')) {
      return null;
    }
    // pathname: /bucket/objectName... (primer segmento es el bucket)
    const parts = parsed.pathname.slice(1).split('/');
    if (parts.length < 2) return null;
    const bucket     = parts[0];
    const objectName = parts.slice(1).join('/');
    return { bucket, objectName };
  } catch {
    return null;
  }
}

/** Determina la extensión de la imagen por bytes mágicos */
function detectImageExt(buf: Buffer): 'png' | 'jpeg' | 'unsupported' {
  if (buf.length >= 8 && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return 'png';
  }

  // JPEG
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }

  // WEBP (Word puede fallar al renderizarlo en este flujo)
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'unsupported';
  }

  return 'unsupported';
}

/** Lee dimensiones en píxeles de JPEG o PNG desde los bytes del header */
function getImageDimensions(buf: Buffer): { width: number; height: number } {
  try {
    // PNG: firma 89 50 4E 47 0D 0A 1A 0A, luego IHDR con width/height big-endian en offsets 16/20
    if (buf.length >= 24 && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
      return {
        width:  buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }
    // JPEG: recorrer segmentos hasta encontrar un marcador SOF (0xC0–0xC3)
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 4 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const segLen = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3 && i + 9 < buf.length) {
          return {
            height: buf.readUInt16BE(i + 5),
            width:  buf.readUInt16BE(i + 7),
          };
        }
        i += 2 + segLen;
      }
    }
  } catch { /* fall through */ }

  // Default: tamaño razonable si no se puede detectar
  return { width: 3000, height: 2000 };
}

/** Calcula dimensiones finales en EMU respetando máximos y un mínimo de ancho */
function calcularDimensionesImagen(width: number, height: number): { cx: number; cy: number } {
  let cx = width * EMU_PER_PX;
  let cy = height * EMU_PER_PX;

  // Si excede ancho máximo, escalar manteniendo proporción
  if (cx > MAX_CX_EMU) {
    cy = Math.round(cy * MAX_CX_EMU / cx);
    cx = MAX_CX_EMU;
  }
  // Si excede alto máximo, escalar manteniendo proporción
  if (cy > MAX_CY_EMU) {
    cx = Math.round(cx * MAX_CY_EMU / cy);
    cy = MAX_CY_EMU;
  }
  // Si quedó por debajo del ancho mínimo, ampliar hasta el mínimo
  if (cx < MIN_CX_EMU) {
    cy = Math.round(cy * MIN_CX_EMU / cx);
    cx = MIN_CX_EMU;
  }

  return { cx, cy };
}

/** Genera el XML de un párrafo con imagen inline */
function imageParaXml(relId: string, num: number, ext: string, dims: { cx: number; cy: number }): string {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${dims.cx}" cy="${dims.cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${num}" name="Evidencia ${num}"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="${num}" name="evidencia_${num}.${ext}"/>` +
    `<pic:cNvPicPr/>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${dims.cx}" cy="${dims.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`;
}

// ─── Resolución de destinatario ───────────────────────────────────────────────
let _depsCache: Record<string, DestinatarioConfig> | null = null;

function loadDeps(): Record<string, DestinatarioConfig> {
  if (_depsCache) return _depsCache;
  try {
    _depsCache = JSON.parse(readFileSync(DEPS_PATH, 'utf8')) as Record<string, DestinatarioConfig>;
  } catch {
    _depsCache = {};
  }
  return _depsCache;
}

function resolveDestinatario(dependencia: string): Destinatario {
  const deps = loadDeps();
  const dep = deps[dependencia];
  if (dep) {
    return {
      titulo: dep.titulo ?? 'Doctor',
      nombre: dep.nombreTitular ?? dep.nombre ?? dependencia.toUpperCase(),
      cargo: dep.cargoTitular ?? dep.cargo ?? 'Director/a',
      entidad: dep.entidadCompleta ?? dep.entidad ?? dependencia,
    };
  }
  // Fallback: construir desde el nombre
  const titulo = dependencia.toLowerCase().includes('secretar') &&
    /a\s+de\s+/i.test(dependencia) ? 'Doctora' : 'Doctor';
  return {
    titulo,
    nombre:  dependencia.toUpperCase(),
    cargo:   'Director/a',
    entidad: dependencia,
  };
}

// ─── Servicio principal ───────────────────────────────────────────────────────
@Injectable()
export class DocumentBuilderService {
  private readonly logger = new Logger(DocumentBuilderService.name);
  private readonly allowExternalImageUrls: boolean;
  private readonly allowedRemoteHosts: string[];

  constructor(
    private readonly minio: MinioService,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('ALLOW_EXTERNAL_IMAGE_URLS', 'false').toLowerCase();
    this.allowExternalImageUrls = raw === 'true' || raw === '1' || raw === 'yes';
    this.allowedRemoteHosts = this.config
      .get<string>('ALLOWED_REMOTE_MEDIA_HOSTS', 'evolution-api')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  }

  private isExternalHostAllowed(url: string): boolean {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }

    return this.allowedRemoteHosts.some((allowed) => {
      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
      }
      return hostname === allowed;
    });
  }

  /** Descarga imagen desde MinIO (si es URL interna) o desde URL externa */
  private async fetchImageBuffer(url: string): Promise<Buffer | null> {
    const minioRef = parseMinioUrl(url);
    if (minioRef) {
      try {
        return await this.minio.downloadBuffer(minioRef.bucket, minioRef.objectName);
      } catch (err) {
        this.logger.warn(`No se pudo descargar imagen de MinIO (${minioRef.bucket}/${minioRef.objectName}): ${(err as Error).message}`);
        return null;
      }
    }

    if (!this.allowExternalImageUrls) {
      this.logger.warn('Imagen externa descartada por política de seguridad (ALLOW_EXTERNAL_IMAGE_URLS=false)');
      return null;
    }

    if (!this.isExternalHostAllowed(url)) {
      this.logger.warn('Imagen externa descartada: host no permitido por ALLOWED_REMOTE_MEDIA_HOSTS');
      return null;
    }

    return downloadImageFromUrl(url);
  }

  async construir(input: BuildInput): Promise<void> {
    const { denuncia, hechos, asunto, solicitudAdicional, imagenes, rutaDestino } = input;
    mkdirSync(dirname(rutaDestino), { recursive: true });

    // Cargar plantilla como ZIP
    const zip = new AdmZip(TEMPLATE_PATH);

    // Extraer el opening tag (con TODOS los namespaces) y el sectPr del document.xml original
    // Crítico: si solo usamos xmlns:w, Word muestra mensaje de reparación y elimina el membrete.
    const originalDocXml = zip.readAsText('word/document.xml');
    const openTagMatch   = originalDocXml.match(/<w:document[^>]*>/);
    const openTag        = openTagMatch?.[0] ?? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    const sectPrMatch    = originalDocXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
    const sectPr         = sectPrMatch?.[0] ?? '';

    // Resolver dependencias y destinatarios
    const depStr  = denuncia.dependenciaAsignada ?? 'la entidad competente';
    const depList = depStr.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const dest0   = resolveDestinatario(depList[0] ?? depStr);

    // ── Construir el cuerpo ───────────────────────────────────────────────────
    const body: string[] = [];

    // Radicado alineado a la derecha
    body.push(p(denuncia.radicado, { align: 'right', spacingAfter: 240 }));

    // Fecha
    body.push(p(formatFecha(denuncia.fechaCreacion), { spacingAfter: 480 }));

    // Un bloque por cada destinatario
    for (const dep of depList) {
      const dest = resolveDestinatario(dep);
      body.push(p(`${dest.titulo},`));
      body.push(p(dest.nombre, { bold: true }));
      body.push(p(dest.cargo));
      body.push(p(dest.entidad));
      body.push(p('Ciudad', { spacingAfter: 480 }));
    }

    // ASUNTO
    body.push(asuntoP(asunto));
    body.push(p('', { spacingAfter: 240 }));

    // Saludo
    const saludo = `Respetado/a ${dest0.titulo.toLowerCase().replace(',', '')}:`;
    body.push(p(saludo, { spacingAfter: 240 }));

    // Apertura
    body.push(p(
      'En mi calidad de concejal de la ciudad de Medellín, y en ejercicio de mis funciones constitucionales y legales, respetuosamente me dirijo a su despacho con el fin de que sea atendida la siguiente situación de interés público:',
      { align: 'justified', spacingAfter: 360 },
    ));

    // ── HECHOS ────────────────────────────────────────────────────────────────
    body.push(p('HECHOS', { bold: true, align: 'center', spacingAfter: 240 }));

    for (const par of hechos.split(/\n\n+/).filter((t) => t.trim())) {
      body.push(p(par.trim(), { align: 'justified', spacingAfter: 240 }));
    }

    // ── Imágenes de evidencia ─────────────────────────────────────────────────
    const imageRels: string[] = [];
    // IDs numéricos de docPr únicos. Arranco alto para no colisionar con los del
    // membrete (typical rId/docPr bajos están reservados a header/footer/image).
    const DOCPR_BASE = 100;
    // Extensiones de imagen usadas en el documento — se registrarán en [Content_Types].xml
    const extensionesUsadas = new Set<string>();
    let imgCount = 0;

    for (const imgUrl of imagenes) {
      imgCount++;
      try {
        const imgBuf = await this.fetchImageBuffer(imgUrl);
        if (!imgBuf) {
          this.logger.warn(`No se pudo descargar imagen ${imgCount}: ${imgUrl.substring(0, 80)}`);
          continue;
        }
        const ext      = detectImageExt(imgBuf);
        if (ext === 'unsupported') {
          this.logger.warn(`Imagen ${imgCount} omitida por formato no soportado en Word (${imgUrl.substring(0, 80)})`);
          continue;
        }
        const fileName = `evidencia_${imgCount}.${ext}`;
        const relId    = `rIdEv${imgCount}`;
        const docPrId  = DOCPR_BASE + imgCount;
        const { width, height } = getImageDimensions(imgBuf);
        const dims     = calcularDimensionesImagen(width, height);

        zip.addFile(`word/media/${fileName}`, imgBuf);
        extensionesUsadas.add(ext);
        imageRels.push(
          `<Relationship Id="${relId}" ` +
          `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
          `Target="media/${fileName}"/>`,
        );

        this.logger.log(
          `Imagen agregada: ${JSON.stringify({
            objectName: fileName,
            rId: relId,
            docPrId,
            cx: dims.cx,
            cy: dims.cy,
            bufferSize: imgBuf.length,
            extension: ext,
          })}`,
        );

        body.push(imageParaXml(relId, docPrId, ext, dims));
      } catch (err) {
        this.logger.warn(`Error incluyendo imagen ${imgCount}: ${(err as Error).message}`);
      }
    }

    // ── SOLICITUD ─────────────────────────────────────────────────────────────
    body.push(p('SOLICITUD', { bold: true, align: 'center', spacingAfter: 240 }));

    const { dependenciasEstructuradas } = input;
    const hayMultipleDep = depList.length > 1;

    if (hayMultipleDep && dependenciasEstructuradas && dependenciasEstructuradas.length > 1) {
      // Sub-bloques por dependencia cuando tenemos solicitudes específicas
      for (let i = 0; i < dependenciasEstructuradas.length; i++) {
        const dep = dependenciasEstructuradas[i];
        body.push(p(`A la ${dep.nombre}:`, { bold: true, align: 'justified', spacingAfter: 120 }));
        body.push(p(`1. ${dep.solicitudEspecifica}`, { align: 'justified', spacingAfter: 120 }));
        if (i === 0) {
          body.push(p(
            '2. Que se garantice respuesta oportuna conforme al artículo 30 de la Ley 1755 de 2015.',
            { align: 'justified', spacingAfter: 240 },
          ));
        } else {
          const principal = dependenciasEstructuradas[0].nombre;
          body.push(p(
            `2. Que se informe sobre las acciones coordinadas con ${principal} para atender la situación.`,
            { align: 'justified', spacingAfter: 240 },
          ));
        }
      }
      if (solicitudAdicional?.trim()) {
        body.push(p('Solicitud adicional del ciudadano:', { bold: true, align: 'justified', spacingAfter: 120 }));
        body.push(p(solicitudAdicional.trim(), { align: 'justified', spacingAfter: 180 }));
      }
    } else {
      // Flujo estándar: una sola dependencia
      const solicitudes = [
        `1. Que se realice una visita en el lugar ya mencionado con el fin de verificar la situación reportada.`,
        `2. Que se informe sobre las acciones a implementar por parte de ${depList[0] ?? depStr} para dar solución efectiva a la problemática planteada.`,
        `3. Que se garantice una respuesta oportuna conforme a los términos establecidos en el artículo 30 de la Ley 1755 de 2015, que establece un término máximo de diez (10) días para responder solicitudes entre autoridades.`,
      ];
      if (solicitudAdicional?.trim()) {
        solicitudes.push(`4. ${solicitudAdicional.trim()}`);
      }
      for (const sol of solicitudes) {
        body.push(p(sol, { align: 'justified', spacingAfter: 180 }));
      }
    }

    // ── Cierre legal ──────────────────────────────────────────────────────────
    body.push(p('', { spacingAfter: 120 }));
    body.push(p(
      'Agradezco de antemano su pronta respuesta a esta solicitud, la cual realizo en ejercicio de mis funciones como Concejal. Es importante resaltar que la información solicitada es de acceso público, ya que no está sujeta a reserva sumarial. Asimismo, conforme al artículo 32, numeral 2, de la Ley 136 de 1994, los Concejos Municipales tienen la facultad de requerir informes escritos a los funcionarios municipales sobre asuntos relacionados con la marcha del Municipio.',
      { align: 'justified', spacingAfter: 240 },
    ));
    body.push(p(
      'De igual manera, de acuerdo con lo establecido en el artículo 30 de la Ley 1755 de 2015: "Cuando una autoridad formule una solicitud de información o de documentos a otra, esta deberá dar respuesta en un término no mayor a diez (10) días".',
      { align: 'justified', spacingAfter: 480 },
    ));
    body.push(p(
      'Notificación: Recibo la notificación y correspondencia en las instalaciones del Concejo de Medellín, o por medio magnético a mi correo electrónico: atobon@concejodemedellin.gov.co',
      { align: 'justified', spacingAfter: 720 },
    ));

    // ── Firma (compatible Mercurio) ───────────────────────────────────────────
    // Arial 11 (sz=22) para nombre/cargo, alineado izquierda, placeholders
    const FONT_FIRMA = 'Arial';
    const SZ_FIRMA   = 22; // 11pt
    const SZ_RADICO  = 18; // 9pt

    body.push(p('Atentamente,', { align: 'left', spacingAfter: 200, font: FONT_FIRMA, size: SZ_FIRMA }));
    body.push(signatureTableXml());
    body.push(p('', { spacingAfter: 80 }));
    body.push(p('FIRMA_NOMBRE', { align: 'left', spacingAfter: 0,   font: FONT_FIRMA, size: SZ_FIRMA }));
    body.push(p('FIRMA_CARGO',  { align: 'left', spacingAfter: 300, font: FONT_FIRMA, size: SZ_FIRMA }));
    body.push(p('Radicó: ',     { align: 'left', spacingAfter: 400, font: FONT_FIRMA, size: SZ_RADICO, italic: true, color: '666666' }));

    // ── Reconstruir document.xml ──────────────────────────────────────────────
    const newDocXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `${openTag}<w:body>${body.join('')}${sectPr}</w:body></w:document>`;

    zip.updateFile('word/document.xml', Buffer.from(newDocXml, 'utf8'));

    // ── Actualizar relaciones si hay imágenes ─────────────────────────────────
    if (imageRels.length > 0) {
      const relsXml    = zip.readAsText('word/_rels/document.xml.rels');
      const newRelsXml = relsXml.replace('</Relationships>', imageRels.join('') + '</Relationships>');
      zip.updateFile('word/_rels/document.xml.rels', Buffer.from(newRelsXml, 'utf8'));
    }

    // Registrar Content-Types para extensiones de imagen usadas (evita "No se puede mostrar")
    if (extensionesUsadas.size > 0) {
      const ctPath = '[Content_Types].xml';
      const ctXml  = zip.readAsText(ctPath);
      // Map extensiones a ContentTypes MIME
      const CT_MAP: Record<string, string> = {
        jpeg: 'image/jpeg',
        jpg:  'image/jpeg',
        png:  'image/png',
      };
      let nuevoCtXml = ctXml;
      for (const ext of extensionesUsadas) {
        const contentType = CT_MAP[ext];
        if (!contentType) continue;
        // Si ya existe un Default para esta extensión, no duplicar
        const yaExiste = new RegExp(`<Default\\s+Extension="${ext}"`, 'i').test(nuevoCtXml);
        if (yaExiste) continue;
        const tag = `<Default Extension="${ext}" ContentType="${contentType}"/>`;
        nuevoCtXml = nuevoCtXml.replace('</Types>', `${tag}</Types>`);
      }
      if (nuevoCtXml !== ctXml) {
        zip.updateFile(ctPath, Buffer.from(nuevoCtXml, 'utf8'));
      }
    }

    // ── Escribir archivo de salida ────────────────────────────────────────────
    await writeFile(rutaDestino, zip.toBuffer());
    this.logger.log(`Documento construido: ${rutaDestino}`);
  }
}
