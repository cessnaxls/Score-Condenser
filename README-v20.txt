Score Condensor v20

Changes:
- Fixes the giant tie/slur regression seen with Octave Transcription by keeping rhythm-split tied segments in a dedicated logical voice so they cannot merge with unrelated same-pitch notes.
- Adds Early-music rhythmic augmentation: 2/2 or 3/2, doubling every note/rest duration and onset spacing while preserving measure-relative rhythm. Breve/double-whole values are emitted as MusicXML <type>breve</type>.
- Adds chromatic Transposition from -24 to +24 semitones.
- Adds experimental Visual PDF/Image -> MusicXML transcription. It uses the OpenAI Responses API and requires OPENAI_API_KEY in Render. OMR_MODEL defaults to gpt-5.6-terra. The prompt explicitly preserves breve notation, independent voices, rests, beams, ties, clefs and meter.
- Existing literal/intelligent transcription, optional octave transcription, raster-PNG PDF export, and max-four-note beaming remain in place.

Visual OMR note: this is AI optical music recognition. Always review the engraved preview against the scan before relying on the exported MusicXML, especially with damaged scans, unusual mensural notation, or dense polyphony.
