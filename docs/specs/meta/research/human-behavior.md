# Human Behavior & Product Design: CV Adaptado + Carta

**Research Date:** 2026-03-21
**Role:** Lola (UI/UX Designer)
**Product:** Adaptación contextual CV+carta a oferta
**Target:** B2C junior/mid/senior, Freemium+subscription, Agentic AI

---

## 1. Psicología y Fricción

### ¿Cuál es la carga cognitiva de esta feature?

| Factor | Impacto | Detalle |
|--------|---------|---------|
| **Identidad profesional difusa** | ALTO | El usuario junior/mid aún no sabe qué "versión" de sí mismo presentar. Senior tiene el problema opuesto: demasiada experiencia, ¿cuál es la relevante? |
| **Parálisis por análisis** | ALTO | Ante una oferta, el usuario se pregunta "¿realmente calo?". Esto genera scroll infinito en otras plataformas, no acción. |
| **Culpa del "fake it till you make it"** | ALTO | El diferenciador "construye la versión que esta empresa quiere" puede sentirse como mentir. Necesita reframing. |
| **Ansiedad de rechazo** | MEDIO | El usuario teme que su CV "adaptado" se vea descubierto como genérico. Necesita sentir que el output es auténtico. |
| **Sobrecarga de información** | MEDIO | CV original + oferta + output adaptado = mucho texto. La UI debe simplificar, no agregar complejidad. |

### ¿Cómo evitamos la "trampa de la novedad" o el diseño basado en la culpa?

**Trampa a evitar:** Que el usuario sienta que su CV original "no sirve" y que necesita ser "arreglado" por la IA.

**Estrategias de diseño emocional:**

1. **Reframe de "adaptación" → "destacar"**
   - No "reescribimos tu CV", sino "resaltamos lo que ya tienes que esta empresa busca"
   - El usuario sigue siendo el protagonista; la IA solo contextualiza

2. **Transparencia sin exposed seams**
   - Mostrar *qué* se cambió y *por qué* (linking back to job posting), pero en UI tipo "diff" no intimidante
   - El usuario debe poder hacer undo/edit de cada adaptación

3. **Zero guilt messaging**
   - Evitar palabras como "mejorar", "corregir", "arreglar"
   - Usar: "contextualizar", "alinear", "destacar", "enfocar"

4. **Framing del diferenciador**
   - "Para esta oportunidad, construye la versión de ti que esta empresa quiere ver" →改为:
   - "Tu experiencia es la misma. Aquí la presentamos de forma que esta empresa la encuentre relevante."

5. **Senior users: no infantilizar**
   - Para mid/senior, la UI debe sentirse como una herramienta profesional, no un coach motivacional
   - Más control, menos hand-holding

---

## 2. User Flows Principales

### Flow 1: Primera vez (Onboarding emocional)

```
Usuario abre app
    │
    ▼
[Empty State: "Sube tu CV y una oferta de trabajo"]
    │  ← CTA claro, sin filler
    ▼
Usuario sube CV (PDF/DOC)
    │
    ▼
[Skeleton: "Analizando tu experiencia..."]
    │  ← Progress indicator con microcopy motivacional
    ▼
Usuario sube/pega oferta de empleo
    │
    ▼
[Loading: "Buscando coincidencias entre tu perfil y lo que buscan..."]
    │
    ▼
[Vista: CV Adaptado + Carta generada]
    │  ← Con badges: "Para este rol, resaltamos: [3 keywords]"
    ▼
Usuario revisa, edita, o descarga
    │
    ▼
[Si freemium: CTA "Desbloquea más adaptaciones + carta ilimitada"]
```

### Flow 2: Usuario recurrente (Job application rápido)

```
Usuario inicia sesión
    │
    ▼
[Dashboard: "Continuar donde lo dejaste" o "Nueva aplicación"]
    │
    ▼
"Subir oferta" (pegar texto o URL)
    │
    ▼
[UI muestra: CV adaptado previo + carta previa, pero con nuevos highlights]
    │  ← No regenerar todo; mostrar diff de cambios
    ▼
Usuario edita puntos clave ( inline editing )
    │
    ▼
Usuario descarga o copia
```

### Flow 3: Usuario freemium → subscriber (Conversion natural)

```
Usuario genera primera adaptación
    │
    ▼
[Preview de alta calidad con watermark sutil o limitación de 1下载/día]
    │
    ▼
[After 2-3 usos: prompt contextual]
    │  "Ya usaste esto 3 veces. ¿Listo para aplicacciones ilimitadas?"
    ▼
[CTA de upgrade con trial 7 días]
```

### Flow 4: Usuario que no calza (Rejection handling)

