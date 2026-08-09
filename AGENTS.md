# AGENTS.md

## Project purpose

This repository contains `rcemwz.nl`, a personal hobby website for showcasing projects I build in my own time. It is not a commercial product, portfolio agency, or generic SaaS landing page. Changes should make the site feel personal, calm, playful, and handcrafted.

The visual theme is inspired by sakura (Japanese cherry blossoms): soft spring colors, organic details, and gentle motion. Use that inspiration with restraint so that the projects and their stories remain the focus.

## Priorities

When making decisions, optimize in this order:

1. Clearly present my projects and why I made them.
2. Preserve a recognizable, personal sakura-themed identity.
3. Keep the site fast, accessible, responsive, and easy to maintain.
4. Prefer simple solutions suitable for a hobby project.
5. Add polish without making the site feel corporate or template-generated.

## Design direction

- Build around a light, warm palette: blossom pinks, off-whites, muted greens, and dark readable text.
- Use sakura imagery as framing, texture, or small accents rather than as visual clutter.
- Favor generous spacing, soft shapes, subtle shadows, and a friendly editorial feel.
- Motion should be gentle and purposeful. Respect `prefers-reduced-motion` and never make animation necessary to understand or use the site.
- Maintain strong text contrast and visible keyboard focus even when that requires departing from the pastel palette.
- Avoid stereotypical Japanese motifs that are unrelated to the sakura concept, and avoid turning the design into an anime or gaming theme unless explicitly requested.
- Avoid generic startup language, oversized marketing claims, pricing-style sections, and unnecessary calls to action.

## Content and information architecture

The project showcase is the heart of the site. A useful project entry may include:

- project name and a short, plain-language summary;
- what motivated the project or what problem it explores;
- screenshots, artwork, or a small demo where appropriate;
- technologies used, without letting technology badges dominate the story;
- links to a live version or source repository when they are intentionally public;
- status such as active, experimental, archived, or work in progress.

Write in a first-person, conversational voice. Be honest about unfinished experiments and small projects; they do not need to be presented as products. Do not invent biography, project facts, testimonials, metrics, dates, links, or contact details. Use clearly marked placeholder content when information has not been provided.

Protect privacy. Before exposing repository URLs, email addresses, analytics, personal metadata, or details about private projects, confirm that the information is already intentionally public or was explicitly supplied for publication. Never commit secrets or credentials.

## Engineering guidelines

- First inspect the existing implementation and follow its established patterns.
- The current project may be small. Do not introduce a framework, build system, dependency, CMS, or backend unless it solves a concrete need and the added maintenance cost is justified.
- Prefer semantic HTML, modern CSS, and minimal JavaScript for simple interactions.
- Keep components and data structures straightforward if the site later adopts a framework. Project content should be easy to add or update without duplicating layout code.
- Use progressive enhancement: core content and navigation should remain usable when JavaScript is unavailable or fails.
- Optimize images and provide meaningful alternative text. Decorative blossom artwork should use empty alternative text or be hidden from assistive technology.
- Support current mobile and desktop viewport sizes. Avoid horizontal overflow and interactions that only work with hover.
- Keep third-party scripts and tracking to a minimum. Do not add analytics, cookies, remote fonts, or external embeds without considering privacy and performance.
- Do not add a server or persistent data storage unless the requested feature truly requires one.

## Accessibility baseline

- Use landmarks and a logical heading hierarchy.
- Ensure all interactive controls work with a keyboard and have visible focus states.
- Give links and controls descriptive accessible names.
- Meet WCAG AA color-contrast targets for normal text and important interface elements.
- Do not rely on color, animation, or blossom imagery alone to convey meaning.
- Test layouts at narrow widths and with enlarged text.

## Working practices

- Keep changes focused on the requested feature; do not redesign unrelated areas without a clear reason.
- Preserve user-authored content and unrelated working-tree changes.
- Reuse existing styles and assets before adding new ones.
- If a design decision is ambiguous, choose the simpler and more personal option and document any important assumption.
- Update the README when setup, tooling, deployment, or content-editing instructions change.
- Do not claim a command or test passed unless it was actually run.

## Validation

Use the checks provided by the repository. If no automated tooling exists yet, at minimum:

- open or serve the site and check the browser console for errors;
- verify the main navigation and all links;
- inspect representative mobile and desktop widths;
- check keyboard navigation and visible focus;
- confirm images have appropriate dimensions and alternative text;
- confirm animations honor reduced-motion preferences;
- validate that no private information or placeholder link was accidentally published.

In the final handoff, briefly summarize what changed, what was verified, and any content or visual decisions that still need my input.
