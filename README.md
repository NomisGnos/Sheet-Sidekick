# Sheet Sidekick

Sheet Sidekick is a Foundry VTT module for players who use a phone or tablet instead of the full Foundry canvas.

It gives selected players a cleaner actor-sheet flow and routes canvas-heavy actions through the GM. The main use case is a table where the GM controls the map, while players use their own devices for their character sheet, item use, rests, target requests, and simple map pings.

## What It Does

- Lets the GM choose which non-GM users should use Sheet Sidekick.
- Puts those players into a no-canvas player flow.
- Opens the owned actor sheet as the main interface.
- Keeps the sheet usable on smaller touch screens.
- Sends movement, targeting, item-use, roll, rest, and ping requests to the GM when needed.
- Adds a Ping On Map workflow for approximate player pings without giving the player a live canvas.
- Lets the GM click a vanilla journal image and show it to Sidekick players.

The module is built around D&D5e character sheets and Foundry v13/v14.

## Setup

1. Enable the module in the world.
2. Open `Game Settings -> Configure Settings -> Module Settings`.
3. Open the Sheet Sidekick `Player Access` panel.
4. Select the players who should use the Sidekick interface.
5. Have those players reload if their interface does not switch right away.

## Main Features

### Player Sheet Mode

Selected players use their actor sheet as the main screen. The module hides most of the normal Foundry canvas interface for those users, reduces clutter, and keeps the sheet more touch-friendly.

It also tries to reopen the last actor the player was using and preserve scroll position when the sheet refreshes.

### GM-Assisted Movement

Players can request token movement through the Sidekick controls. The GM client remains authoritative and performs the actual movement on the canvas.

This avoids giving phone/tablet clients a full live canvas while still letting players ask for movement during play.

### Targeting And Pings

Players can open a target/ping panel from the sheet. Target state is synced through the module socket, and the GM's current scene is used for out-of-combat target/ping lists.

Combat-aware restrictions can limit actions to the active turn when configured by the table flow.

### Ping On Map

Ping On Map lets a player request a low-quality snapshot of the GM's current scene. The player can tap that snapshot to send an approximate ping back to the GM.

The GM can approve snapshots manually or allow automatic sending through the module setting.

The snapshot workflow hides hidden tiles, hidden tokens, notes, drawings/templates, controls, and other non-map UI before capture.

### Item Use And Rolls

Item and spell use goes through a confirmation step. The confirmation can show target hints, placement-ping hints, concentration warnings, ammo/cast-level choices, and suggested roll guidance.

When the player-side sheet should not execute the roll directly, the request is sent to the GM.

### Rests

Short-rest and long-rest buttons are replaced with Sidekick-styled request buttons. Players confirm the request, then the GM runs the normal D&D5e rest workflow for that actor.

### Journal Image Sharing

The GM can click an image in a normal Foundry journal page to show it to Sidekick players. Shared images close automatically after the configured duration.

## Settings

- `Player Access`: choose which players use Sheet Sidekick.
- `Ping On Map Approval Mode`: choose manual approval or automatic snapshot sending.
- `Journal Image Display Duration`: how long shared journal images stay visible.

## Compatibility Notes

- Primary system target: D&D5e.
- Foundry support in the manifest: minimum v13, verified v14.360, maximum v14.
- A GM client should be connected for movement, target, ping, rest, item-use, and roll request workflows.
- Sheet Sidekick-enabled player clients suppress local audio playback so table audio stays GM-controlled.
- The module has compatibility handling for BG3 Inspired Hotbar token-control refreshes.
- Localization files exist for English, German, Spanish, and Italian. Coverage is mainly settings and access-panel text, not every runtime string.

## Installation Notes

Manifest URL:

```text
https://raw.githubusercontent.com/NomisGnos/Sheet-Sidekick/main/module.json
```

Release ZIP:

```text
https://github.com/NomisGnos/Sheet-Sidekick/releases/download/v0.1.2/sheet-sidekick.zip
```

## Known Limits

- This is not a replacement for the full Foundry canvas.
- Most player actions need an active GM client.
- Ping On Map is approximate. It is useful for "around here" pings, not exact measurement.
- D&D5e gets the most attention. Other systems may render, but they are not the target.
- Some module interactions are handled by practical patches rather than broad compatibility guarantees.

## Support

Please visit my Patreon and drop me a goodberry:

```text
https://www.patreon.com/cw/nomisDM
```

## Patch Notes

### v0.1.2

- Manifest verified for Foundry v14.360 while keeping v13 as the minimum supported version.
- Player-side local audio suppression was updated for v14 audio behavior.
- Pause state is synced through the module socket so Sidekick players see when the GM pauses the game.
- Select Target apply behavior was fixed for GM-authoritative targeting.
- Out-of-combat Target/Ping lists now use the GM's current scene.
- Manual Target/Ping additions are scene-scoped runtime entries and reset when the GM changes scenes.
- Release metadata points at the `NomisGnos/Sheet-Sidekick` GitHub repo and the `v0.1.2` ZIP asset.

### Current Module Shape

- Module id: `sheet-sidekick`
- Main files: `sheet-sidekick-core.js`, `sheet-sidekick.js`
- Socket channel: `module.sheet-sidekick`
- Main settings: `playerdata`, `mapPingApprovalMode`, `journalImageDisplaySeconds`
- Template: `templates/player-access-panel.html`
- Languages: `en`, `de`, `es`, `it`
