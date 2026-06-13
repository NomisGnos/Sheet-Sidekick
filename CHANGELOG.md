# Changelog

## v0.1.2

- Manifest verified for Foundry v14.360 while keeping v13 as the minimum supported version.
- Player-side local audio suppression was updated for v14 audio behavior.
- Pause state is synced through the module socket so Sidekick players see when the GM pauses the game.
- Select Target apply behavior was fixed for GM-authoritative targeting.
- Out-of-combat Target/Ping lists now use the GM's current scene.
- Manual Target/Ping additions are scene-scoped runtime entries and reset when the GM changes scenes.
- Release metadata points at the `NomisGnos/Sheet-Sidekick` GitHub repo and the `v0.1.2` ZIP asset.

## Current Module Shape

- Module id: `sheet-sidekick`
- Main files: `sheet-sidekick-core.js`, `sheet-sidekick.js`
- Socket channel: `module.sheet-sidekick`
- Main settings: `playerdata`, `mapPingApprovalMode`, `journalImageDisplaySeconds`
- Template: `templates/player-access-panel.html`
- Languages: `en`, `de`, `es`, `it`
