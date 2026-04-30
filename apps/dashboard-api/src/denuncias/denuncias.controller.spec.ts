import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { DenunciasController } from './denuncias.controller';
import { DenunciasService } from './denuncias.service';
import { GcsStorageService } from '@app/storage';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    const map: Record<string, string> = {
      GCS_BUCKET_DOCUMENTOS: 'denunciasat-documentos',
      DASHBOARD_TO_DOCUMENT_KEY: 'test-key',
      DASHBOARD_API_INTERNAL_KEY: 'fallback-key',
      DOCUMENT_SERVICE_URL: 'http://document-service:3004',
    };
    return map[key] ?? def ?? '';
  }),
};

const mockDenunciasService = {
  findOne: jest.fn(),
  marcarDocumentoPendiente: jest.fn(),
  create: jest.fn(),
  createManual: jest.fn(),
  createIncompleta: jest.fn(),
  upsertParcial: jest.fn(),
  getDependencias: jest.fn(),
  findAll: jest.fn(),
  findEspeciales: jest.fn(),
  findDatosUsuarioPorTelefono: jest.fn(),
  findParcialPorTelefono: jest.fn(),
  update: jest.fn(),
  updateEstado: jest.fn(),
  editarDenuncia: jest.fn(),
  eliminarDenuncia: jest.fn(),
  cancelarParcial: jest.fn(),
};

const mockGcsStorage = {
  getSignedUrl: jest.fn(),
  uploadBuffer: jest.fn(),
};

describe('DenunciasController — descarga de documento', () => {
  let controller: DenunciasController;

  const fakeRes = {
    set: jest.fn(),
    send: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DenunciasController],
      providers: [
        { provide: DenunciasService, useValue: mockDenunciasService },
        { provide: GcsStorageService, useValue: mockGcsStorage },
        { provide: ConfigService, useValue: mockConfig },
        // JwtService requerido por EitherAuthGuard
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
      ],
    }).compile();

    controller = module.get<DenunciasController>(DenunciasController);
  });

  it('debe devolver el .docx cuando documentoUrl está seteado', async () => {
    const fakeBuffer = Buffer.from('fake-docx-content');
    mockDenunciasService.findOne.mockResolvedValue({
      id: 1,
      radicado: 'DAT-000001',
      documentoUrl: 'DAT-000001.docx',
    });
    mockGcsStorage.getSignedUrl.mockResolvedValue('https://storage.googleapis.com/signed-url');
    mockedAxios.get = jest.fn().mockResolvedValue({ data: fakeBuffer.buffer });

    await controller.descargarDocumento(1, fakeRes as any);

    expect(mockGcsStorage.getSignedUrl).toHaveBeenCalledWith('denunciasat-documentos', 'DAT-000001.docx');
    expect(fakeRes.set).toHaveBeenCalledWith(expect.objectContaining({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="DAT-000001.docx"',
    }));
    expect(fakeRes.send).toHaveBeenCalled();
  });

  it('debe lanzar 404 cuando documentoUrl es null', async () => {
    mockDenunciasService.findOne.mockResolvedValue({
      id: 2,
      radicado: 'DAT-000002',
      documentoUrl: null,
    });

    try {
      await controller.descargarDocumento(2, fakeRes as any);
      fail('debería haber lanzado HttpException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(404);
    }
  });

  it('debe lanzar 503 cuando GCS falla al generar signed URL', async () => {
    mockDenunciasService.findOne.mockResolvedValue({
      id: 3,
      radicado: 'DAT-000003',
      documentoUrl: 'DAT-000003.docx',
    });
    mockGcsStorage.getSignedUrl.mockRejectedValue(new Error('IAM credentials error'));

    try {
      await controller.descargarDocumento(3, fakeRes as any);
      fail('debería haber lanzado HttpException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(503);
    }
  });

  it('debe lanzar 404 cuando la denuncia no existe', async () => {
    mockDenunciasService.findOne.mockRejectedValue(new Error('Not found'));

    try {
      await controller.descargarDocumento(99, fakeRes as any);
      fail('debería haber lanzado HttpException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(404);
    }
  });
});
