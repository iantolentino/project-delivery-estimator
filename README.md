# Project Delivery Estimator

AI-assisted delivery-level recommendation and Gantt chart generator for software projects.

## Required Vercel environment variables

- `GEMINI_API_KEY` — private Google Gemini API key
- `GEMINI_MODEL` — optional; defaults to `gemini-3.6-flash`

The API key is used only by the serverless function and is never included in browser code.

## Local demo mode

"Try demo analysis" runs a built-in heuristic analyzer entirely in the browser, so the estimator works without `GEMINI_API_KEY` — useful for local testing and previews. Demo results are labeled **Demo** in the UI; the serverless function is still required for real Gemini analyses.
