import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import axios from 'axios';
import { MinioService } from '@app/storage';
import type { DenunciaData } from './dashboard-api.service';

import AdmZip = require('adm-zip');

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

export interface BuildInput {
  denuncia:          DenunciaData;
  hechos:            string;
  asunto:            string;
  solicitudAdicional?: string;
  imagenes:          string[];
  rutaDestino:       string;
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
}

/** Genera un párrafo OOXML simple con un solo run de texto */
function p(text: string, opts: ParaOpts = {}): string {
  const { bold = false, italic = false, align = 'left', spacingAfter = 120, size = SZ } = opts;
  const jc   = JC_MAP[align];
  const bTag = bold   ? '<w:b/><w:bCs/>' : '';
  const iTag = italic ? '<w:i/><w:iCs/>' : '';
  const rpr  = `<w:rPr>${bTag}${iTag}<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const ppr  = `<w:pPr><w:spacing w:after="${spacingAfter}" w:line="240" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>`;
  if (!text) {
    return `<w:p>${ppr}</w:p>`;
  }
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xe(text)}</w:t></w:r></w:p>`;
}

/** Párrafo de ASUNTO: "ASUNTO: " en negrita + texto normal */
function asuntoP(asunto: string): string {
  const ppr  = `<w:pPr><w:spacing w:after="240" w:line="240" w:lineRule="auto"/></w:pPr>`;
  const rprB = `<w:rPr><w:b/><w:bCs/><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:sz w:val="${SZ}"/><w:szCs w:val="${SZ}"/></w:rPr>`;
  const rprN = `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:sz w:val="${SZ}"/><w:szCs w:val="${SZ}"/></w:rPr>`;
  return `<w:p>${ppr}<w:r>${rprB}<w:t xml:space="preserve">ASUNTO: </w:t></w:r><w:r>${rprN}<w:t xml:space="preserve">${xe(asunto)}</w:t></w:r></w:p>`;
}

// ─── Imágenes ─────────────────────────────────────────────────────────────────
const MAX_WIDTH_EMU  = 5486400; // ≈ 6 pulgadas
const MAX_HEIGHT_EMU = 4114800; // ≈ 4.5 pulgadas

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

/** Determina la extensión de la imagen por la URL */
function imageExt(url: string): 'png' | 'jpg' {
  return url.toLowerCase().includes('.png') ? 'png' : 'jpg';
}

/** Lee dimensiones de JPEG o PNG desde los bytes del header */
function imageDims(buf: Buffer, ext: string): { cx: number; cy: number } {
  let width = 0;
  let height = 0;

  try {
    if (ext === 'png' && buf.length >= 24) {
      const sig = buf.slice(0, 8).toString('hex');
      if (sig === '89504e470d0a1a0a') {
        width  = buf.readUInt32BE(16);
        height = buf.readUInt32BE(20);
      }
    } else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 4 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const segLen = buf.readUInt16BE(i + 2);
        if ([0xc0, 0xc1, 0xc2].includes(marker) && i + 9 < buf.length) {
          height = buf.readUInt16BE(i + 5);
          width  = buf.readUInt16BE(i + 7);
          break;
        }
        i += 2 + segLen;
      }
    }
  } catch { /* fall through */ }

  if (width <= 0 || height <= 0) {
    // Fallback: proporción 4:3 landscape
    return { cx: MAX_WIDTH_EMU, cy: Math.round(MAX_WIDTH_EMU * 3 / 4) };
  }

  // Escalar respetando máximos tanto de ancho como de alto (portrait handling)
  let cx = Math.min(width * 9525, MAX_WIDTH_EMU);
  let cy = Math.round(cx * height / width);

  if (cy > MAX_HEIGHT_EMU) {
    cy = MAX_HEIGHT_EMU;
    cx = Math.round(cy * width / height);
  }

  return { cx, cy };
}

/** Genera el XML de un párrafo con imagen inline */
function imageParaXml(relId: string, num: number, dims: { cx: number; cy: number }): string {
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
    `<pic:cNvPr id="${num}" name="evidencia_${num}.jpg"/>` +
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
let _depsCache: Record<string, Destinatario> | null = null;

function loadDeps(): Record<string, Destinatario> {
  if (_depsCache) return _depsCache;
  try {
    _depsCache = JSON.parse(readFileSync(DEPS_PATH, 'utf8')) as Record<string, Destinatario>;
  } catch {
    _depsCache = {};
  }
  return _depsCache;
}

function resolveDestinatario(dependencia: string): Destinatario {
  const deps = loadDeps();
  if (deps[dependencia]) return deps[dependencia];
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

  constructor(private readonly minio: MinioService) {}

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
    return downloadImageFromUrl(url);
  }

  async construir(input: BuildInput): Promise<void> {
    const { denuncia, hechos, asunto, solicitudAdicional, imagenes, rutaDestino } = input;
    mkdirSync(dirname(rutaDestino), { recursive: true });

    // Cargar plantilla como ZIP
    const zip = new AdmZip(TEMPLATE_PATH);

    // Extraer el opening tag y el sectPr del document.xml original
    const originalDocXml = zip.readAsText('word/document.xml');
    const openTagMatch   = originalDocXml.match(/^<w:document[^>]*(?:>|\s*\/>)/);
    const openTag        = openTagMatch?.[0] ?? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
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
    let imgCount = 0;

    for (const imgUrl of imagenes) {
      imgCount++;
      try {
        const imgBuf = await this.fetchImageBuffer(imgUrl);
        if (!imgBuf) {
          this.logger.warn(`No se pudo descargar imagen ${imgCount}: ${imgUrl.substring(0, 80)}`);
          continue;
        }
        const ext      = imageExt(imgUrl);
        const fileName = `evidencia_${imgCount}.${ext}`;
        const relId    = `rIdEv${imgCount}`;
        const dims     = imageDims(imgBuf, ext);

        zip.addFile(`word/media/${fileName}`, imgBuf);
        imageRels.push(
          `<Relationship Id="${relId}" ` +
          `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
          `Target="media/${fileName}"/>`,
        );

        body.push(imageParaXml(relId, imgCount, dims));
        body.push(p(`Evidencia fotográfica ${imgCount} aportada al despacho del concejal`, {
          align: 'center', italic: true, size: 20, spacingAfter: 240,
        }));
      } catch (err) {
        this.logger.warn(`Error incluyendo imagen ${imgCount}: ${(err as Error).message}`);
      }
    }

    // ── SOLICITUD ─────────────────────────────────────────────────────────────
    body.push(p('SOLICITUD', { bold: true, align: 'center', spacingAfter: 240 }));

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

    // ── Firma ─────────────────────────────────────────────────────────────────
    body.push(p('Atentamente,', { align: 'center', spacingAfter: 960 }));
    body.push(p('ANDRÉS FELIPE TOBÓN VILLADA', { bold: true, align: 'center', spacingAfter: 60 }));
    body.push(p('Concejal de Medellín', { align: 'center', spacingAfter: 240 }));

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

    // ── Escribir archivo de salida ────────────────────────────────────────────
    await writeFile(rutaDestino, zip.toBuffer());
    this.logger.log(`Documento construido: ${rutaDestino}`);
  }
}
