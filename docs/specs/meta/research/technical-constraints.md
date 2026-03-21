# Technical Constraints: Adaptación Contextual CV + Carta a Oferta

**Fecha**: 2026-03-21
**Researcher**: Poncho (Technical Architect)
**Status**: Fase 0 - Divergencia

---

## 1. Resumen Ejecutivo

La feature requiere tres capacidades núcleo:
1. **Parseo de CV** (PDF/DOCX/TXT) → texto estructurado
2. **Análisis de oferta laboral** → extracción de requisitos, keywords, cultura
3. **Generación de carta** → síntesis contextualizada via LLM

**Veredicto técnico**: VIABLE con componentes externos. No hay document processing existente en el codebase.

---

## 2. Análisis por Componente

### 2.1 LLM Gateway (EXISTE - `src/features/llm-gateway/`)

| Aspecto | Estado |
|---------|--------|
| Providers | Gemini, OpenAI, Opencode, Codex, Arctic |
| Interfaces | `ChatRequest`, `ChatResponse` en `gateway.types.ts` |
| Server | HTTP API en `api/server.ts` |

**Reutilización**: SÍ. La carta de presentación se genera через el gateway existente.

### 2.2 Document Parsing (NO EXISTE - requiere integración)

| Formato | Solución Recomendada |
|---------|---------------------|
| PDF | `pdf-parse` (Node.js) o `pdf.js` |
| DOCX | `mammoth.js` |
| TXT | nativo Node.js `fs` |

**Constraint**: El parsing debe happening en backend (no hay superficie frontend para esto aún).

### 2.3 Almacenamiento de CV (NO DEFINIDO)

- Sin schema existente para CVs en SQLite
- Sin servicio de storage (local filesystem vs cloud storage S3/GCS)

**Pregunta abierta**: ¿Los CVs se persisten o solo se procesan en streaming?

---

## 3. Restricciones Técnicas Identificadas

### 3.1 Límites de Contexto

| Provider | Contexto Max | Implicación |
|----------|--------------|-------------|
| Gemini 1.5 | 1M tokens | CV largo caben en contexto único |
| GPT-4o | 128k tokens | CV largo requiere chunking |
| MiniMax-M2.7 | 32k tokens | REQUIERE chunking/summarization |

**Recomendación**: Usar Gemini 1.5 Pro para esta feature (contexto de 1M tokens).

### 3.2 Rate Limits

| Provider | Límite | Impacto |
|----------|--------|---------|
| Gemini | 60 req/min (free) | Suficiente para uso individual |
| OpenAI | 500 req/min (tier 1) | Suficiente |
| Arctic | ? | Verificar |

### 3.3 Dependencias a Agregar

```json
{
  "pdf-parse": "^1.1.1",
  "mammoth": "^1.6.0"
}
```

### 3.4 Infraestructura Faltante

1. **File Upload API**: No existe endpoint para recibir archivos
2. **Blob Storage**: No hay integración con S3/GCS/local fs
3. **CV Schema**: No hay TypeScript types para Curriculum estructurado

---

## 4. Arquitectura Preliminar (On-device vs Cloud)

| Criterio | Decisión |
|----------|----------|
| Processing | Cloud (requiere LLM con contexto largo) |
| Storage CV | Local SQLite + filesystem |
| Upload | HTTP multipart (api existente) |

---

## 5. Inventory: master | ramas | local | faltante

| Componente | Estado |
|------------|--------|
| LLM Gateway | master ✅ |
| Document Parsing | **FALTANTE** |
| CV Schema/Types | **FALTANTE** |
| File Upload API | **FALTANTE** |
| Blob Storage | **FALTANTE** |
| Feature Spec | **FALTANTE** |

---

## 6. Preguntas Abiertas (para Moncho/PRD)

1. ¿Se persiste el CV en BD o solo se procesa y se descarta?
2. ¿El usuario sube el CV via Telegram, web, o API?
3. ¿La oferta laboral viene como texto libre o URL a parsear?
4. ¿Cuál es el formato esperado de salida? (PDF, texto, Telegram message)

---

## 7. Path Canonico Propuesto

```
src/features/cv-contextualizer/
├── api/
│   └── upload.route.ts       # Endpoint multipart
├── services/
│   ├── parser.service.ts     # PDF/DOCX → texto
│   └── generator.service.ts  # LLM → carta
├── types/
│   └── cv.types.ts          # CVSchema, OfferSchema
├── mocks/
│   └── cv.mock.ts           # Mock para desarrollo
└── storage/
    └── cv.store.ts          # Persistencia SQLite
```

---

## 8. Contract-First: Bead 0 (REQUIRED)

Antes de implementar beads paralelos, crear:

1. `src/features/cv-contextualizer/types/cv.types.ts` - Interfaces mínimas
2. `src/features/cv-contextualizer/mocks/cv.mock.ts` - Mock del parser y generator

---

**He dejado los límites técnicos en** `docs/specs/meta/research/technical-constraints.md`.
