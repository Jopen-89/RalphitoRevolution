# Bead: Prueba de Engine 02
**Target Agent**: backend-team

## 1. SCOPE ESTRICTO (Para el Git Mutex)
[READ_ONLY_GLOBS]: []
[WRITE_ONLY_GLOBS]: ["output/test-result-02.txt"]
[BANNED_GLOBS]: ["src/**"]

## 2. Contexto Mínimo
Prueba de validación del motor de ejecución. Consiste en crear un archivo de texto con un string específico para confirmar que el agente procesa instrucciones y escribe en disco de forma aislada.

## 3. Criterios de Aceptación
1. El archivo `output/test-result-02.txt` debe existir.
2. Su contenido debe ser exactamente "prueba superada".

## 4. Instrucciones Especiales
- Crea la carpeta `output/` si no existe antes de escribir el archivo.