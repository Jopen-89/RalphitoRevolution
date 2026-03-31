# Human Behavior & Product Design Track

**Project**: Ralphito - AI-Powered CV & Cover Letter Adapter with Auto-Apply
**Author**: Lola (UI/UX Designer)
**Date**: 2026-03-21
**Phase**: Divergencia (Human Behavior Research)

---

## 1. Psicología y Fricción

### 1.1 Mapa de Carga Cognitiva

| Etapa del Journey | Carga Cognitiva | Factor de Riesgo |
|-------------------|------------------|------------------|
| Configurar perfil inicial | ALTA | Formularios largos + miedo a exponerse |
| Adaptar CV a oferta | MEDIA→ALTA | Parálisis por exceso de opciones |
| Revisar texto generado | ALTA | Síndrome del impostor, miedo a parecer fraude |
| Auto-apply | MUY ALTA | Ansiedad de control, miedo a errores |
| Descubrimiento proactivo | MEDIA | Tensión ayuda vs. intrusión |

### 1.2 Trampas Psicológicas Identificadas

#### Trampa de la Novedad (Novelty Trap)
El usuario teme que el LLM genere contenido que suene "demasiado perfecto" o genérico. Esto activa el detector de fraude interno: *"Si suena como IA, me van a rechazar."*

**Mitigación UX**:
- Nunca decir "IA generó esto" - decir "Te ayudamos a destacar"
- Mostrar diffs sutiles, no versiones completas
- Permitir edición inline con sugerencias, no imposición

#### Trampa de la Culpa Automatizada
Auto-apply se siente como "hacer trampa". El usuario teme:
- Parecer perezoso ante el reclutador
- Aplicar a trabajos para los que "no merece" aplicar
- Ser descubierto como "masivo"

**Mitigación UX**:
- Normalizar: "El 73% de candidatos exitosos personalizan para cada puesto"
- Nunca llamar "aplicación masiva" en UI - llamar "Aplicaciones inteligentes"
- Framing de eficiencia, no de volumen

#### Trampa del Descubrimiento Proactivo
El usuario quiere encontrar oportunidades pero teme:
- Que la herramienta aplique sin su consentimiento
- Parecer desesperado si ve que busca activamente
- Perder el control sobre qué llega a su bandeja

**Mitigación UX**:
- "Notificaciones inteligentes" no "Alertas automáticas"
- Siempre confirmar antes de aplicar, nunca auto-aplicar sin consent
- Mostrar " Matches encontrados" no "Ofertas nuevas"

### 1.3 Arco Emocional del Usuario

```
[Frustración] → [Curiosidad] → [Esperanza] → [Ansiedad] → [Alivio/Satisfacción]
    ↑                                                    ↓
    └──────────────── [Auto-duda] ← ← ← ← ← ← ← ← ← ← ← ← ┘
```

**Puntos de Intervención UX**:
- **Frustración inicial**: Onboarding con ejemplo real, no formulario vacío
- **Curiosidad**: Demo visual del proceso en 3 pasos
- **Esperanza**: Mostrar match score y explicar por qué
- **Ansiedad pre-aplicación**: Preview editable + "Tú tienes el control"
- **Alivio post-envío**: Celebración sutil, no celebración excesiva (genera más presión)

---

## 2. User Flows Principales

### 2.1 Flow 1: Onboarding y Configuración

```
Usuario llega → Landing emocional → "Adaptamos tu CV al trabajo que quieres"
        ↓
 "¿Ya tienes CV?" 
   ├─ SÍ → Upload CV (drag & drop) → Parseo con preview
   │         ↓
   │      "¿Este es tu perfil correcto?" → Editar inline
   │         ↓
   │      Elegir tone de comunicación [Formal | Casual | Estratégico]
   │         ↓
   │      → Dashboard principal
   │
   └─ NO → Wizard guiado: Nombre, experiencia, habilidades, tono
             ↓
          Generar CV base con IA
             ↓
          → Dashboard principal
```

**Dead ends a evitar**:
- No mostrar formulario de "Completar perfil" antes de mostrar valor
- Si el parseo falla, no mostrar error técnico - decir "No pudimos leer tu CV, ¿puedes pegarlo?"

### 2.2 Flow 2: Adaptación de CV a Oferta

```
Usuario copia enlace de oferta OR pega texto de oferta
        ↓
Sistema extrae requisitos + company's tone
        ↓
"Analizando compatibilidad..." [Skeleton con pulpo animado]
        ↓
Mostrar: Match Score (0-100%) con breakdown
  - Tus habilidades → Requisitos
  - Tu experiencia → Cultura empresa
  - Palabras clave perdidas
        ↓
"¿Quieres que adaptemos?" [Botón con microcopy asertivo]
  └→ "Ajustar mi CV para este puesto"
        ↓
Preview lado a lado: Original vs. Adaptado
  - Diferencias resaltadas en amarillo suave
  - Botón "Restaurar original" siempre visible
        ↓
Usuario edita/aprueba → Descarga o Copiar
```

