# Score Condensor — Symbol-level OMR engineering module

This version installs a **dedicated OpenCV symbol-evidence unit** alongside the existing GPT and import/export functionality. It does not include Audiveris.

## What is implemented

1. Image decode and contrast normalization with OpenCV.
2. Multi-threshold line-projection detection of five-line staves with spacing estimates.
3. Staff-relative coordinate extraction for candidate noteheads (half-line steps).
4. Candidate barline detection through vertical morphological filters.
5. Symbol connected-component extraction and source-coordinate bounding boxes.
6. JSON evidence with page/system/staff reference and explicit uncertainty flags.
7. Node-to-Python subprocess bridge for existing hybrid-mode PDF/photo uploads.
8. Existing GPT music reading, structure checking, manual proofreading, MusicXML, MIDI, MXL, PDF, source-to-output audit and condensation remain present.

## Limitations — read before deployment

This is a **functional geometry/symbol detector, not a fully trained, note-perfect OMR product**. It is insufficient for automatic faithful recognition of all historical documents. Hollow noteheads, accidentals, movable clefs, longae, square breves, mensural rests, beams, ties, ligatures, and lyric assignment still require a recognition model and/or manual confirmation. Detected barlines include false positives from stems. The engine cannot presently certify image-to-MusicXML accuracy and does not block exports solely on detection count.

The geometry evidence is **NOT MusicXML** and must not be used as unquestioned ground truth. Recognition failures must be handled through the existing proofreader. A dedicated trained instance-segmentation model, labeled historical music corpus, staff-coordinate corrections and measure-level comparison UI would be necessary before claiming Soundslice-level recognition.

## Render deployment

Deploy Docker; `Dockerfile` installs Python 3, NumPy, OpenCV (Debian packages), and the existing Node.js dependencies. Set `OPENAI_API_KEY` on Render for GPT-backed PDF/photo import. Select **AI-assisted OMR** on upload. Files in PDF/MXL/MusicXML/MIDI remain supported.

## Local checks

```
python3 omr_engine.py source_page.png --output evidence.json
python3 -m unittest discover -s tests -v
node --check server.js
node --check pdf-omr.js
node --check omr-bridge.js
```

## Benchmarks on bundled example inputs (local)

On the supplied **Pellegrini** PDF page 1 rendered to 1224×1584 px, the detector found 16 candidate five-line staves, consistent with four systems of four parts. The found notehead count is incomplete; this does **not** demonstrate correct music reading.

On the provided **Sechsstimmige Gesänge** screenshot, the detector found only 11 staves, despite the image visibly containing more. The image is therefore **not supported at verified transcription quality**. This is a known failing test case requiring further training/algorithm work.

## Data contract

`symbolReports` in the parsed recognition metadata has each page/system's five-line staff positions, candidate notehead (x, y, relative diatonic step, confidence) and candidate barline positions. No pitch spelling is inferred without a clef.
