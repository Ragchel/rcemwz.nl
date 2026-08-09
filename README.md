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
To fill the empty slots automatically, add files to the existing `assets/images/`
directory using these names:

- `about.webp`
- `project-1.webp`
- `project-2.webp`
- `project-3.webp`

Other formats and filenames work too: update the matching `data-image` value in
`index.html`. Update `data-alt` at the same time so the image is described clearly.
Images are cropped with `object-fit: cover`; landscape images work best for project
slots, while a portrait or square image suits the about section.

## Edit projects

The project overview is in `projects/index.html`. The initial detail pages are:

- `projects/project-1/index.html`
- `projects/project-2/index.html`
- `projects/project-3/index.html`

Each page contains comments beside the temporary title and copy that should be
replaced. The homepage preview, overview card, and detail page for a project all
use the same image from `assets/images/`.
