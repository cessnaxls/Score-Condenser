Score Condensor v25.2

Fixes standard compressed MusicXML (.mxl) imports that contain a normal MusicXML DOCTYPE declaration.

Changes:
- Replaced the greedy DOCTYPE-removal regex with a quote/internal-subset-aware scanner so it removes only the declaration, never the score body.
- Tightened raw <part> matching so <part-list> cannot consume the first real part while reconstructing MusicXML document-order cursor movement.
- Visual OMR/JSON-first behavior from v25.1 is unchanged.