```
Sistema detecta gap significativo entre CV y oferta
    │
    ▼
[UI: No pantalla de error, sino advisory]
    │  "Tu perfil tiene [X] de [Y] requisitos. Te mostramos qué falta."
    │
    ▼
[Opciones:]
    │  A) "Generar de todos modos" (con disclaimer suave)
    │  B) "Sugiéreme cómo cerrar el gap" (content upgrade path)
    │  C) "Buscar ofertas más cercanas a tu perfil"
    │
    ▼
[ Selección define next flow ]
```

---

## 3. Estados Críticos de UI

### Empty State (Primera visita)

```
┌─────────────────────────────────────────────┐
│                                             │
│     [Icono: CV + documento]                 │
│                                             │
│     "Tu CV, adaptado para cada oportunidad"│
│                                             │
│     Subtítulo: "Sube tu CV y una oferta.   │
│     Te devolvemos la versión que esta      │
│     empresa quiere ver."                    │
│                                             │
│     [  Subir CV (PDF, DOC)  ]              │
│     [  Pegar oferta de empleo ]            │
│                                             │
│     ─── ó ───                              │
│                                             │
│     ¿Ya tienes cuenta?  Inicia sesión       │
│                                             │
└─────────────────────────────────────────────┘
```

**Microcopy clave:**
- No "Regístrate" → "Inicia sesión" (ya existe el concepto de cuenta previa)
- No "Arrastra tu CV aquí" → "Subir CV" (más claro, menos guessability)

### Empty State (Usuario logueado, sin aplicaciones)

```
┌─────────────────────────────────────────────┐
│                                             │
│     [Icono: maletín vacío]                 │
│                                             │
│     "Tus próximas 10 aplicaciones,        │
│      esperando"                             │
│                                             │
│     [  Nueva aplicación  ]                │
│                                             │
└─────────────────────────────────────────────┘
```

### Loading State (Procesando CV + Oferta)

```
┌─────────────────────────────────────────────┐
│                                             │
│     [Skeleton del CV con pulse animation]  │
│                                             │
│     "Analizando tu experiencia..."         │
│     1 de 3                                  │
│                                             │
│     ░░░░░░░░░░░░░░░░░░  33%               │
│                                             │
│     Tip: "Los recrutadores pasan 6 seg     │
│     en tu CV. Aquí nos aseguramos que     │
│     los hits correctos aparezcan primero."│
│                                             │
└─────────────────────────────────────────────┘
```

**Principios:**
- No spinner puro → es estresante
- Skeleton + progress + tip motivacional = percibido como "trabajando para mí"

### Error State (CV no pudo ser parseado)

```
┌─────────────────────────────────────────────┐
│                                             │
│     [Icono: documento con warning]         │
│                                             │
│     "No pudimos leer tu CV"                 │
│                                             │
│     Esto suele pasar con:                 │
│     • Archivos escaneados (fotos de CV)   │
│     • Formatos muy antiguos               │
│     • PDF con protección                  │
│                                             │
│     [  Subir otro archivo  ]              │
│     [  Escribir mi experiencia manualmente ]│
│                                             │
│     ─────────────────────────               │
│     ¿Sigues tendo problemas?               │
│     Escríbenos →                          │
│                                             │
└─────────────────────────────────────────────┘
```

**Microcopy clave:**
- No culpar al usuario ("Tu archivo está mal")
- Normalizar el problema ("Esto suele pasar con...")
- Siempre dar alternativa de acción

### Error State (Oferta no pudo ser procesada)

```
┌─────────────────────────────────────────────┐
│                                             │
│     "No encontramos el contenido           │
│      de la oferta"                         │
│                                             │
│     Intenta:                               │
│     • Pegar el texto directamente          │
│     • Copiar desde el sitio de la empresa │
│                                             │
│     [  Pegar texto manualmente  ]         │
│                                             │
└─────────────────────────────────────────────┘
```

### Success State (Output generado)

```
┌─────────────────────────────────────────────┐
│                                             │
│  ✓ CV adaptado                          [▼]│
│  ─────────────────────────────────────────  │
│                                             │
│  RESALTADO PARA ESTE ROL:                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │Python   │ │AWS      │ │Liderazgo│       │
│  │(3 años) │ │(certif) │ │(equipos)│       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                             │
│  [  Ver cambios completos  ]               │
│                                             │
│  ─────────────────────────────────────────  │
│                                             │
│  CARTA DE PRESENTACIÓN                      │
│  ┌─────────────────────────────────────┐   │
│  │ Estimulo/a [Nombre],                │   │
│  │                                     │   │
│  │ Me interesa la posición de...       │   │
│  │                                     │   │
│  │ [Preview con 3 líneas]              │   │
│  │                                     │   │
│  │        [ Ver carta completa → ]    │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ─────────────────────────────────────────  │
│                                             │
│  [  Descargar CV   ]  [  Copiar carta  ]  │
│                                             │
│  Si tienes cuenta Pro:                      │
│  [  Descargar todo en ZIP  ]              │
│                                             │
└─────────────────────────────────────────────┘
```

