Score Condensor v20.1

Fixes MusicXML rhythmic validation failures caused by polyphonic MusicXML measures.
The importer now tracks an independent rhythmic cursor for each MusicXML voice instead of
advancing all voices through one shared measure cursor. This prevents a second voice from
being incorrectly placed at (or beyond) the end of a 4/4 bar after a preceding voice.

No changes were made to octave transcription, transposition, rhythmic splitting, beaming,
rest preservation, engraving controls, or the raster-PNG PDF pipeline.
