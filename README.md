# Project Delivery Estimator

AI-assisted delivery-level recommendation and Gantt chart generator for software projects.

## Required Vercel environment variables

- `GEMINI_API_KEY` — private Google Gemini API key
- `GEMINI_MODEL` — optional; defaults to `gemini-3.6-flash`

The API key is used only by the serverless function and is never included in browser code.
