# Sheet Sidekick for Foundry VTT

Sheet Sidekick turns a phone or tablet into a player-facing companion sheet for Foundry VTT. It is built for tables that want a lightweight mobile experience without giving players the full canvas UI.

The module currently focuses on Foundry VTT v13 and D&D5e character sheets. The player experience is designed around touch interaction, GM-assisted actions, and a cleaner handoff between the player device and the main table display.

## Highlights

- Mobile-first player sheet shell with Foundry canvas disabled for supported players
- Touch-friendly navigation, scrolling, and action handling for phones and small tablets
- On-sheet gamepad movement with GM-authoritative movement handling
- Target and ping workflows that work even when the player does not have a live canvas
- Ping On Map snapshot workflow for approximate placement pings
- Use Item confirmation flow with concentration warnings and suggested roll guidance
- Short Rest and Long Rest requests routed through the GM's normal D&D5e rest workflow
- GM-side spell list parity for always-prepared spells
- Vanilla journal image sharing from a single GM click
- English, German, Spanish, and Italian localization scaffolding for module settings and access panel UI

## Feature Tour

### Player Experience

- Player Access mode lets the GM choose which non-GM users should run Sheet Sidekick
- Supported players automatically enter a no-canvas flow to reduce heat, battery drain, and screen clutter
- The actor sheet is rendered as the primary interface and resized to the full device viewport
- The module preserves scroll position and restores the player to the last-opened owned actor when possible
- The sheet UI is tightened for touch devices, including mobile-friendly tab handling, visible scroll cues, and action affordances

### Movement and Turn Gating

- A built-in gamepad tab lets players move their token without needing direct canvas interaction
- Movement requests are GM-authoritative and routed through the GM client
- Out-of-turn movement can be blocked using the same locked-state behavior used during combat
- No-GM states are surfaced to the player so actions do not silently fail
- Compatibility hooks are in place so BG3 Inspired Hotbar can resync when token control changes

### Targets, Pings, and Combat Awareness

- Players can open a target and ping workflow from the sheet
- Live target syncing keeps the sidekick UI in step with GM-side target updates
- Combat-aware restrictions can limit movement and targeting to the active turn
- Target and combat lists label the active player character with `(YOU)` for clarity on shared or mirrored displays
- GM-side token selection can be paired with player requests so the GM does not have to hunt for the correct token first

### Ping On Map

Ping On Map is one of the major features of the module.

- A player can request a low-quality map snapshot from the GM for general placement pings
- The GM can run the workflow in either manual approval mode or automatic mode
- In manual mode, the GM gets a clear prompt with `Send Snapshot` or `Cancel`
- Before capturing, the GM client switches to token control mode and auto-selects the requesting token to reduce accidental exposure from other canvas tools
- The captured image is shown to the player in a dedicated overlay that supports tap-to-ping, drag-to-pan, and zoom
- Players can request another snapshot from the same overlay without reopening the whole workflow
- Hidden tiles are excluded from the captured image
- Hidden tokens are excluded from the captured image
- If no GM is connected, the player gets a visible message instead of a dead-end action

This workflow is especially useful when the player device should stay battery-light, when a monitor player is in use, or when the GM wants to keep map control centralized.

### Item Use, Spellcasting, and Roll Guidance

- Tapping an item or spell routes through a custom `Use Item?` confirmation flow
- The confirmation can explain when an item appears to need targets or a placement ping
- Concentration warnings are shown before casting a new concentration spell
- Suggested rolls can be displayed in a structured, easier-to-read format
- Cast-level support is handled for spells that consume slots
- MIDI cast-level dialogs are supported when that workflow is present
- Roll requests can be forwarded to the GM when the player-side sheet should not execute them directly

### Rest Workflow

- Native D&D5e rest buttons are replaced with Sidekick-styled short-rest and long-rest buttons
- Players get a confirmation modal before the request is sent
- The short-rest prompt explains hit-die spending and includes Constitution modifier context
- The long-rest prompt explains that recovery still follows the world's configured D&D5e rules
- The GM receives the normal D&D5e rest workflow and the dialog is relabeled with the requesting actor's name

### GM Quality-of-Life Features

- Always-prepared spells are decorated on the GM side so they match the visual treatment players see
- The GM can receive roll, item-use, targeting, movement, and rest requests from no-canvas players
- No-GM-required states are surfaced cleanly to players instead of leaving them guessing
- Various sheet cleanups keep the mobile presentation focused on actions the player can actually use

### Journal Sharing

- The GM can click an image inside a vanilla journal body and immediately show it to Sheet Sidekick players
- Players do not need to use Foundry's extra context menu steps
- Shared journal images auto-close after a configurable duration
- The duration is controlled by a module setting and defaults to 20 seconds

### Localization

The module now ships language entries for:

- English
- German
- Spanish
- Italian

Current localization coverage focuses on the module manifest languages, settings, and the Player Access UI. That gives the module a clean multilingual foundation without trying to partially translate every runtime string all at once.

## Installation

1. Open Foundry VTT and go to `Add-on Modules`.
2. Click `Install Module`.
3. Paste this manifest URL into the `Manifest URL` field:

`https://raw.githubusercontent.com/NomisGnos/Sheet-Sidekick/v0.1.0/module.json`

4. Install the module and enable it in your world.

## Setup

1. Open `Game Settings -> Configure Settings -> Module Settings`.
2. Open the `Player Access` panel for Sheet Sidekick.
3. Enable Sheet Sidekick for any non-GM users who should use the mobile interface.
4. Have those players reconnect or reload if needed.

## Module Settings

- `Player Access`: choose which players should use Sheet Sidekick
- `Ping On Map Approval Mode`: manual GM approval or automatic snapshot sending
- `Journal Image Display Duration`: how long shared journal images remain visible before auto-hiding

## Compatibility Notes

- Primary target system: D&D5e
- Foundry compatibility in the manifest currently targets v13
- The module contains compatibility handling for BG3 Inspired Hotbar token-control refreshes
- Some GM-assisted flows rely on a GM being connected and active

## Distribution Notes

This repository uses the GitHub remote:

`git@github.com:NomisGnos/Sheet-Sidekick.git`

The release-shaped manifest now points at:

- repository page: `https://github.com/NomisGnos/Sheet-Sidekick`
- tagged manifest: `https://raw.githubusercontent.com/NomisGnos/Sheet-Sidekick/v0.1.0/module.json`
- release ZIP asset: `https://github.com/NomisGnos/Sheet-Sidekick/releases/download/v0.1.0/sheet-sidekick.zip`

Before sharing the manifest publicly, make sure GitHub has:

1. a `v0.1.0` tag
2. a `v0.1.0` release
3. an uploaded release asset named `sheet-sidekick.zip`

Once those exist, the manifest is in the right shape for public installation.

## Support

Sheet Sidekick grew out of real table use and is opinionated in favor of practical in-session improvements: faster player actions, less canvas noise on phones, and fewer "wait, what am I supposed to click?" moments.
