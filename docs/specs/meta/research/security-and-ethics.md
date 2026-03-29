# Security & Ethics Research: Adaptación Contextual CV+Carta a Oferta

> **Fecha:** 2026-03-21
> **Auditor:** Ralphito (Mapito) - Security & Ethics
> **Proyecto:** Adaptación contextual CV+carta a oferta
> **Versión:** 1.0 - FASE DIVERGENCIA

---

## 1. Descripción del Proyecto

**Nombre:** AdaptiveCV
**Función:** Sistema que toma un CV y carta de presentación del usuario junto con una oferta laboral, y genera versiones adaptadas de ambos documentos optimizadas para la posición.

**Flujo de datos:**
1. Usuario provee CV (PDF/DOCX) y carta de presentación
2. Usuario provee o pega contenido de oferta laboral
3. Sistema extrae entidades (skills, experiencia, requisitos)
4. Motor LLM genera versiones adaptadas de CV y carta
5. Usuario recibe documentos output

---

## 2. Taxonomía de Riesgos de Privacidad

### 2.1 GDPR (Reglamento General de Protección de Datos)

| Riesgo | Descripción | Severidad |
|--------|-------------|-----------|
| **R1: PII en CV** | CV contiene datos personales sensibles (DNI, dirección, teléfono, historial laboral) | ALTA |
| **R2: Retention indefinda** | Almacenar CV en servidores elimina derecho de eliminación del usuario | CRÍTICA |
| **R3: Third-party LLM** | Enviar CV a APIs de terceros (OpenAI, Anthropic) implica Processor Binding contractual | ALTA |
| **R4: Logging masivo** | Logs de sistema podrían contener PII extraída sin sanitización | MEDIA |
| **R5: Metadata leakage** | Metadatos de PDF/DOCX pueden contener автор, versión, rutas locales | MEDIA |

### 2.2 EU AI Act (Reglamento de Inteligencia Artificial)

| Clasificación | El sistema es categorizable como: **AI Act Annex III, punto 4** (IA que interactúa con humanos para toma de decisiones sobre empleo)

| Requisito | Applicable | Status |
|-----------|------------|--------|
| Transparencia: usuario sabe que es IA | ✅ Sí | Requerido |
| Bias testing en datos de entrenamiento | ⚠️ Parcial | LLM externo, no controlamos training |
| Derecho a explicación | ⚠️ Limitado | Prompt engineering puede mitigar |
| Auditoría de decisiones automatizadas | ⚠️ Difícil | LLM es opaco por naturaleza |

### 2.3 Riesgo Éptico Específico del Dominio

| Riesgo | Descripción |
|--------|-------------|
| **E1: Fantasía de contratación** | Sistema puede generar CV que represente habilidades ficticias, induciendo a fraude |
| **E2: Discrimination amplification** | LLM puede amplificar sesgos de género/raza presentes en datos de entrenamiento |
| **E3: Doxing accidental** | Extraer y recombinar información puede revelar datos que el usuario no quiere compartir |
| **E4: Dependency lock** | Sistema puede crear ansiedad laboral si usuario depende de él para toda aplicación |

---

## 3. Límites Éticos INNEGOCIABLES

> **Qué el sistema NUNCA hará:**

| # | Límite | Justificación |
|---|--------|---------------|
| **L1** | NO generará skills o experiencia ficticia que el usuario no posea | Fraude a empleadores; exposición legal |
| **L2** | NO almacenará CVs en servidores propios más de 24h | GDPR Art. 17 - Right to erasure |
| **L3** | NO enviará PII sin cifrado E2EE a terceros | Data minimization principle |
| **L4** | NO utilizará datos del usuario para entrenar modelos | Consentimiento informado no obtenible |
| **L5** | NO revelará identidad del usuario a terceros sin consentimiento explícito | GDPR Art. 6 - Lawfulness |
| **L6** | NO generará versiones que omitan brechas laborales de forma engañosa | Integridad del proceso de contratación |
| **L7** | NO usará información personal sensible (salud, creencias, afiliación política) para filtering | EU AI Act Art. 10 - Prohibited practices |
| **L8** | NO dará garantía de éxito de contratación | Responsabilidad del usuario sobre su carrera |

---

## 4. Estrategia de Protección de Datos

### 4.1 Arquitectura de Procesamiento

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENTE (Browser/App)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   CV Input  │  │ Offer Input  │  │  Sanitization UI  │  │
│  │ (local)     │  │ (local/paste) │  │  (PII warning)    │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │               │                     │              │
│         └───────────────┼─────────────────────┘              │
│                         │                                    │
│              ┌──────────▼──────────┐                       │
│              │  Local Preprocessor  │                       │
│              │  - PII detection      │                       │
│              │  - Format extraction  │                       │
│              │  - Encryption key gen │                       │
│              └──────────┬────────────┘                       │
│                         │ E2EE payload                        │
└─────────────────────────┼─────────────────────────────────────┘
                          │ HTTPS + E2EE envelope
                          ▼
               ┌──────────────────────┐
               │   LLM Gateway        │
               │   (no decryption)   │
               │   - Only encrypted  │
               │     blobs pass through│
               └──────────────────────┘
                          │ Decrypts only
                          │ in memory
                          ▼
               ┌──────────────────────┐
               │   Output Generation │
               │   (client-side)     │
               └──────────────────────┘
