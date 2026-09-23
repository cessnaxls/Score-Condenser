Score Condensor v23.1 — entity expansion fix

Fixes: “Entity expansion limit exceeded: 1003 > 1000” on large/OMR MusicXML.

Changes:
- MusicXML parsing no longer expands XML entities.
- DOCTYPE/DTD declarations are stripped before structural parsing; Score Condensor does not need external DTD entity resolution.
- Basic predefined XML entities are decoded only for displayed metadata text.
- In Music-only OMR mode, any model-returned <lyric>, <credit>, and textual <words> blocks are removed before import, reducing parser load and enforcing the requested music-only behavior.
- MXL container.xml uses the same safe parser.
- No changes to note timing, intelligent/literal condensation, augmentation, or PDF generation.
