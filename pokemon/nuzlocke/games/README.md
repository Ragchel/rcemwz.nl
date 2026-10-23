# Adding a Nuzlocke run

1. Copy `template.html` into a new folder as `games/<game-and-run>/index.html`.
2. Replace every bracketed placeholder with the run's real details.
3. Add the run to the game archive in `../index.html`.
4. Store optional Pokémon or run images in `../images/<game-and-run>/` and write meaningful alt text.

Set the run type to `Nuzlocke`, `Shinylocke`, or `Nuzlocke & Shinylocke` (use
`&amp;` in HTML), as specified by Rachel. Show the same type on the run page and
its archive card. Keep detailed rules in the separate ruleset field. Pokémon
Black run 1 is Nuzlocke only.

Use a unique folder and page for every attempt. For example, a second Pokémon Emerald attempt should live separately from the first (`emerald-run-1` and `emerald-run-2`), even though both use the same game.

## Pokémon Black run 1 session style

Session 1 is the default style for every session on `black-run-1/index.html`.
Use an eyebrow in the format `Session N · D Month YYYY · HH:MM–HH:MM TZ`,
followed by a descriptive level-two heading and a `journey-log` containing
`journey-entry` articles. Each entry has a `journey-heading` with its location
or context, a level-three title, and first-person story text. When a Pokémon
image is available, reuse the `journey-entry--with-pokemon`, `journey-pokemon`,
and `journey-copy` layout from session 1.

Treat supplied session durations as exact. Calculate the end time from the
start time and duration, and keep total playtime on the run page and archive
in sync. Leave unknown dates, times, and encounter details clearly marked
until Rachel supplies them.
