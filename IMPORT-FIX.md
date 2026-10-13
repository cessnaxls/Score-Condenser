# Import reliability hotfix

## Main fix
PDF/photo recognition no longer blocks the HTTP upload while GPT transcribes multiple systems. POST /api/import immediately returns HTTP 202 with a jobId. The browser polls GET /api/import-jobs/:id and displays progress/errors. MXL, MIDI and MusicXML still import synchronously.

## Upload handling
- Up to eight PDF/photo files per upload, one MusicXML/MXL/MIDI file per upload.
- Rejects mixed input types with an actionable error.
- Reports missing OPENAI_API_KEY directly (does not break non-image imports).
- Reports multer file-size limit as JSON and surfaces errors in the interface.
- Keeps the original transcription, condensation and export logic unchanged.

## Deployment limitations
- Recognition jobs are held in process memory. Render restarts or deploys lose in-progress jobs; persistent job storage is a future improvement.
- Only one recognition job runs at a time per instance. For multiple Render instances, add Redis/queue and shared storage.
- GPT note-by-note recognition remains experimental and requires proofreading.
- Full server integration tests were not possible in this environment because dependency installation was unavailable. JavaScript syntax checks passed.
