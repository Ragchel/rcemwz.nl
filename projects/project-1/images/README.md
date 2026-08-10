# Pokémon binder images

Keep every image used by the Pokémon binder project in this directory.

## Add cards

Put card images in the `cards/` folder and name them for their physical pocket:

- `cards/card-1.webp` fills the first pocket;
- `cards/card-16.webp` fills the bottom-right pocket on the first page;
- `cards/card-17.webp` starts the next page;
- numbering continues through `cards/card-1088.webp`.

Cards are placed from left to right, then top to bottom. WebP is used to keep the
collection quick to load. If your source image is a PNG or JPEG, export or convert
it to WebP first. Empty or missing numbers remain visible as empty pockets.

The optional `preview.webp` is shared by the homepage and project overview. When
it is missing, the site shows a built-in illustrated binder cover instead.
