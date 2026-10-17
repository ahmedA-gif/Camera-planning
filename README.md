# Camera Planning

A Next.js camera planning application with Clerk authentication, AI-assisted scenario and camera layout planning, editable camera maps, and a separate FastAPI document service for PDF and DOCX reports.

## Local development

1. Install dependencies with `pnpm install`.
2. Configure the variables documented in `.env.example` and Clerk's Next.js setup in `.env.local`.
3. Start the web app with `pnpm dev`.
4. For report generation, start the document service in a second terminal:

   ```sh
   cd detvision-doc-service
   python3 -m uvicorn app.main:app --reload --port 8001
   ```

The frontend uses `DOC_SERVICE_URL` for the document service and defaults to `http://localhost:8001` locally.

## Deployments

The frontend and document service are separate Vercel projects. Set the frontend's Clerk and AI provider secrets in Vercel's encrypted environment variables. Set `DOC_SERVICE_URL` to the deployed document service URL. The document service uses `Dockerfile.vercel` to install WeasyPrint's native libraries.
