# PDF sheet music transcription

PDF uploads are processed with **Audiveris optical music recognition** (OMR). Audiveris writes compressed MusicXML, which is then loaded through the existing MusicXML importer and verbatim condenser. Ordinary MXL, MusicXML, and MIDI files use their existing paths.

## Deploying to Render

This release uses a **Docker** Render web service, rather than the old Node native build, to install Audiveris. Use `render.yaml` when deploying a new service or change an existing service to Docker. The recommended Starter plan reflects the CPU/RAM needed for OMR; free-tier memory may be insufficient for multi-page PDFs. Docker downloads the latest official Linux Audiveris `.deb` from GitHub at build time; the build needs internet access. Upstream packaging may change: if it does, pin `AUDIVERIS_DEB_URL` to an official, tested release asset and update the Docker build. The `/api/pdf-omr/status` endpoint shows which binary is configured, not whether it was executed successfully.

For other deployments, install Audiveris separately and set `AUDIVERIS_BIN` to its executable. The command line used is: `audiveris -batch -transcribe -export -output <folder> -- <input.pdf>`.

## Workflow

1. Upload a PDF scan or generated sheet music PDF (up to 20 MB).
2. Wait for recognition and inspect the part list. Recognition may be slow for multi-page scores.
3. **Compare the recognized notation against the source PDF** and acknowledge that it needs review.
4. Select voices, preview the condensed score and run the existing output audit.
5. Export MusicXML/MXL/PDF/MIDI. Treat these exports as **unverified against the original PDF** until the notes have been manually checked/corrected in an external score editor.

**Important:** the automatic audit can prove (within its implemented scope) that recognized notes survive condensation; it cannot prove that the original PDF was recognized accurately. The review checkbox is a disclosure, not a certification. OMR occasionally misreads ties, accidentals, tuplets, lyrics, measure lines, voice assignments, and overlapping rhythms. For critical transcriptions, edit the recognized MusicXML in MuseScore or another notation editor and reimport it after corrections.

## Limitations

- Only PDFs containing legible printed notation are supported. Handwritten or degraded prints are unreliable.
- PDFs whose OMR export contains multiple separately exported movements are rejected instead of silently discarding material.
- Source PDF pages are not edited or retained by the server. Each upload is written to a private temporary directory and deleted when recognition completes or fails.
- Audiveris and its native dependencies must be present at runtime. An ordinary `npm start` without Audiveris will not transcribe PDFs.
- Large multi-page scores may exceed service memory or the 240-second recognition timeout.