```

### 4.2 Matriz de Control por Fase

| Fase | Datos en tránsito | Datos en uso | Datos en reposo |
|------|-------------------|--------------|-----------------|
| Input CV | HTTPS | Memory only | NONE (no storage) |
| LLM Processing | E2EE envelope | RAM only | NONE |
| Output | HTTPS | Memory → user | NONE |
| Logs | Pseudonymized | N/A | 30 days max |

### 4.3 Requisitos de Cifrado

| Requisito | Implementación |
|-----------|----------------|
| **E2EE hacia LLM** | Client-side encryption with per-session key; LLM sees only encrypted prompt envelope |
| **TLS 1.3 mínimo** | In transit; no exceptions |
| **Key management** | Session-derived keys only; no persistent key storage server-side |
| **Zero-knowledge proof** | Gateway cannot decrypt user data; only process |

---

## 5. Modelo de Amenazas

### 5.1 Actor: Usuario Malicioso

| Amenaza | Vector | Impacto | Contramedida |
|---------|--------|---------|--------------|
| M1: Injección de prompt | Embed malicious instructions in CV | LLM manipulation | Input sanitization; prompt isolation |
| M2: Exfiltración de datos ajenos | Upload someone else's CV | Privacy violation | PII watermark detection; consent verification |
| M3: Abuso de rate limits | Mass generation for spam | Resource exhaustion | Rate limiting; per-user quotas |

### 5.2 Actor: Gateway/Infraestructura

| Amenaza | Vector | Impacto | Contramedida |
|---------|--------|---------|--------------|
| M4: Log poisoning | Accidentally log PII | GDPR violation | Automated PII detection in logs; DLP |
| M5: Model inversion | Reconstruct training data from outputs | IP leakage | Output filtering; differential privacy |
| M6: Provider lock-in risk | Dependence on single LLM API | Vendor risk | Abstraction layer; multiple providers |

### 5.3 Actor: Empleador/Receptor

| Amenaza | Vector | Impacto | Contramedida |
|---------|--------|---------|--------------|
| M7: CV falsificado detectado | Skills that don't match interview | Reputation damage | Watermark "AI-assisted"; ethical labeling |
| M8: Discriminación algorítmica | Employer uses AI to filter candidates unfairly | Legal liability | Audit trail; explainability flags |

---

## 6. Controles de Seguridad Requeridos

### 6.1 Para el Equipo de Desarrollo (Backend Team)

```
REQ-001: Toda comunicación con LLM DEBE usar cifrado de envelope
REQ-002: NO persistencia de CV en ninguna forma (DB, file, cache)
REQ-003: Logs DEBEN ser sanitizados automáticamente (PII redaction)
REQ-004: Tokens API nunca en código; usar vault/env vars exclusivamente
REQ-005: Validación de inputs para prevenir injection attacks
REQ-006: Rate limiting por usuario, no por IP (evitar bypass con VPN)
```

### 6.2 Para el Equipo de Frontend

```
REQ-007: Disclaimer visible antes de subir CV: "Este documento se procesa localmente y nunca se almacena en servidores"
REQ-008: Opción de eliminar/descartar sesión de forma inmediata
REQ-009: Indicador visual de "E2EE activo" durante procesamiento
REQ-010: No autofill de datos sensibles desde browser storage
```

### 6.3 Para QA (Ricky/Juez)

```
REQ-011: Test de penetration con CVs que contengan PII simulada
REQ-012: Verificar que logs no contengan DNI, teléfonos, emails
REQ-013: Test de rate limiting con 1000 requests concurrentes
REQ-014: Audit de dependencias para vulnerabilidad conocidas
```

---

## 7. Checklist de Auditoría Pre-Launch

| Item | Descripción | Priority | Status |
|------|-------------|----------|--------|
| [ ] | GDPR Data Processing Agreement con proveedor LLM | CRITICAL | PENDING |
| [ ] | DPA Signed por todos los subprocesadores | CRITICAL | PENDING |
| [ ] | PII redaction en logs verificado | HIGH | PENDING |
| [ ] | No CV storage test (interceptar tráfico) | HIGH | PENDING |
| [ ] | E2EE implementation audit | HIGH | PENDING |
| [ ] | EU AI Act transparency notice implementada | MEDIUM | PENDING |
| [ ] | Bias testing en outputs (1000+ prompts) | MEDIUM | PENDING |
| [ ] | Right to erasure workflow documentado | MEDIUM | PENDING |
| [ ] | Security incident response plan | LOW | PENDING |

---

## 8. Recomendaciones

### 8.1 Arquitectura Recomendada

**Option A: On-Device Processing (más seguro)**
- LLM runs locally (Llama.cpp, WebLLM)
- Zero data leaves device
- Limitación: requiere hardware capaz

**Option B: Hybrid E2EE (recomendado)**
- Client encrypts CV with session key
- Gateway only sees encrypted blob
- LLM processes; result returns encrypted
- Client decrypts locally
- Trade-off: mayor complejidad pero datos protegidos

**Option C: Server-side with DPA (mínimo aceptable)**
- Traditional server processing
- Full DPA with LLM provider
- Data retention < 24h
- Only viable if DPA es enforceable

### 8.2 Decisión de Mapito

> **Para este proyecto, se recomienda OPCIÓN B (Hybrid E2EE)**.
> Opción A si el producto target son usuarios con hardware limitado.
> **NUNCA Opción C sin DPA válido.**

---

## 9. Firmas de Auditoría

| Rol | Nombre | Fecha | Veredicto |
|-----|--------|-------|-----------|
| Security & Ethics | Ralphito (Mapito) | 2026-03-21 | PENDIENTE DE IMPLEMENTACIÓN |
| Producto | (Pendiente Moncho) | - | - |
| Legal/DPO | (Pendiente) | - | - |

---

## 10. Historial de Cambios

| Versión | Fecha | Cambios |
|---------|-------|---------|
| 1.0 | 2026-03-21 | Documento inicial - Fase de Divergencia |

---

*Este documento es la fuente de verdad para seguridad y ética del proyecto. Cualquier implementación que viole los límites éticos innegociables (Sección 3) será bloqueada por Mapito en auditoría de beads.*
