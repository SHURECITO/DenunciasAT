# Configuración del pipeline CI/CD — DenunciasAT

## Secrets requeridos en GitHub (Settings → Secrets → Actions)

| Secret | Descripción |
|--------|-------------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Provider Workload Identity Federation (recomendado sobre SA key) |
| `GCP_SERVICE_ACCOUNT` | Email del service account de deploy |
| `GCP_VM_INSTANCE` | Nombre de la instancia VM en GCP |
| `GCP_VM_ZONE` | Zona de la VM (ej: `us-central1-a`) |
| `GCP_SSH_PRIVATE_KEY` | Clave privada SSH para acceso a la VM |
| `APP_PUBLIC_URL` | URL pública de la API (ej: `https://api.tudominio.com`) |

## Variables de repositorio (Settings → Variables → Actions)

| Variable | Valor ejemplo |
|----------|---------------|
| `GCP_PROJECT_ID` | `mi-proyecto-gcp` |
| `GCP_REGION` | `us-central1` |

## Prerrequisitos en GCP

### 1. Crear Artifact Registry
```bash
gcloud artifacts repositories create denunciasat \
  --repository-format=docker \
  --location=us-central1 \
  --description="Imágenes DenunciasAT"
```

### 2. Service Account con permisos mínimos
```bash
SA_NAME="denunciasat-deploy"
gcloud iam service-accounts create ${SA_NAME}

# Permisos: push a Artifact Registry + acceso SSH a VM
gcloud projects add-iam-policy-binding ${GCP_PROJECT_ID} \
  --member="serviceAccount:${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding ${GCP_PROJECT_ID} \
  --member="serviceAccount:${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/compute.osLogin"
```

### 3. Workload Identity Federation (sin SA key file)
```bash
# Crear pool
gcloud iam workload-identity-pools create "github-pool" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Crear provider
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Vincular SA con el repositorio GitHub
gcloud iam service-accounts add-iam-policy-binding \
  "${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/Shurecito/DenunciasAT"
```

### 4. VM: autenticar Docker con Artifact Registry
```bash
# En la VM, al hacer setup inicial:
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### 5. GCS privado con Signed URLs
No usar `key.json`. Los servicios deben correr con ADC y un service account asignado.

```bash
# Ejecutar una sola vez en el proyecto GCP
RUNTIME_SA="denunciasat-runtime"
gcloud services enable iamcredentials.googleapis.com

# Permisos del service account runtime para objetos y firma IAM
gcloud storage buckets add-iam-policy-binding gs://denunciasat-evidencias \
  --member="serviceAccount:${RUNTIME_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
gcloud storage buckets add-iam-policy-binding gs://denunciasat-documentos \
  --member="serviceAccount:${RUNTIME_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts add-iam-policy-binding \
  "${RUNTIME_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${RUNTIME_SA}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Quitar acceso publico si existia
gcloud storage buckets remove-iam-policy-binding gs://denunciasat-evidencias \
  --member=allUsers \
  --role=roles/storage.objectViewer
gcloud storage buckets remove-iam-policy-binding gs://denunciasat-documentos \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

### 6. .env en la VM
El archivo `.env` debe existir en `/opt/denunciasat/.env` con todos los secretos reales.
Se puede poblar desde Secret Manager con el script `setup-secrets.sh`.

## Rollback manual
```bash
# En la VM:
cd /opt/denunciasat
IMAGE_TAG=<SHA_ANTERIOR> docker compose -f docker-compose.prod.yml up -d
```
