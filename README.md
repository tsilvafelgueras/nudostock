# Nudo Stock

Sistema de gestión de stock de rollos textiles. Proyecto MVP de tesis (ITBA).

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Drizzle ORM + Supabase (Postgres + Auth + Storage) — *próxima etapa*
- Gemini + OpenRouter para extracción resiliente de planillas
- Despliegue en Vercel

## Correr local

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000).

## Extracción de planillas con IA

La app usa Gemini como proveedor principal y OpenRouter como respaldo independiente.
Configurá en `.env.local` y en Vercel:

```dotenv
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...

# Opcionales
GEMINI_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODEL=gemini-2.5-flash
# Si se define, reemplaza la lista visual gratuita automática:
# OPENROUTER_FALLBACK_MODEL=google/gemma-4-31b-it:free
```

Si `OPENROUTER_API_KEY` no está configurada, la app usa el segundo modelo de Gemini
como último recurso. Para tener redundancia real entre proveedores, ambas claves
deben estar disponibles en el entorno del despliegue. `openrouter/free` no
se usa porque podía elegir modelos no aptos para OCR. Por defecto se prueban
modelos visuales gratuitos fijos; siguen sujetos a límites de disponibilidad.
