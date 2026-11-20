# Original battle presentation assets

Copied from the local original macOS PokeTokenBar checkout. The presentation player,
Phaser/PokéRogue timelines, trainers, atlases, notices and size/height tables retain
original bytes. `player/electron-player.html`, `electron-player.css` and
`electron-bridge.js` are the Electron host adapter; the original player is unchanged.

The base reference was deaf07e (3.1.2). The comparison was refreshed against 186697a,
including the Wide Lens item/category. Data translations come from the original
Battle/Challenge localization sources, with the same eight-language order.
Music source URLs and hashes remain in the source manifests; the loss cue retains
its original MP3 bytes even though its packaged filename uses `.ogg`. Web Audio
decodes the actual file format.

Preserve the player, base/mega sprite, trainer and music notices and licensing files.
`tests/battle-presentation.test.mjs` compares the complete original player and trainer  
trees and the authoritative engine files to the reference checkout..
