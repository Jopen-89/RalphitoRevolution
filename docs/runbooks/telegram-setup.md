# Configuración del Bot de Telegram (Autopilot)

Este documento detalla los pasos necesarios para configurar correctamente un nuevo bot de Telegram para que funcione con el sistema de agentes.

## 1. Crear el Bot y obtener el Token
1. Abre Telegram y busca al bot oficial **@BotFather**.
2. Envía el comando `/newbot`.
3. Sigue las instrucciones para darle un nombre y un *username* (debe terminar en "bot").
4. BotFather te dará un **Token de acceso** (ej: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).
5. Cópialo y pégalo en tu archivo `.env` local:
   ```env
   TELEGRAM_BOT_TOKEN=tu_token_aqui
   ```

## 2. Desactivar el Modo Privacidad (Crucial para Grupos)
Por defecto, Telegram activa el "Privacy Mode" en los bots nuevos. Esto significa que **si metes al bot en un grupo, no podrá leer los mensajes normales**, solo aquellos que empiecen por `/` o que le mencionen directamente con `@username`. 

Dado que nuestro sistema usa procesamiento de lenguaje natural (ej: "Raymon, hola"), **DEBES desactivarlo**:

1. En el chat con **@BotFather**, envía el comando `/mybots`.
2. Selecciona tu bot en el menú interactivo.
3. Haz clic en **Bot Settings**.
4. Haz clic en **Group Privacy**.
5. Haz clic en **Turn off**. (El mensaje debe confirmar: *Privacy mode is disabled*).

## 3. Obtener el Chat ID Permitido
Para evitar que cualquiera hable con tus agentes y consuma tokens, el bot debe estar bloqueado para responder solo en tu chat privado o grupo.

1. Añade el bot a tu grupo (o háblale por privado).
2. Levanta el servidor del bot localmente (`npm run start:bot`).
3. Envíale un mensaje cualquiera, como `/start`.
4. Mira tu terminal local. Verás un log como este:
   ```
   📩 Mensaje recibido de [TuUsuario] en Chat ID: -123456789
   ⚠️ Acceso denegado en texto: El Chat ID -123456789 no coincide...
   ```
5. Copia ese número exacto (incluyendo el guion `-` si es un grupo) y ponlo en tu `.env`:
   ```env
   TELEGRAM_ALLOWED_CHAT_ID=-123456789
   ```

## 4. Reiniciar el Bot
Tras cualquier cambio en el `.env` o en BotFather (especialmente el Privacy Mode), asegúrate de reiniciar el proceso del bot:
```bash
pkill -f "bot.ts"
npm run start:bot
```
