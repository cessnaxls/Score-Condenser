# Symbol Memory Studio

The user supplies a **cropped image of one symbol**, chooses a label, and confirms it before saving. The application records a 64-bit perceptual difference hash and metadata in an atomic JSON file. Future crops can be compared against saved symbols using Hamming distance and visual similarity. **Matches never modify MusicXML automatically.** This is example-based nearest-neighbor matching, not neural-network fine-tuning and not complete OMR.

## Render persistence
Attach a **persistent disk** mounted at `/var/data`, and set `OMR_MEMORY_DIR=/var/data/omr-memory`. Without that disk, the data will disappear on redeploy/restart. The provided Render blueprint does not automatically create a disk to avoid unexpectedly changing your service or plan.

## Safety and limitations
- A perceptual hash is very sensitive to crop and scale choices, and visually similar symbols can mean different things in context.
- Symbol recognition is advisory; note pitches, clefs and rhythms are not automatically replaced.
- Training API is not authenticated independently. Protect the app with platform authentication before public deployment; otherwise anyone reaching it can edit the shared memory.
- Do not put private student or copyrighted full pages into the library; use cropped symbols.
- Stored hashes are not training images. Exportable model training requires a separate annotated dataset and training pipeline.

## Future recognition
For AI-assisted OMR scans, the app also examines up to 120 notehead candidates per system and reports high-similarity (94%+) stored-symbol suggestions in `recognition.symbolReports[].learnedMatches`. They remain advisory and do not silently change the output. The current interface displays the count through its warnings; per-symbol overlay remains future work.
