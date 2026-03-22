# Bead: 00-cv-contracts-and-mocks
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: []
[WRITE_ONLY_GLOBS]: ["src/types/cv/**/*.ts", "src/mocks/cv/**/*.ts"]
[BANNED_GLOBS]: ["src/features/**"]

## 2. Contexto Mínimo
Definición de las interfaces base (`CVProfile`, `ParsedField`, `ConfidenceScore`) y generación de los mocks estáticos. Esto actúa como el contrato central que permite al Frontend y Backend trabajar en paralelo sin colisionar.

## 3. Criterios de Aceptación
1. `CVProfile` exportado con tipado estricto para experiencia, educación y habilidades.
2. Archivo `cv-parser.mock.ts` creado con un payload de ejemplo realista.

## 4. Instrucciones Especiales
- Piensa en la validación: cada campo extraído debe incluir un nivel de confianza (`confidence: number`) para que la UI sepa qué resaltar.

