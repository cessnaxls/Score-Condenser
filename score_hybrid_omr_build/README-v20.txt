Score Condensor v20

Changes from v19:
- Fixes the long false tie/slur introduced by Octave Transcription when two originally different pitches fold onto the same written pitch. Same-pitch rhythm splitting now keys off the pre-octave-transcription pitch, so octave collisions do not manufacture ties.
- Adds Score transposition from -12 to +12 semitones. Transposition applies in Literal and Intelligent modes, preserves rhythm/rest placement, and updates the key signature automatically.
- Octave Transcription remains an independent optional switch under Intelligent Transcription.

Validation performed:
- node --check server.js
- node --check public/app.js
- ZIP root verified for render.yaml/package.json/server.js/public/

A full local runtime render could not be completed because npm dependency installation timed out in the build environment.
