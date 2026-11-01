ReadLite Android UI update overlay

Copy the apps/android files in this package into the matching folders in your project.
The package changes:
- Genre filter: searchable suggestions from the API; shows an error hint instead of silently ignoring a failed request.
- Explore and bookshelf: two-column portrait cards; stories without uploaded covers get a more finished, varied jacket-style placeholder.
- EPUB status: explains that the imported file is saved as a private server draft and becomes public only after review.

Verified from the running local API during preparation:
- GET /api/v1/genres returned 251 rows.
- GET /api/v1/stories returned the two seed stories and G3 Catalog/Other fixture stories without coverUrl.
- The EPUB editor screenshot showed a cover and 28 chapters after the app fetched the story again from the author API. The importer commits the story, media, volumes, chapters and genre matches before returning.

No database rows are deleted or modified by this overlay. G3 Catalog/Other rows are test fixtures left in the development database. Seed stories have no coverUrl, so they use the new placeholder until a cover is uploaded.