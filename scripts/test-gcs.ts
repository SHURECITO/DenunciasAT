/**
 * Script de prueba de integración con Google Cloud Storage.
 * Uso: npx ts-node scripts/test-gcs.ts
 * Requiere: GOOGLE_APPLICATION_CREDENTIALS o ADC configurado, y GCP_PROJECT_ID.
 */
import { Storage } from '@google-cloud/storage';

const PROJECT_ID    = process.env.GCP_PROJECT_ID ?? '';
const BUCKET_NAME   = process.env.GCS_BUCKET_DOCUMENTOS ?? 'denunciasat-documentos';
const TEST_OBJECT   = `test-gcs-${Date.now()}.txt`;
const TEST_CONTENT  = Buffer.from('Prueba de integración GCS — DenunciasAT');

async function main() {
  const storage = new Storage({ projectId: PROJECT_ID });
  const bucket  = storage.bucket(BUCKET_NAME);

  // 1. Upload
  console.log(`Subiendo ${TEST_OBJECT} a ${BUCKET_NAME}...`);
  await bucket.file(TEST_OBJECT).save(TEST_CONTENT, { contentType: 'text/plain', resumable: false });
  console.log('✔ upload ok');

  // 2. URL firmada
  const [url] = await bucket.file(TEST_OBJECT).getSignedUrl({
    action: 'read',
    expires: Date.now() + 60_000,
  });
  console.log(`✔ url ok → ${url.slice(0, 80)}...`);

  // 3. Download y verificación
  const [data] = await bucket.file(TEST_OBJECT).download();
  if (data.toString() !== TEST_CONTENT.toString()) throw new Error('Contenido descargado no coincide');
  console.log('✔ download ok');

  // 4. Delete
  await bucket.file(TEST_OBJECT).delete();
  console.log('✔ delete ok');

  console.log('\n✅ Integración GCS funcionando correctamente.');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
