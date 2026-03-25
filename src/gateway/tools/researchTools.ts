import type { Tool } from './toolRegistry.js';
import type { ToolDefinition } from '../interfaces/gateway.types.js';

export function createResearchTools(): Tool[] {
  return [
    {
      name: 'google_web_search',
      description: 'Busca información en internet usando un motor de búsqueda. Devuelve un resumen de los mejores resultados.',
      execute: async (params: Record<string, unknown>) => {
        console.log('[google_web_search] INICIO execute con params:', params);
        const query = params.query as string;
        if (!query) throw new Error('Parameter query is required.');

        // 1. Intentar SerpAPI si hay key configurada
        const serpApiKey = process.env.SERPAPI_API_KEY;
        if (serpApiKey) {
          try {
            console.log('[google_web_search] Intentando SerpAPI...');
            const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`SerpAPI error: ${response.statusText}`);
            const data = await response.json() as any;
            const results = data.organic_results?.slice(0, 5).map((r: any) => `- ${r.title}: ${r.snippet} (${r.link})`).join('\n') || 'Sin resultados.';
            console.log('[google_web_search] SerpAPI OK');
            return { query, results, source: 'serpapi' };
          } catch (e) {
            console.warn('SerpAPI falló, intentando DuckDuckGo fallback...', e);
          }
        }

        // 2. Fallback: DuckDuckGo HTML scraper (No requiere API key)
        try {
          console.log('[google_web_search] Intentando DuckDuckGo...');
          const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
          const html = await response.text();
          
          console.log('[google_web_search] DuckDuckGo HTML recibido, tamaño:', html.length);
          const snippetRegex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
          const titleRegex = /<h2 class="result__title">[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/g;
          
          const snippets = [...html.matchAll(snippetRegex)].map(m => m[1]?.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
          const titles = [...html.matchAll(titleRegex)].map(m => m[1]?.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
          
          const limit = Math.min(5, snippets.length, titles.length);
          const results = [];
          for (let i = 0; i < limit; i++) {
            results.push(`- ${titles[i]}: ${snippets[i]}`);
          }
          
          console.log('[google_web_search] DuckDuckGo OK, resultados:', results.length);
          return {
            query,
            results: results.length > 0 ? results.join('\n') : 'Sin resultados o bloqueado por DuckDuckGo.',
            source: 'duckduckgo-html-fallback',
          };
        } catch (error) {
          console.error('[google_web_search] Error fatal:', error);
          return { query, error: 'La búsqueda falló completamente.', details: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  ];
}

export function createResearchToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'google_web_search',
      description: 'Busca información en internet para obtener datos frescos y reales del mercado o cualquier tema. Devuelve un resumen de los resultados orgánicos.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'La consulta de búsqueda (ej. "Market size of AI agents 2024")' },
        },
        required: ['query'],
      },
    },
  ];
}