**Puntos de decisión**:
- El match score NUNCA debe ser bajo si el usuario ya invirtió tiempo - ofrecer "补强建议" (suggestions to strengthen) no "No cumples requisitos"
- Las palabras clave perdidas se muestran como "Oportunidades" no "Faltas"

### 2.3 Flow 3: Auto-Apply Automation

```
Usuario configura extensión en sitio de empleo
        ↓
La extensión detecta formulario
        ↓
Badge en campo: "Autocompletar con tu perfil"
        ↓
Usuario hace click → Autocompletar con animación de "llenado"
        ↓
Antes de enviar: Modal de confirmación
  "Vamos a enviar tu solicitud para [Puesto] en [Empresa]"
  [Revisar aplicación] [Editar algo] [Enviar]
        ↓
Éxito → Toast: "Solicitud enviada ✓" 
        ↓
"Eliminar de tu lista de pendientes?" [Sí | No]
```

**Dead ends a evitar**:
- Nunca auto-enviar sin confirmación explícita
- Si el sitio tiene CAPCHA, detectar y decir "Este paso requiere tu atención"

### 2.4 Flow 4: Descubrimiento Proactivo

```
Usuario configura preferencias:
  - Ubicación (remoto/hibrido/oficina)
  - Rango salarial
  - Roles de interés
        ↓
Sistema moniterea fuentes (LinkedIn, Indeed, etc.)
        ↓
Notificación (browser): "3 posiciones匹配 tu perfil en Barcelona"
        ↓
Usuario hace click → Panel de matches
        ↓
Cada match muestra:
  - Título + Empresa
  - Match Score
  - "Adaptar mi CV en 1 clic"
  - "Guardar para después" / "Descartar"
        ↓
Aplicar → Flow 2 → Flow 3
```

**Tono crítico**: Las notificaciones deben sentirse como "Tu asistent personal encontró esto" no "Tienes trabajo pendiente"

---

## 3. Estados Críticos de UI

### 3.1 Empty State: Sin CV Configurado

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Icono: Documento con varita mágica]      │
│                                                 │
│        Tu CV está listo para brillar            │
│                                                 │
│   Sube tu CV o deja que te ayudemos a crear     │
│   uno que destaque en 3 minutos                │
│                                                 │
│   ┌─────────────┐      ┌─────────────┐         │
│   │  Subir CV   │      │Crear con IA │         │
│   └─────────────┘      └─────────────┘         │
│                                                 │
│   ─────── o arrastra aquí ───────              │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Título: "Tu CV está listo para brillar" (no "Subir CV")
- Subtítulo: "Sube el que tengas o te ayudamos a crear uno nuevo"
- CTA primario: "Subir mi CV existente"
- CTA secundario: "Crear uno nuevo con IA"

### 3.2 Empty State: Sin Ofertas Descubiertas

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Icono: Catalejo / Telescopio]           │
│                                                 │
│        Aún no hay matches en el radar          │
│                                                 │
│   Configura tu búsqueda para recibir           │
│   alertas cuando encontremos tu próximo paso   │
│                                                 │
│   ┌─────────────┐                              │
│   │ Configurar   │                              │
│   │ preferencias │                              │
│   └─────────────┘                              │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Título: "Aún no hay matches en el radar" (no "No hay resultados")
- Subtítulo: "Configura qué buscas y te avisamos cuando encontremos algo para ti"
- CTA: "Configurar mi búsqueda"

### 3.3 Error State: Fallo en Adaptación de CV

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Icono: Documento con signo !]           │
│                                                 │
│        No pudimos adaptar tu CV esta vez        │
│                                                 │
│   El texto de la oferta parece estar vacío     │
│   o no pudimos leer la estructura.              │
│                                                 │
│   ┌─────────────────────────────────────┐      │
│   │ Copiar texto de oferta manualmente   │      │
│   └─────────────────────────────────────┘      │
│                                                 │
│   ───────── ó ─────────                        │
│                                                 │
│   [Volver a intentar]                           │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- NO decir "Error" ni "Fallo"
- Título: "No pudimos adaptar tu CV esta vez" (pasivo, no culposo)
- Subtítulo: Explicación simple sin jerga técnica
- CTAs: Ofrecer alternativa, no solo "reintentar"

### 3.4 Error State: Auto-apply Bloqueado

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Icono: Candado / Stop]                  │
│                                                 │
│        Esta web requiere tu atención           │
│                                                 │
│   Encontramos un paso extra (CAPTCHA o          │
│   verificación) que no podemos completar        │
│   automáticamente.                              │
│                                                 │
│   ┌─────────────────────────────────────┐      │
│   │        Completar manualmente         │      │
│   └─────────────────────────────────────┘      │
│                                                 │
│   Tu información está guardada y lista         │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Frame: "Esta web requiere tu atención" (no culpar al usuario ni a la web)
- Explicación: Sin tecnicismos
- Reassurance: "Tu información está guardada" (recordatorio de control)

