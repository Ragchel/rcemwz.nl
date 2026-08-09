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

- `projects/project-1/images/preview.webp`
- `projects/project-2/images/preview.webp`
- `projects/project-3/images/preview.webp`

Other formats and filenames work too: update every matching `data-image` value.
Update `data-alt` at the same time so the image is described clearly.
Images are cropped with `object-fit: cover`; landscape images work best for project
slots, while a portrait or square image suits the about section.

## Edit projects

The project overview is in `projects/index.html`. The initial detail pages are:

- `projects/project-1/index.html`
- `projects/project-2/index.html`
- `projects/project-3/index.html`

Each page contains comments beside the temporary title and copy that should be
replaced. A project's homepage preview, overview card, detail page, and images all
live in or reference that project's own folder.