### Empty State (Sin suscripciones/creditos)

```
┌─────────────────────────────────────────────┐
│                                             │
│     "Hoy generaste tu adaptación gratuita"  │
│                                             │
│     Te quedan: 0 de 1 hoy                   │
│     Se renueva en: 23 horas                │
│                                             │
│     ─────────────────────────────────       │
│                                             │
│     ¿Aplicas a muchos trabajos?            │
│                                             │
│     [  Probar 7 días gratis  ]            │
│     [  Ver planes  ]                       │
│                                             │
└─────────────────────────────────────────────┘
```

### Advisory State (Gap detected)

```
┌─────────────────────────────────────────────┐
│                                             │
│     [Icono: bridge/gap]                    │
│                                             │
│     "Tu CV cubre 4 de 7 requisitos"        │
│                                             │
│     Lo que tienes:                         │
│     ✓ Python, AWS, React                   │
│     ✗ Kubernetes, GraphQL, 5+ años exp    │
│                                             │
│     ─────────────────────────────────       │
│                                             │
│     ¿Qué quieres hacer?                    │
│                                             │
│     [  Generar de todos modos  ]          │
│     [  Cómo cerrar el gap  ]              │
│     [  Buscar ofertas similares  ]        │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 4. Arquetipos de Usuario y UI Adaptativa

### Junior (0-2 años exp)
- **Ansiedad:** "No tengo experiencia suficiente"
- **UI:** Más hand-holding, tips, ejemplos de CVs exitosos
- **Tono:** Motivacional pero no condescendiente

### Mid (3-5 años exp)
- **Ansiedad:** "Tengo experiencia pero no sé si es la correcta"
- **UI:** Más controles de edición, énfasis en "qué se resalta y qué no"
- **Tono:** Profesional, les trato como adultos

### Senior (5+ años exp)
- **Ansiedad:** "Esto es demasiado genérico para mi nivel"
- **UI:** Export options, ATS-friendly formats, menos tips
- **Tono:** Directo, eficiente, sin fluff motivacional

---

## 5. Principles for Component Design

Siguiendo `skills/composition-patterns/SKILL.md`:

1. **Compound components para adaptaciones**
   - `<AdaptationProvider>` con state: {cv, jobPosting, adaptation, carta}
   - `<AdaptationFrame>` → `<HighlightList>` → `<HighlightBadge>`
   - `<AdaptationFooter>` → `<DownloadButton>`, `<CopyButton>`, `<UpgradeCTA>`

2. **Estado decoupled de UI**
   - Provider maneja parsing, matching, generación
   - UI solo consume state: `{ highlights, gaps, adaptedCV, carta, isLoading }`

3. **Context interface:**
   ```ts
   interface AdaptationState {
     highlights: Highlight[]
     gaps: Gap[]
     adaptedCV: string
     carta: string
     isLoading: boolean
     creditsRemaining: number
   }
   
   interface AdaptationActions {
     generate: (cv: File, jobPosting: string) => Promise<void>
     download: (format: 'pdf' | 'docx') => Promise<void>
     copyCarta: () => void
     upgrade: () => void
   }
   ```

---

## 6. Microcopy Rules (Deluxe)

| Situación | Evitar | Usar |
|-----------|--------|------|
| CV parseado | "Analizando CV..." | "Extrayendo tu experiencia..." |
| Loading | "Procesando..." | "Construyendo tu versión para este rol..." |
| Éxito | "Listo!" | "Tu CV, preparado para esta oportunidad" |
| Error CV | "Error al subir" | "No pudimos leer tu archivo. ¿Podría ser un PDF escaneado?" |
| Sin créditos | "Límite alcanzado" | "Ya usaste tu adaptación gratuita de hoy" |
| Upgrade | "Upgrade to Pro" | "¿Aplicas a muchos trabajos? [Ver planes]" |
| Gap detectado | "No cumples requisitos" | "Tu perfil cubre X de Y puntos de la oferta" |

---

## 7. Notas para Implementación UI

1. **Progressive disclosure:** No mostrar todas las opciones de edición de una vez. Primero output → luego "ver detalles" → luego edición granular.

2. **Diff visualization:** Para usuarios que quieran ver qué cambió, UI tipo "track changes" pero con iconos de highlight, no red/green stressful.

3. **Persistence:** Si el usuario cierra y abre, debe continuar donde quedó. No perder el trabajo de revisión.

4. **ATS-safe:** Output debe ser legible por ATS. Evitar emojis o formatting extraño en el texto del CV adaptado.

5. **Mobile-first:** El caso de uso "estoy en el bus, vi una oferta, aplico" es real. UI mobile debe ser fully functional.

---

*Documento vivo: Actualizar según feedback de usuarios y métricas de conversión.*