### 3.5 Loading State: Analizando Oferta

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Animación: Pulpo reorganizando          │
│         documentos con tentáculos]              │
│                                                 │
│        Analizando compatibilidad...            │
│                                                 │
│   ═══════════════════════░░░░  78%              │
│                                                 │
│   Buscando palabras clave       ✓listo          │
│   Evaluando experiencia         ✓listo          │
│   Adaptando tono                 en curso        │
│   Calculando match score        pendiente       │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Animación: Un pulpo (metáfora de "multitarea inteligente")
- Progreso visible con pasos completados (reduce ansiedad)
- Nunca mostrar spinner puro sin contexto

### 3.6 Loading State: Aplicando Automáticamente

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Animación: Cohete / Avión de papel]     │
│                                                 │
│        Enviando tu solicitud...                │
│                                                 │
│   Llenando: Nombre, email, experiencia...       │
│                                                 │
│   ☐ Datos personales                            │
│   ☑ Experiencia                                 │
│   ☐ Educación                                   │
│   ☐ Carta de presentación                       │
│                                                 │
│   Tu CV se adaptó automáticamente               │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Mostrar qué campos se están completando (transparencia = confianza)
- Checkmarks visuales por cada paso completado
- Avisar que el CV se adaptó ("Tu CV se adaptó automáticamente")

### 3.7 Success State: Aplicación Enviada

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│            ✓                                    │
│                                                 │
│        ¡Solicitud enviada!                      │
│                                                 │
│   para [Nombre del Puesto] en [Empresa]        │
│                                                 │
│   Te avisaremos si hay novedades.               │
│   Mientras tanto, ¿qué tal si...?              │
│                                                 │
│   [Ver 2 jobs similares]   [Volver al inicio]   │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Celebración SUTIL, no excesiva (no genera presión)
- No "¡Felicidades!" - puede sentirse irónico si no están seguros
- Mostrar "próximo paso" para reducir ansiedad post-envío
- Invitar a seguir usando, no abandonar

### 3.8 Success State: Match Descubierto

**Qué ve el usuario**:
```
┌─────────────────────────────────────────────────┐
│                                                 │
│   🔔 3 nuevas posiciones match con tu perfil   │
│                                                 │
│   ┌─────────────────────────────────────┐      │
│   │ Senior Developer @ TechCorp         │      │
│   │ Barcelona · Remoto · €65k-80k       │      │
│   │ ████████████░░░░  89% match          │      │
│   │                        [Aplicar →]  │      │
│   └─────────────────────────────────────┘      │
│                                                 │
│   ┌─────────────────────────────────────┐      │
│   │ Full Stack @ StartupX               │      │
│   │ Madrid · Híbrido · €50k-65k         │      │
│   │ ██████████░░░░░  76% match          │      │
│   │                        [Aplicar →]  │      │
│   └─────────────────────────────────────┘      │
│                                                 │
│              [Ver todas las matches]            │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Microcopy**:
- Badge de notificación: "posiciones" no "empleos" (menos pressure)
- Match % visible pero no como veredicto, como "compatibility"
- CTA: "Aplicar →" (no "Aplicar ahora" - el "ahora" implica obligación)

---

## 4. Principios de Diseño Emocional

### 4.1 Tono de Voz

| Situación | No decir | Mejor decir |
|-----------|----------|-------------|
| CV adaptado | "IA generó este CV" | "Personalizamos tu CV para este puesto" |
| Auto-apply | "Aplicación masiva" | "Aplicaciones inteligentes" |
| Error | "Error en el sistema" | "Tuvimos un problema, pero tiene solución" |
| Sin matches | "No hay resultados" | "Aún no hay matches, pero estamos buscando" |
| Éxito | "¡Felicidades!" | "Solicitud enviada" (neutro, asertivo) |

### 4.2 Jerarquía Visual para Reducir Ansiedad

1. **Siempre mostrar progreso** cuando hay pasos involucrados
2. **Siempre ofrecer control** - botón "tú decides" prominente
3. **Nunca culpar al usuario** - errores son del sistema, no del usuario
4. **Desglosar lo complejo** - "Adaptar CV" = 3 pasos simples
5. **Celebrar sutilmente** - checkmark > confetti

### 4.3 Evitar la Trampa de la Culpa

- No mostrar números de "personas que aplican" (genera competencia ansiedad)
- No decir "Aún no has aplicado" (culpa inútil)
- No enfatizar "rapidez" sobre "calidad" (sabemos que velocidad ≠ efectividad)
- Enfocar en "match" no en "volumen"

---

## 5. Referencias de Diseño

- **Aesthetic direction**: following `skills/frontend-design/SKILL.md` - evitar AI-slop aesthetics, usar tipografía distintiva y paletas con personalidad
- **Component architecture**: following `skills/composition-patterns/SKILL.md` - compound components para estados complejos
- **Color palette sugerida**: warm neutrals con accent de energía (ej. terracota/naranja suave como primary, no el típica purple-gradient)
- **Motion**: Animaciones de "trabajo en progreso" que transmitan "estamos trabajando para ti", no solo "cargando"

---

*End of Track*
