# GPT photo and PDF musical transcription

No Audiveris is included or required. The service rasterizes PDF pages via `pdftoppm` (Poppler) and sends page images to an online OpenAI vision model. JPG, JPEG, PNG and WEBP photos can also be sent (up to eight images/pages per import, max 20 MB per file). Multiple photos are sent in the order selected by the browser; select all images in score order. Upload MusicXML/MXL/MIDI files one at a time.

## Render setup
Deploy with the provided Dockerfile and render.yaml. Set `OPENAI_API_KEY` in Render > Environment to a server-side API key with sufficient funds and model access. Never include keys in source control or put them in browser code. `OPENAI_OMR_MODEL` defaults to `gpt-4.1`; configure a vision-capable model that supports JSON output. OpenAI API calls are billed separately from ChatGPT subscriptions. Each import transmits your document images to OpenAI; do not upload documents without authorization.

## Note-value interpretation
The transcription prompt explicitly asks the model to distinguish square breve and longa notes and produce MusicXML `<type>breve</type>` or `<type>long</type>`. The literal export now retains the imported note `type` field rather than always deriving it from note duration. The note time span is preserved and audited by the existing event-based verification. This is requested behavior, not a claim that every medieval or Renaissance glyph is automatically recognized correctly.

## Mandatory review and limits
GPT-generated MusicXML can contain wrong pitches, voices, tied notes, accidentals, note values or page alignment. Any uncertain symbols returned by the model are shown in the app. Imported GPT notation is marked unverified and requires an acknowledgment before preview/engraving. The existing integrity audit only compares the GPT-recognized notation against the *condensed* notation, not against the source photos. Cross-image verification or perfect mensural notation support is not established. Large/complex scores can exceed model output limits; this initial integration supports up to 8 pages at a time, and rejects incomplete generated XML instead of using it silently. Multi-page PDFs are limited to eight pages. Source MusicXML can be exported after review. End-to-end OpenAI API and Docker deployment testing is required.
