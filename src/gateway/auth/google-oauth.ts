import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

const TOKEN_PATH = path.join(process.cwd(), '.tokens', 'google.json');

// Estos valores deben venir del archivo .env (Creados en Google Cloud Console > APIs & Services > Credentials)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:8080/callback';

export async function authenticateGoogle(): Promise<OAuth2Client> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el archivo .env');
  }

  const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  // Intentar leer token guardado
  try {
    const tokenData = await fs.readFile(TOKEN_PATH, 'utf-8');
    const credentials = JSON.parse(tokenData);
    oAuth2Client.setCredentials(credentials);
    
    // Test simple para forzar refresco si expiró
    await oAuth2Client.getAccessToken();
    console.log(chalk.green('✅ Autenticado con Google (Token cargado)'));
    return oAuth2Client;
  } catch (error) {
    // Si falla (no existe o caducó sin refresh token), iniciamos flujo interactivo
    console.log(chalk.yellow('⚠️ No se encontró token válido de Google. Iniciando autenticación...'));
    return await runInteractiveOAuthFlow(oAuth2Client);
  }
}

function runInteractiveOAuthFlow(oAuth2Client: OAuth2Client): Promise<OAuth2Client> {
  return new Promise((resolve, reject) => {
    const app = express();
    let server: any;

    app.get('/callback', async (req, res) => {
      const code = req.query.code as string;
      if (!code) {
        res.send('Error: No se recibió ningún código de autorización.');
        return reject(new Error('No auth code received'));
      }

      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        // Guardar token en disco
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        
        res.send('<h1>¡Autenticación completada!</h1><p>Ya puedes cerrar esta ventana y volver a tu terminal.</p>');
        console.log(chalk.green('✅ Autenticación de Google exitosa y token guardado.'));
        
        // Cerrar el servidor temporal
        server.close();
        resolve(oAuth2Client);
      } catch (error) {
        res.send('Error al obtener los tokens.');
        reject(error);
      }
    });

    server = app.listen(8080, () => {
      // Usamos el scope de Cloud Platform para poder invocar Vertex AI / Gemini
      const authorizeUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline', // Importante para recibir refresh_token
        prompt: 'consent', // Obliga a dar refresh token en el primer uso
        scope: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/generative-language.retriever'
        ]
      });

      console.log('\n======================================================');
      console.log(chalk.cyan.bold('🔐 Por favor, abre el siguiente enlace en tu navegador para autorizar a Ralphito:'));
      console.log('\n' + authorizeUrl + '\n');
      console.log('Esperando respuesta en el puerto 8080...');
      console.log('======================================================\n');
    });
  });
}
