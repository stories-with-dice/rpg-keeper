# Storage: state, campaigns, import, seeding, Dropbox

## State model (`js/core.js`, `js/store.js`)

- `OSR.state` (shape: `STATE_DEFAULTS`) is the current campaign (`OSR.campaignId`, one of
  `OSR.campaigns`).
- **IndexedDB** database `osr_store`:
  - `docs`: each campaign as JSON documents: `'<campaignId>/campaign'` plus `'<campaignId>/<system>'`
    for each of `OSR.SYSTEMS` (`['osr','ua3e','brp','sl']`). Also `seeds/<system>`.
  - `meta`: `'campaigns'` (`[{ id, name, createdAt, primary }]`) and `'activeCampaignId'`.
  - `blobs`: map images.
- `splitState(state)`: characters (by `charSystemKey()`), monsters, Compendium entries, scenes, and
  user tables (`state.tables`, by `system`), and each character's HP/Wounds/Madness trackers go to their system's document.
  The rest goes to `campaign`, with `order: { characters, consumables }`. `joinState(docs)` reverses it.
- `load()` is async (`init()` awaits it). The first run after the IndexedDB move migrates
  `localStorage['osr_manager_v1']` into a primary campaign "Default"; the old key goes only after
  the write succeeds. If IndexedDB does not open, `init()` shows `#load-error` and stops.
- `save()` is synchronous and returns `true`. It queues one transaction that writes only the
  documents whose JSON changed (`lastWritten`). Await `saveNow()` (Promise of a boolean) or
  `flushSave()` when the write must be done: Import, content packs, Dropbox pulls, campaign switch.
  `save()` also calls `OSR.dropboxNoteSave()` and `notifyMapViews()`.
- `ensureStateShape()` is the migration hook (after `load()` and after import). Per-entry
  backfills (for example `entry.statuses = []`) go here too.
- The Journal (`state.notes`, `js/notes.js`, EasyMDE through `js/mde.js`) is campaign-global. Enter
  sends the draft to the log (`pushNote('Journal', …, { md: true })`); Shift+Enter is a newline.
- Trackers (`state.consumables`) are campaign-global too. Each
  character owns an `HP (Name)` tracker (`hpTrackerLabel`/`ensureHpTracker`); Combat HP for a
  character reads and writes it through `hpConsumable()`.
- The Character tab shows one or two characters (`state.activeId`, `state.activeIdB`); one
  character's sheet splits into two columns at the first `---` line.

## Campaigns (`js/campaigns.js`)

`#campaign-select` switches; its last option "+ New campaign…" creates one. Settings → Campaign
renames and deletes (never the last one). `switchCampaign(id)` awaits `flushSave()` and
`dropboxBeforeCampaignSwitch()`, calls `loadCampaign(id)`, seeds an empty campaign with
`seedMissing(false)` (no pregens), and renders every panel. Theme and System are per campaign.

## Export and Import (`js/io.js`)

- `exportData()` serializes the whole `state`. With map images, `#export-modal` offers a .zip
  (`exportZip()`, vendor/fflate): `campaign.json` plus `maps/<blobId>.<ext>`. `importZip()` stores
  the images first, then imports `campaign.json`.
- Replace all (Import → Replace, Dropbox pull): `OSR.replaceState(data)` → `finishLoad()` (migrate,
  save, render everything, `resetHistories()`).
- Merge (`importData`, Cancel on the question): `mergeCompendium`/`mergeMonsters`. An item keeps its
  `system` (missing → `'osr'`); a duplicate in the same system (same `ref`, or same name + category
  for an entry) is skipped. An item with a `seedRef` replaces the campaign's item with that
  `seedRef` (`replaceSeeded()`). Scenes get new ids.
- `mergeTables` (Merge and packs) skips a table whose name (case-insensitive) the system has.
- **Content packs**: a file with `pack: { name, system }` goes to `importPack`: merge only, one
  confirm, then `OSR.setSystem(pack.system)`. If `saveNow()` returns `false`, it removes what it
  added and alerts. Pack tables go only into the campaign (not the seed store). Other pack items become seed copies, and `OSR.addToSeed()` adds the pack to the seed
  store.

## Seeding (`js/data.js`, `js/seeds.js`, `js/seed.js`)

- `init()` awaits `OSR.loadData()`: `OSR.data.monsters`, `.tables`, `.seeds.osr` (gear in
  `data/seed-osr.json` + spells in `data/spells.json` whose names the gear does not use +
  `data/monsters.json`), `.seeds.brp`, `.pregens` (`OSR.PREGEN_FILES`). If any file
  fails, `showLoadError()` and `init()` stops before `load()`.
