# Additional AI-assisted OMR mode

This adds an optional **AI-assisted OMR** mode to the existing Score Condensor app. PDF and photo uploads can use either legacy linewise GPT or geometry-assisted GPT. Existing score imports, condensation, proofreading, audits and exports are unchanged. No Audiveris is used.

## How it works
1. Render PDF pages / load photographs, segment music systems using existing processing.
2. Independently detect horizontal sets of five staff rulings using grayscale row projections and spacing consistency.
3. Supply staff y-coordinates as *positional hints only* to the vision model. Do not derive invented pitches from the projections.
4. Run the existing MusicXML-part validation, temporal checks and proofread UI. Flag disagreement between geometric staff count and model staff count.
5. Require review of the source image and recognized events before the condensation step.

## Important limits
This is a first-phase OMR module, **not** a full symbol-detector or certified note-by-note recognition engine. In particular, staff geometry cannot validate noteheads, rhythmic values, ties, mensural interpretation, lyrics or clef semantics. The OpenAI recognition requests still require OPENAI_API_KEY, and long jobs currently live in server memory. Dense renaissance scores and difficult photographs require manual review.

## Deploy
Keep the existing Docker deployment and OPENAI_API_KEY; upload the contents to your GitHub repository and redeploy on Render. Choose the AI-assisted OMR option before uploading PDF/photos.

## Static validation
Run `node --check server.js`, `node --check pdf-omr.js`, `node --check public/app.js`. Full live recognition tests require installed dependencies and API credentials.
