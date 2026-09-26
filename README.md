# rcemwz.nl

A small, static homepage for Rachel's hobby projects. It keeps the full-height hero,
about section, project gallery, and simple footer structure from the previous live
site, with a lighter sakura-inspired theme.

## Preview locally

Run any simple static server from this directory, for example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Add images

The page works without images and keeps setup instructions as hidden HTML comments.
Shared, non-project images belong in `assets/images/`. The homepage currently
expects the about image at:

- `about.webp`

Each project's page and images are kept together so removing its directory also
removes its content. Add the project preview images at:

- `pokemon/binder/images/preview.webp`
- `tower/PCF/images/preview.svg`
- `pokemon/nuzlocke/images/preview.webp`
- `tower/sentry-protocol/images/preview.svg`

Other formats and filenames work too: update every matching `data-image` value.
Update `data-alt` at the same time so the image is described clearly.
Images are cropped with `object-fit: cover`; landscape images work best for project
slots, while a portrait or square image suits the about section.

## Edit projects

The project overview is in `projects/index.html`, served at `/projects/`.
The detail pages are:

- `pokemon/binder/index.html`
- `tower/PCF/index.html`
- `pokemon/nuzlocke/index.html`
- `tower/sentry-protocol/index.html`

Each page contains comments beside the temporary title and copy that should be
replaced. A project's homepage preview, overview card, detail page, and images all
live in or reference that project's own folder.

### Update the Pokémon binder

The Pokémon TCG binder is an interactive 1,088-pocket collection. Add WebP card
images to `pokemon/binder/images/cards/` using the pocket number as the filename:
`card-1.webp`, `card-2.webp`, `card-3.webp`, and so on. No HTML or JavaScript edit
is needed. See `pokemon/binder/images/README.md` for the pocket order.

Projects are grouped under `/pokemon/` and `/tower/`. The `/projects/` folder
contains only the project overview.