- **Seed store**: `OSR.loadSeeds()` (before `load()`). `OSR.seeds[system]` = `{ system, version,
  codeVersion, compendium, monsters }`, shared by every campaign on the device, stored as
  `seeds/<system>` (and `/seeds/<system>.json` in Dropbox). A higher code `version` merges in at
  boot; packs add with `addToSeed()`. Each item has a `seedRef` (`seedRefOf()`: a pack `ref`, a
  monster `id`, or `"<system>:c:<lower-case name>"`).
- A campaign keeps copies (`compCopy()`/`monsterCopy()`) with `seedRef` and `seedHash`
  (`contentHash()` of the copy as seeded). `state.seedVersions[system]` is the version seen.
  `seedStatus(sys)` sorts into `added`, `changed` (copy unedited), `edited`. While seen < version,
  Settings shows `#set-seed-row`: Apply (`applySeed`), Apply and overwrite my edits, Skip.
- `seedMonsters()`, `seedCompendium()`, `seedBrp*()` read `OSR.seeds`. Each replaces or
  adds only its own system's slice. BRP seeding runs from `init()` every time, gated by
  `state.brpCompendiumSeeded` and friends.
- Pregens: `seed()` runs only with no characters. Settings → Add missing pregens
  (`addMissingPregens()`) adds every example whose name no character has, and keeps
  `activeId`/`activeIdB`. OSR: Garrick, Gulzund. UA: Kevin Johnson, Lucinda Adams (book identities;
  the logic test checks their link names against `UA_PREGEN_LINKS`). SL: Dee Okafor, Miriam
  Castell, Vivian Sato, Ray Kowalczyk.

## Dropbox sync (`js/dropbox.js`)

Optional. One Dropbox file per document. No backend.

- **Sign-in**: OAuth 2 PKCE with a redirect. `connect()` stores `{ verifier, appKey, state,
  redirectUri }` in `sessionStorage['osr_dropbox_pending']` and sends the tab to `/oauth2/authorize`
  (`token_access_type=offline`) through `OSR.dropboxRedirect(url)`. On return, `initDropbox()` →
  `finishRedirect()` checks `state` and calls `finishConnect()`. `accessToken()` refreshes by itself.
  Each app address must be a Redirect URI of the Dropbox app; Setup shows it in `#dbx-redirect-uri`.
  Fallback: "Connect with a code" (`connectWithCode()`, no `redirect_uri`).
- App folder app (`files.content.read/write`). The app key is not secret
  (`meta.appKey` or `DEFAULT_APP_KEY`). Never put the app secret in code.
- `dbxFetch` adds the bearer token (always POST). A 401 refreshes once; a second 401 signs out.
  `listAll()` lists the folder once per pass; `toRemote()` keeps `{ id, rev, hash, path, modified }`.
  Uploads use `mode: add` or `mode: update` with the rev (409 on a race).
- Layout: `/campaigns/index.json`; `/campaigns/<id>/shared.json` and `/<system>.json`;
  `/campaigns/<id>/maps/<blobId>.<ext>`; `/seeds/<system>.json`. Legacy whole-campaign files are
  moved to `… (before split).json` on the first pass.
- Per-device keys (never in `state`): `sessionStorage['osr_dropbox_pending']`,
  `localStorage['osr_dropbox_token']`, `localStorage['osr_dropbox_v1']` (`enabled`, `appKey`,
  `files[path]` sync records, `legacy`, `migrated`, `hidden`).
- **One pass** (`syncNow()`): `legacyStep()`, `syncIndex()`, `syncSeeds()` (never asks; union by
  `seedRef`), `syncDocs()` (`decideSync()` → create, link, noop, upload, pull, conflict; pulls apply
  together through `OSR.replaceState()`), `syncBlobs()` (uploads missing images; downloads happen in
  `dropboxFetchBlob()` when a scene shows).
- A pull records the hash after `ensureStateShape` and writes no log line (else two devices loop).
  If the local write fails, `replaceAndWait()` restores the old campaign and throws.
- Only the current campaign syncs. `dropboxBeforeCampaignSwitch()` waits for a pass;
  `dropboxFetchCampaign(id)` downloads a campaign this browser lacks before the switch.
- Timing: `UPLOAD_DELAY` 4 s debounce, `MAX_WAIT` 30 s; sync at boot, on focus (at most once a
  minute), on `online`; flush on hide. `#dbx-modal` handles conflicts: use Dropbox copy, keep this
  browser's copy, Export, Decide later.
- Tests (`test/dropbox.test.js`): `test/helpers/fake-dropbox.js` fakes the token endpoint and API
  (pages of 4, `dbx.before()` hooks, real `content_hash`). Not covered: the real consent page.
