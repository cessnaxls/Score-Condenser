# Linewise GPT sheet-music transcription (experimental)

This release replaces the single huge visual GPT request with separate requests for each detected horizontal system on each PDF page/photo. It never uses Audiveris. It uses OpenAI API requests, not the ChatGPT web UI. Requires OPENAI_API_KEY and optionally OPENAI_OMR_MODEL (default gpt-4.1).

## Operation
1. Upload PDF or ordered photographs (max 8 pages total).
2. Images are rendered at 240 DPI for PDFs. A row-ink detector attempts to locate staff lines and segment systems. If uncertain, it submits the whole page rather than risking cutting notes.
3. GPT transcribes each crop independently, across all staves, using MusicXML with pitches, durations, rests, clefs and voices. Historical breve and longa have explicit instructions.
4. The server validates that every system has the same part count and each staff has the same number of measures before merging.
5. The normal verbatim condensation and pitch/onset/duration audit run against the *recognized* MusicXML.

## Important limits
- This does **not** establish optical note-by-note correctness. No model can guarantee it without independent evidence. Verify each measure visually against the PDF or photo.
- The app does not currently provide a side-by-side page-by-page note editor, and does not auto-correct optical reading errors.
- The score must use a stable staff count and order across systems; otherwise the import is rejected rather than silently merged.
- Historical mensural durations and movable C clefs are difficult, and recognition may be wrong even if GPT returns no uncertainties.
- A 3-page score may make 10–20 sequential GPT calls. A normal synchronous Render request can time out. Production should use a persistent queue and progress polling for long scans.
- Cropping uses sharp. Install dependencies during the Docker build. npm install and end-to-end OpenAI API testing were not completed in this editing environment.
- The opening introductory material, irregular initial systems and mixed score layouts can confuse the staff detector. When segmentation fails it falls back to sending whole pages.

## Known high-priority production improvements
- Queue/worker, resumable progress and request cost budgeting.
- Split score layout into staff images plus an overview, and independently verify each note with image-linked bounding boxes.
- Human correction UI with selected original crop beside notation; save corrections to canonical recognized MusicXML.
- Benchmarked quality tests scored against known MusicXML originals, including 16th-century clefs/breves/longae.

## Deployment
Use Docker deployment with render.yaml and add OPENAI_API_KEY. Avoid providing the API key to the browser. Render logs contain API errors but not the key.
