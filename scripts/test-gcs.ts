/**
 * Script de prueba de integracion con Google Cloud Storage.
 * Uso: npx ts-node scripts/test-gcs.ts
 * Requiere ADC configurado, GCP_PROJECT_ID y permisos IAM para firmar URLs.
 */
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const BUCKET_NAME = process.env.GCS_BUCKET_DOCUMENTOS ?? 'denunciasat-documentos';
const TEST_OBJECT = `test-gcs-${Date.now()}.txt`;
const TEST_CONTENT = Buffer.from('Prueba de integracion GCS - DenunciasAT');

async function main() {
  const storage = new Storage({
    projectId: PROJECT_ID,
  });
  const bucket = storage.bucket(BUCKET_NAME);
  const file = bucket.file(TEST_OBJECT);

  try {
    await file.save(TEST_CONTENT, {
      contentType: 'text/plain',
      resumable: false,
    });
    console.log('✔ upload ok');

    let signedUrl: string;
    try {
      [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
      });
    } catch {
      throw new Error('No se puede generar signed URL. Verificar IAM y ADC.');
    }
    console.log('✔ signed url ok');

    const response = await fetch(signedUrl);
    if (response.status !== 200) {
      throw new Error(`Fetch de signed URL fallo con status ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.equals(TEST_CONTENT)) {
      throw new Error('Contenido descargado no coincide');
    }
    console.log('✔ fetch ok');
  } finally {
    await file.delete({ ignoreNotFound: true });
    console.log('✔ delete ok');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
