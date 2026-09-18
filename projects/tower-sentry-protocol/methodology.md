# Orbit Plotter — methodology, sources, and confirmation status

This file holds everything the tool itself used to show inline (field-level
source notes, formula derivations, confirmed-vs-estimated status) before it
was moved out to keep the tool's own UI uncluttered. Section order matches
the tool's panel order, top to bottom.

**Sourcing standard (applies to every claim below):** a number or formula
counts as *confirmed* only when it traces to something read directly out of
the decompiled/extracted APK — a `dump.cs` field/offset, a Ghidra
decompile of an actual function body, a raw constant read out of
`libil2cpp.so`'s data section, or real Unity scene/asset bytes read with
UnityPy. TheTowerSDK is a community project, not a game source — it gets
cited only as a secondary cross-check *after* an APK-derived answer already
exists, or explicitly flagged as an unverified placeholder when no APK
source has been found yet. It is never treated as confirmation by itself.
Screenshot/pixel measurements are real evidence but are their own category
("empirically observed," not "code-confirmed") and are labeled as such.
Anything that doesn't clear this bar is labeled **unverified** or **manual
field**, not stated as fact.

## Tower data

| Field | Source |
|---|---|
| Range lab level | `researchLevel[3]`, global (not per-preset) |
| Range workshop level | `presetUpgradeWorkshopLevel[preset][4]` (attack stat index 4 = Range), this preset |
| Range card level | `cardLevel[4]`, global |
| In-round Range buys | `Main.upgradeLevel[4]` — resets to 0 each battle, not recoverable from a save |

**Attack Range formula** — `(1.0 + 0.02×labLevel) × (3.0 + 0.05×upgradeCount) × cardBenefit[4,level]`,
capped by `scale = 1 − 0.16×(min(raw,22)−8)/14` above raw 8 — is read directly
out of two real functions' actual writes to `maxDistance`:
`Main.GetOutOfRoundMaxDistance` (pre-battle, reads `upgradeWorkshopLevel[4]`
— the "Mid-battle" checkbox off) and `Main.CalculateUpgradeBonuses` (in-round,
reads `upgradeLevel[4]` — checkbox on). Cross-checked: at workshop level 79,
`79×0.05+3.0=6.95` matches TheTowerSDK's `workshop.json` value for Range
level 79. That's a secondary cross-check on the formula, which is already
confirmed independently from the two real writer functions above — not
where the formula came from. Same confirmed-from-code status for the
`6.0`-unit orbit floor, `×1.3` ceiling, and `1.5`-unit Sentry Protocol pulse
radius.

**Workshop Range's level-79 cap — now confirmed, from the user's own save,
not from TheTowerSDK.** The real cap lives in `Main.upgradeWorkshopMaxLevel[]`
(confirmed field, `dump.cs` offset `0xEA8`), a plain `int[]` — but it isn't
a compiled constant and isn't in the save either (checked directly: decoded
the live save and there is no `upgradeWorkshopMaxLevel` key among its
fields), and a search of the one locally-available RemoteConfig snapshot
(`firebase_activate.json`) turned up nothing either — so the cap's *source*
genuinely isn't visible in this static APK pull, still. But the cap's
*value*, and the storage convention around it, are now settled by direct
evidence instead: the user's own save has `presetUpgradeWorkshopLevel[1][4]`
(their active "Tourney" preset, attack stat index 4 = Range) stored as raw
integer **79** — matching the in-game UI's own "79" label exactly, with
their unused "Farming" preset's same slot at **0**. That's two real data
points, not an inference from a community table's missing row: the stored
integer equals the displayed level with no offset (0 = base/unupgraded, 79
= the max the UI shows), so counting is **0-79 inclusive**, not "1-79" —
0 reading as "never touched" rather than a valid first level is also
consistent with every other stat's raw counts in that same save array (99,
150, 200, 85, 100, 120 — all plain purchase counts). The tool hiding the
"Mid-battle" toggle at level 79 is now resting on a real, confirmed number.
The `wsLevel` input's own `max` attribute and the value the Attack Range
formula actually uses are both now clamped to 79 (previously the HTML
allowed up to 999 and the formula applied whatever was typed unclamped —
an impossible level would have silently produced an impossible range).

**Range lab's max level (80) — user-reported, not independently
APK-confirmed, unlike the Workshop cap above.** `Lab.researchLevelMax`
(confirmed field, `dump.cs`) exists but, checked the same way as
`upgradeWorkshopMaxLevel` was, isn't in the save either — populated
server-side at runtime, same as the Workshop cap's source. Unlike
Workshop, there's no equivalent save field (like
`presetUpgradeWorkshopLevel`) that happens to already sit at the real cap
to cross-check against, so this rests on the user directly reporting it
from their own account rather than two independent save data points. The
`labLevel` input is now clamped to this value (formula input and the
HTML `max`, both previously unbounded/999-ish) on that basis — genuinely
useful (an impossible lab level would otherwise silently inflate the
computed Attack Range), but one step less verified than the Workshop cap
until/unless independently confirmed another way.

**Card multiplier — now CONFIRMED directly from `Cards.Initialization()`,
not from TheTowerSDK.** The earlier raw-byte search (below, for the
record) concluded these values were unverified because none of the seven
showed up as a contiguous 4-byte float literal anywhere in the binary —
that conclusion was wrong, and the search method was why: ARM64 builds an
arbitrary 32-bit float constant from two *separate* 16-bit immediate loads
(`movz` for the upper half, `movk` for the lower half) when it doesn't fit
a cheap single-instruction encoding, so the full bit pattern never exists
as one contiguous blob in memory to find. A byte search was always going
to come back empty for values like these, independent of whether they were
right.

Found the real values by anchoring on something unambiguous instead of
searching for bytes: the localization term ID for the card's own display
name. `Cards` names its cards via `I2.Loc.ScriptLocalization.GT(int)`
(confirmed signature, `dump.cs`) — searched the game's own localization
string table directly for a short standalone entry reading "Range" and
found **term ID 6**. In `Cards.Initialization()`'s disassembly, the `GT`
call passing term `6` sits between the calls for term `16` ("Health
Regen") and term `257` ("Cash") — i.e. `HealthRegen(CardID=3) → Range
(CardID=4) → Cash(CardID=5)`, confirming both the anchor and that cards
are initialized in strict `CardID` order. Everything between that call and
the next card's `GT` call is unambiguously Range's own init code.

Reading that slice: a clean cascade gated on `cmp w8,#0x2` /`#0x3`/.../`#0x7`
(one branch per level 2-7), each branch building a 32-bit float via
`movz`+`movk` and storing it:
```
0x3F933333 = 1.15   0x3F99999A = 1.2    0x3FA00000 = 1.25   0x3FA66666 = 1.3
0x3FACCCCD = 1.35    0x3FB33333 = 1.4    0x3FB9999A = 1.45
```
That's TheTowerSDK's exact table, level for level — it was correct all
along; only the earlier verification method was inadequate. `cardBenefit`
is a real hardcoded per-level lookup table (not a formula — zero
`fmul`/`fadd`/`fdiv` instructions anywhere in `Cards.Initialization()`,
confirmed by disassembling the whole ~9,400-instruction function, so the
"maybe it's a formula" hypothesis is specifically ruled out for this
mechanism), and `CARD_BENEFIT_TABLE` in the tool's JS can now be treated
as confirmed rather than a placeholder.

## Workshop orbit

| Field | Source |
|---|---|
| Workshop level | `presetUpgradeWorkshopDefenseLevel[preset][9]` (defense stat index 9 = Orbs); coefficient confirmed +1 orb/level, cap of 4 NOT APK-confirmed (see "Still open") |
| Orb Perk | not save-detectable (Perks are in-round-only) — manual stack count, 0-2, **+1 orb per stack** (see below) |
| Primary Armor Orbs substat (+2) | read from equipped Armor's substat id 120 |
| Assist Armor Orbs substat efficiency | presence read from the save; efficiency % not save-verified |
| Vault "Orbs" node (+1) | `vaultUpgradeLevel(VaultID.OrbsCount /* = 280 */) > 0`, the `VaultManager` dictionary lookup — fixed from the old, wrong `powerNodesLevel[41]` read (see below); auto-detected from the save |

Everything above except the workshop level itself is described directly by
the user, not independently derived from the game's own out-of-round orb
formula — worth being explicit about, since decompiling that real formula
this pass surfaced two problems with how the breakdown above is sourced:

**The real out-of-round formula, decompiled directly
(`Main.GetOutOfRoundOrbCount`, RVA `0x020f9ea0`):**
```
orbCount = upgradeDefenseWorkshopLevel[9]
         + ModuleManager.OrbCount
         + (int)VaultManager.GetBenefit(vault, VaultID.OrbsCount /* = 280, dump.cs-confirmed const */)
```
where `ModuleManager.OrbCount` (also decompiled,
`ModuleManager$$get_OrbCount`, RVA `0x0216f028`) is itself just
`GetEquippedClusterBenefit(0x1a) + GetEquippedAssistClusterBenefit(0x1a)` —
the summed "Orbs" substat cluster across equipped and assist modules.

Two things fall out of reading this directly instead of trusting the
existing breakdown:
1. **There is no separate "Orb Perk" term anywhere in this formula.** Every
   term is accounted for by workshop level, the module/assist substat
   cluster, or the Vault node — none of them is a Perk. The tool's "Orb
   Perk +2" toggle doesn't correspond to anything found in the actual
   formula that computes orb count out of round. Either it affects orbs
   through some other, in-round-only code path not checked this pass, or
   the checkbox is modeling something that isn't real — genuinely open,
   flagging rather than guessing which.
2. **The "Orb Perk" is stackable, not the flat +2 this tool assumed —
   found by disassembling `Perks.Initialize()` (the function that fills
   `perkMaxLevel[]`/`perkBenefitUpBase[]`/`perkBenefitUpIncrease[]` with
   real literals) and decoding its `mov`/`movk` write cascade directly.**
   Perk index 7 stood out for three independent reasons: it's the *only*
   perk with `perkMaxLevel=2` across the whole decoded range (everything
   else nearby is capped at 1, 3, or 5); its `perkBenefitUpBase=0.0` /
   `perkBenefitUpIncrease=1.0` means the benefit formula (`base + increase
   × perkLevel`) gives exactly +1 at the first pick and +2 at the second;
   and `Perks.PerkBenefitUp` (decompiled earlier, while checking perk 44)
   explicitly special-cases indices 4 and 7 as the only two perks exempt
   from the research-lab scaling multiplier every other perk in that range
   gets — consistent with a plain, unscaled "+1 orb" pick. Separately,
   searching the localization table for "orb" turned up ID 2604 = **"Orbs"**
   (a perk-length catalog name) paired with ID 2605 = **"+{0} orb"** — an
   active-description format string with a live stack-count placeholder,
   exactly the phrasing a 2-pick stackable perk would use. Both lines of
   evidence converge on the same perk; the one hop not directly traced is
   the literal term-ID-to-index-7 link (perk *names* resolve at runtime via
   `Perks.UpdatePerksDescription`, which only processes whichever perks are
   currently on offer, unlike Cards' unconditional full-catalog init, so
   the same anchor technique used for the Range card doesn't apply
   directly here). **Fixed in the tool**: `orbPerk` is now a 0-2 stack
   count (`+1` per stack), replacing the old flat +2 checkbox.
3. **The Vault term reads the wrong save system.** `VaultID.OrbsCount = 280`
   (confirmed by name directly in `dump.cs`'s `VaultID` enum) is a
   `VaultManager`-dictionary lookup (`vault['<UpgradesLevel>k__BackingField'].KeyValuePairs`,
   keyed by VaultID) — the same *current* vault system already traced for
   Ranged Enemy Stand-off's Vault term above, not the older
   `TechTreeManager` flat-array system (`powerNodesLevel[41]`) this
   breakdown used to read. Checked the user's live save directly: its
   `vault` dictionary has 9 entries (keys 1240, 2010, 1020, 1230, 1250,
   1800, 1220, 1610, 1200), none of them `280` — so for this specific
   player the term is confirmed 0 either way, meaning this particular
   correction doesn't change today's plotted number, but the field being
   read was still the wrong one and would have mattered for a save that
   does have the node. **Fixed in the tool**: `VAULT_ORBS_COUNT_VAULT_ID =
   280` now drives the "Vault 'Orbs' node" checkbox via
   `vaultUpgradeLevel()`, replacing the old `powerNodesLevel[41]` read.

**Orb *radius* (not count) now auto-detects from the save where possible —
this was the tool's floor placeholder the whole session, now replaced with
real data.** `Main.get_WorkshopOrbAppliedDistance()`:
`if VaultManager.GetBenefit(vault, 0x7e4/*2020*/) > 0: return Main.workshopOrbDistance; else: return min(maxDistance, 6.0)`.
`workshopOrbDistance` (offset 0x2C4 on `Main`) is a real, live-adjustable
value the player sets via the in-game "Distance Adjuster" UI (confirmed:
`DistanceAdjusterUI.GetWorkshopOrbsDistanceText` reads this exact field and
multiplies by 10 for display - the same ×10 convention as Attack Range, so
this tool's raw-value-for-plotting / ×10-for-label split already matches
it correctly) — and it's mirrored 1:1 into the save under the same field
name. VaultID `2020` ("Workshop Orb Adjuster") gates whether it's actually
used at all; without it, the floor (6.0) applies regardless of whatever's
stored. This is a genuinely different save system than the Vault Power grid
above — `VaultManager`'s own `Dictionary<VaultID, int>`
(`vault['<UpgradesLevel>k__BackingField'].KeyValuePairs`, looked up by
VaultID directly), not `powerNodesLevel[]`'s positional array. The tool now
checks this directly and auto-sets the "Workshop Orb Adjuster owned"
checkbox and slider position when a save is loaded.

Card's equivalent field, `innerOrbDistance` (offset 0x2C0), shares the
exact same floor/ceiling formula as Workshop
(`get_InnerOrbMinDistance`/`get_InnerOrbMaxDistance`: `min(maxDistance,6.0)`
/ `maxDistance×1.3`) — but **no equivalent gated "applied distance" getter
was found for it**, unlike Workshop's. It's applied unconditionally here as
the best current guess. One thing that doesn't add up yet: on the user's
real save, `innerOrbDistance` is `3.0`, below its own floor of `6.0` for
their current Attack Range - either it's a stale value from earlier in
their progression (when Attack Range, and therefore the floor, was
smaller) and nothing re-clamps it, or Card has its own gate that hasn't
been found, in which case this tool may currently be applying a value the
real game doesn't. Left open.

**Workshop and Card orbs are NOT two independent rings — confirmed against
three of the user's own screenshots.** Earlier passes of this tool modeled
Workshop and Card as two separately-evenly-spaced rings (and before that, a
"base 4 + bonus" split within Workshop alone). Both models were wrong. The
real mechanism, cross-checked against a battle screenshot and two paired
calibration screenshots (same Workshop setup, Card slider at floor vs
ceiling): every active orb of *both* types shares ONE combined,
evenly-spaced angular grid — `angle_i = i × 360°/(workshopCount+cardCount)`.
All three screenshots (6 Workshop + 3 Card = 9 orbs each time) measured gaps
within a degree or two of 360°/9=40° around the *entire* combined set, not
two separate 60°/120° rings. Traced to `Main.OrbCheck`'s final step: it
LINQ-filters `Main.orbObjects`, merges in the Card ring's transforms when
the Extra Orb card is active, and evenly spaces the whole combined
`List<Transform>` with one loop
(`Transform.localEulerAngles.z = index × 360°/count`).

Each orb's *radius* is simply its own type's direct slider radius
(`wsR`/`cardR` in the tool) — **every orb of a type, no matter how many are
active, sits at the same radius. There is no bonus-orb compression.** An
earlier pass of this tool applied one: a compression-shaped formula does
exist in `Main.OrbCheck` (`compressed = ((r − 3.0) / (r × 0.05 + 2.0) + 3.3) × 1.166`,
computed from `Main.WorkshopOrbAppliedDistance` immediately before a loop
that positions orb slots 4+), and the identical shape appears in
`RotateInnerOrb.CheckOrbs` for Card orbs, so it seemed reasonable to assume
it applied to every Workshop/Card orb beyond the first 4. **Two independent
real screenshots disproved that**: a save with 4 base + 2 Workshop-bonus + 3
Card orbs measured all 9 orbs' radii within a 171.8–173.3px spread (1.5px,
i.e. noise) — the bonus orbs sit exactly on the same circle as the base
ones, not compressed inward or outward at all. So whatever that `OrbCheck`
formula actually gates is still unconfirmed — possibly some other, rarer
source of extra orbs than Orb Perk / Armor substat / Vault node — but it
isn't triggered by the ordinary ways a save ends up with more than 4
Workshop or Card orbs, and the tool no longer applies it.

**The combined list's build order — a real general rule now, not just a
single-example guess.** Still not traced in code directly (the LINQ/list-
merge logic runs into card-active branching this session didn't fully
unwind), but now pinned down empirically from two real screenshots at
different counts instead of one, which is enough to distinguish a fixed
rule from a general one. First data point: 4 base Workshop + 2
Workshop-bonus + 3 Card (6 Workshop, 3 Card total) measured
`Workshop×4, Card, Workshop, Card, Workshop, Card`. Second, independent
data point from the user directly reading their own screenshot: 7
Workshop (level + substats + a 1-stack Orb Perk) + 3 Card measured
`Workshop×5, Card, Workshop, Card, Workshop, Card`. Both fit one rule:
**`initialRun = majorCount − minorCount + 1`** (the more-numerous type
goes first, in a block just long enough that exactly `minorCount − 1` of
it is left over), **then the remainder alternates minor, major, minor,
…, minor** — the minor type opens and closes that alternating tail,
sandwiching the leftover major-type orbs one at a time. Check: `6−3+1=4`
✓, `7−3+1=5` ✓ — both screenshots match exactly, not approximately.
`buildCombinedOrbSlots()` now implements this directly (`majorN - max(0,
minorN-1)` for the initial run, then an explicit minor/major alternation)
instead of the old fixed "4 base" assumption. Only the Workshop-majority
direction has real screenshot evidence; a save with *more* Card orbs than
Workshop is handled by the same rule with major/minor swapped, which is
the natural symmetric extrapolation but hasn't been independently
screenshot-checked.

Re-confirmed with a second pair of screenshots at a different Lab Range
level (0 vs 70) and a much larger Workshop/Card radius split (Card pushed
out to roughly 2.3x the Workshop radius in one shot): all 9 orbs still sit
on gaps within a couple degrees of 360°/9=40° regardless of how far apart
the two radii are, the R×4-then-alternating-M interleave held in both
shots, and — usefully — moving the Card radius slider between the two
shots left every orb's *angle* unchanged (each within ~2° of its value in
the other shot) while only its distance from center moved; Lab Range level
itself had no visible effect on the orb ring at all (it only resizes the
separate attack-range circle). This is good evidence the angular grid and
the per-type radius really are independent, as modeled, rather than
something that happened to line up once by coincidence.

**Orbits freeze under Sentry Protocol — but there's no dedicated
"snap to formation" position.** Checked directly: `RotateInnerOrb.Update`
explicitly tests `ModuleManager.TryGetUniqueBenefit(instance, 0x32, ...)`
(0x32 = 50 = Sentry Protocol's infoIndex); when equipped it just sets
`rotateSpeed = 0` and returns, no repositioning call. `Rotate.Update`
(Workshop) doesn't check Sentry Protocol directly but bails out immediately
once `rotateSpeed` is 0 (zeroed by `Main.OrbCheck` when Sentry Protocol is
active). Both scripts just rotate a single shared pivot each frame
(`Transform.Rotate(0,0,speed×deltaTime×60,...)`) when active — so Sentry
Protocol only *stops* whatever continuous rotation was already happening;
the relative arrangement it freezes is whatever the combined-list formula
above had already set, at whatever absolute rotation phase the pivot
happened to be at.

**Sentry Protocol's mini-orb targeting radius — real value confirmed, and a
genuine unit-space bug found and fixed from real gameplay evidence, not
just a code read.** `Main.SentryProtocolFire`'s decompile calls
`Physics2D.OverlapCircle(orbPosition, 0x3fc00000/*=1.5f*/, ...)` once per
orb per tick to find a nearby enemy to fire a mini-orb at — a real, fixed
Unity-world-space radius, confirmed directly from the disassembly, same
category as Wall/Mine Radius/Space Displacer. The tool already had this as
`C.PULSE = 1.5`, correctly sourced — but was using it directly in
*plotted*-space math (the translucent halo drawn around each orb, and the
"no gaps" spacing check) without ever running it through
`trueWorldSizeToPlotted()` first, the same conversion every other
true-world quantity on this plot already gets. Caught by the user directly
from real gameplay, not by re-reading the code: three screenshots at a
very high-stat account (Range 160m+) showing three *non-adjacent* orbs (7,
8, and 9 on a 9-orb ring) all firing mini-orbs at one nearby enemy — real
adjacent-orb spacing at that account's scale is far larger than the
uncompressed 1.5-unit radius, but was being compared against a raw,
unconverted 1.5 as if it were already in the same (much larger, at that
scale) plotted-space units as the orbs' own positions. Fixed: the halo
radius and the gap-free threshold both now go through
`trueWorldSizeToPlotted(C.PULSE, ar.capped)` before use. A related, smaller
bug found while fixing this: the "Touch Workshop orbs" preset button was
adding raw `C.PULSE` directly onto a raw applied-distance value (`wsR`) —
two different unit spaces that only actually share meaning once both are
converted to plotted space — so that's now computed in plotted space and
converted back to raw applied-distance (via a numeric bisection inverse of
`computeOrbPlottedRadius`, since the compression curve has no closed-form
inverse) for the Card step slider, rather than mixing units directly.

**Orb dots now render to scale, not a fixed cosmetic size.** The plotted
dots (`drawBoard`'s `placed.forEach` loop) used a flat `r:3.2` SVG radius
regardless of zoom/scale - fine as a marker, but not an actual size.
Read the orb's real visual size directly off the same "Orb" scene
instance (`level1`, pathid 6629) that `ORB_PIVOT_PARENT_SCALE` already
uses for orbit *distance*: each orbiting `OrbObject` has a
`CircleCollider2D` with `radius=0.27` in its own local space, its own
`localScale=0.88`, sitting under a `Container` (scale 1.0) under the
shared `Orb` parent (scale 0.43, the same value `ORB_PIVOT_PARENT_SCALE`
already names) - net native radius `0.27 × 0.88 × 0.43 ≈ 0.1022` true
world units. Cross-checked against the equipped ball skin's own sprite
(`ball_assassin`, 60×60px @ 100 PPU → native radius 0.3) - a bit larger
than the collider, which is normal (hit colliders commonly run a bit
smaller than their sprite for gameplay fairness); used the collider value
since it's skin-independent, unlike the sprite. `ORB_NATIVE_RADIUS` now
goes through the same `trueWorldSizeToPlotted` conversion as every other
true-world size on this plot (Wall, Mine Radius, PULSE), floored at
1.5px so a dot never disappears at very compressed scales.

**Same fix applied to the mine-ring dots (Inner Land Mine, Extra Set,
Space Displacer)** - the user flagged that these were still fixed-size
after the orb fix above. `drawRing` (the shared function all three mine
rings use) had the same flat `r:3.2`. Read the mine icon's own visual
size off the same `level1` scene data already used for the ring-radius
work: the `landMine` Sprite (156×156px @ 100 PPU, `localScale=0.3` →
native radius 0.234) - and confirmed it's the *same* sprite/prefab under
all three ring types by reading all three controllers directly this
time, not assumed: the primary and Extra Set controllers' own `Sprite`
children (already read for the ring-radius work), plus the "Workshop
Land Mine Controller" (`level1`, pathid 1415, 50 `DropLandMine` slots -
this is the real Space-Displacer-linked instance, `EnemyDrop`-type
mines that get converted) - each `DropLandMine` carries both a
`dropLandMine` sprite (its un-converted look, 200×200px @ 100 PPU,
scale 0.2 → native radius 0.2) and a `moduleSprite` using the identical
`landMine` texture at scale 0.3 (native radius 0.234, matching the other
two rings exactly) - the one that's actually visible once Space
Displacer converts it. `MINE_ICON_NATIVE_RADIUS = 0.234` now feeds
`drawRing`'s dot radius the same way `ORB_NATIVE_RADIUS` feeds the orb
dots - `trueWorldSizeToPlotted`-converted once in `drawBoard`, floored
at 1.5px.

**Checked, no fix needed: whether Space Displacer's converted mines
render smaller than the other two rings.** The user thought they looked
slightly smaller in-game. Traced the actual field-level PPtr layout of
`LandMine`'s `moduleSpriteRend` (decompiled `LandMine.Awake()` and
`LandMine.ActivateModuleLandmine()`, RVAs `0x020b59c4`/`0x020b5e24`, and
manually parsed the MonoBehaviour's raw PPtr fields byte-by-byte to
confirm which child GameObject each one actually points to, rather than
matching by field name alone): `moduleSpriteRend` resolves to the
`moduleSprite` child - the same `landMine` sprite at the same 0.3 scale
already used for `MINE_ICON_NATIVE_RADIUS`. `ActivateModuleLandmine()`
(the function `LandMineController.Play()`'s `type==1` branch calls when
`ModuleManager.TryGetUniqueBenefit` succeeds, i.e. exactly the Space
Displacer conversion path) explicitly resets that transform's
`localScale` back to `moduleDefaultScale` - its own cached, unmodified
Awake()-time value, not a reduced one - then plays a `DOPunchScale`
tween (a brief elastic "pop" overshoot-and-settle animation on
conversion, not a persistent resize). No code path was found that
leaves a converted mine's icon permanently smaller than 0.3/0.234. Left
`MINE_ICON_NATIVE_RADIUS` shared across all three rings; the visual
impression is most likely either the transient punch-in animation caught
mid-bounce in a screenshot, or an optical-density effect from mines
sitting closer together at that ring - not something to model as a
different constant without further evidence.

**Follow-up, same investigation: found and confirmed the real docking/
spacing system the user described, but it still doesn't scale anything.**
The user reported watching converted mines visibly dock into place and
pack tighter as more join, and asked specifically where `dockingSpeed`/
`maxDockingSpeed`/`spacingSpeed`/`maxSpacingSpeed` (declared on
`LandMineController` but unreferenced by any of that class's own methods)
are actually used. Found it: not in `LandMineController` at all, but in
`Main.UpdateTimers()` (RVA `0x020cffe4`), which reaches into
`Main.landMineExtra`'s (and the Space-Displacer-linked controller's)
fields directly. Per active mine, every fixed-update tick, it:
1. **Docks radially** - `delta = (currentDistanceFromTower -
   moduleTargetRadius) * dockingSpeed`, clamped to `±maxDockingSpeed`,
   moves the mine that far toward/away from the tower.
2. **Spaces angularly** - target angle = `360° / (currently-docked count)
   × this mine's index`, lerps the mine's position toward that
   evenly-spaced slot at a rate clamped by `spacingSpeed`/
   `maxSpacingSpeed`.

This is a real, confirmed, count-aware positioning system - exactly
matching what the user observed. But it is *positioning only*: the whole
block (traced line by line) calls `Transform.set_position` exclusively,
never `Transform.set_localScale` - confirmed by grepping the full
decompiled function text for `localScale` (zero hits) as well as for
scale generally. Also checked whether `moduleTargetRadius` itself might
be dynamically shrunk as count grows (which would produce the same
visual effect via a tighter ring instead of smaller icons): searched
every write to that field's byte offset (0x44) across the **entire**
decompiled binary, all ~15,000+ functions, not just LandMineController's
own methods - every hit belongs to an unrelated class (Spine animation,
UI layout, particle systems - coincidental offset collisions), meaning
`moduleTargetRadius` is written exactly once, at the prefab level (1.8),
and never touched by any runtime code.

**Conclusion: no shrink-to-fit system exists in code, at any level -
neither icon scale nor ring radius change with count.** The docking/
spacing system only ever repositions mines onto the fixed 1.8 ring,
evenly spaced by current count. The most likely explanation for the
visual impression of "smaller with more mines" is packing density: up to
20 same-size icons (`SPACE_DISPLACER_MINE_CAP`, see below) sharing one
fixed circumference means much smaller angular gaps between neighbors at
high counts, which can read as "smaller" without any icon actually
changing size. Not modeled as a size change without further evidence,
per the same standard as the finding above.

**`SPACE_DISPLACER_MINE_CAP` corrected from 19 to 20**, confirmed by the
user's own direct in-game count. Reconciles cleanly with the cap-check
found earlier this session in `LandMineController.Play()`'s `type==1`
branch (`iVar12 > 0x13`, i.e. `count > 19` blocks further conversions) -
that's a "greater than 19" guard, which lets counts 0 through 19 through,
i.e. 20 simultaneously active - not a "maximum of 19" as the constant's
name previously implied. The earlier write-up undersold its own evidence
by misreading the comparison direction.

**Retraction: the "no fix needed, same size" conclusion above (whether
Space Displacer mines render smaller) was wrong - there IS a real,
measured size difference, and its source is still unknown.** The user
sent a direct side-by-side crop of two mine icons, one confirmed from the
inner ring (Inner Land Mine, ~8 mines) and one from the outer ring (Space
Displacer converted, ~19-20 mines), both in a settled/non-docking state
(ruling out the transient `DOPunchScale` pop-in animation as the cause).
Measured with 2D connected-component blob detection on the raw crop
(brightness threshold, not a subjective read): **40×40px bounding box
(area 403) for the inner-ring mine vs. 36×37px (area 258) for the
outer-ring mine** - a real, consistently-measured ~8% smaller diameter
and ~36% smaller area, not noise.

Went back and checked every remaining mechanism that could explain this,
beyond what's documented above:
- **The actual spawn trigger, `Enemy.TrySpawnLandMine`** (RVA
  `0x0241ab40`, found via a full-binary search for anything referencing
  `Main.dropLandMineController`, i.e. `Main`+`0x12B8` - a field this
  session hadn't previously located; the earlier work only ever checked
  `Main.landMine`/`landMineExtra`) - the actual per-enemy-death call site
  that starts a Space Displacer drop. Just a roll-and-call: `Main.
  IsDefenseUpgradeEnabled(0xc)` gate, a random-chance roll, then
  `LandMineController.Play(enemyPos, dropLandMineController)`. No scale
  code here either.
- **Multiple prefab slots, not just slot 0** - not re-verified across
  every slot individually this pass, but both controllers' slot-0 sprites
  were already confirmed identical (texture, rect, PPU, scale) via direct
  PPtr dereference.
- **Material/shader** - both `Sprite` (primary) and `moduleSprite`
  (Space Displacer) use the identical `Sprites-Default` material and
  shader (pathid 2 / 10753), identical `m_Color=(1,1,1,1)`, identical
  `sortingOrder=10`. No per-instance shader property override exists to
  find (no custom material instances, just the shared default one).
- **Perspective camera / depth-based size falloff** - checked all 4
  cameras in `level1`: `Background Camera` and `Golden Tower Camera` are
  perspective, but the actual `Main Camera` (pathid 36145, the one that
  matters) is orthographic with identity rotation `(0,0,0,1)` - a plain
  top-down view with zero tilt. Orthographic projection is distance-
  invariant by definition, so this cannot explain a radius-dependent
  size difference, ruling this out cleanly rather than by assumption.
- **RemoteConfig** - no snapshot of this game's actual fetched RemoteConfig
  data exists anywhere in this repo to check (only the Firebase
  RemoteConfig SDK binaries themselves, not fetched values) - can't
  confirm or rule this out from static APK analysis. This is the most
  plausible remaining explanation: if either mine type's scale (or the
  docked ring's some other radius-linked value) is server-configured
  rather than compiled in, it would be genuinely invisible to everything
  checked above, since none of it is baked into the APK at all.

**Status: genuinely unresolved, but narrowed further.** Every code and
asset path traceable from the decompiled APK - icon sprite/texture/PPU/
scale (identical), every scale-setting function in `LandMine`/
`LandMineController` (identical, always resets to a fixed constant),
every write to `moduleTargetRadius` in the entire binary (none, fixed
prefab value), the full parent chain for both controllers (identical,
both root-level, unscaled), materials and shaders (identical), and the
camera projection itself (orthographic, untilted, distance-invariant) -
has been checked and found identical between the two mine types.

**New data point: the user sent a second side-by-side crop, this time
from a much lower-range account, and measured almost no gap** (blob
method again: 71×72px/area 3531 inner vs. 68×70px/area 3197 outer, ~4%
dimension / ~9.5% area - close to measurement noise at this resolution)
- vs. the earlier high-range crop's clear ~8% dimension / ~36% area gap.
So the gap itself is progression/account-state-dependent, not a fixed
per-ring constant - which rules out a hidden *static* per-type scale
value even existing to find (nothing static could produce a gap that
appears at one account state and not another).

Checked whether this could be camera-zoom-driven (the next obvious
progression-linked culprit): `Camera.set_orthographicSize` genuinely is
called at runtime (found via `Main.MainCameraSizeCheck`, RVA
`0x020dd2d8`), but only inside a Chrono Field-benefit-gated branch - not
a general "zoom out as `maxDistance` grows" system. Base gameplay camera
zoom is fixed. Rules out camera zoom as the cause.

**Current best (unconfirmed) hypothesis: a sampling artifact from
`DOPunchScale`, not a persistent size difference at all.** Already
established that `LandMine.Activate()`/`ActivateModuleLandmine()` both
play a real, ~0.5s `DOPunchScale` tween on every conversion/(re)activation
- not instant. A late-game/high-range account (the high-range screenshot
here is wave 1000+, extremely high DPS) kills enemies fast enough that
Land Mine drops and Space Displacer conversion rolls happen constantly,
cycling through up to 20 mine slots (explode → `FindNextAvailableIndex`
re-slot → redrop → reconvert) - meaning at any instant, a real fraction
of Space Displacer's mines could be caught mid-tween in a screenshot. A
low-range account's much slower kill rate means mine turnover is rare
enough that a random screenshot is very likely to catch every mine
already settled. Inner Land Mine's own count doesn't have this problem
the same way - it's small (3-8) and driven by the Ultimate Weapon's own
cooldown-gated burst, not continuous enemy-kill events, so it churns far
less regardless of account progression. This would fully explain both
the range-dependence and why no *static* per-type difference was ever
findable in code - because there isn't one; it's a transient effect from
a mechanism already found and (wrongly) dismissed as irrelevant earlier
in this same investigation. Not independently confirmed - the proposed
test is whether the *same* mine's measured size fluctuates across two
screenshots of the same high-range account taken a few seconds apart.

Left `MINE_ICON_NATIVE_RADIUS` as-is either way (still the best-evidenced
static value for what's actually in the APK, and if the punch-scale
hypothesis is right, the "true" resting size already equals this
constant - what varies is just how often a screenshot catches a mine
away from it, not the constant itself).

## Reference lines

**Wall** — the Wall object's own true Unity world-space radius is
**0.78m**, confirmed two independent ways and not in doubt:
`TheWall` GameObject, `CircleCollider2D.radius = 1.3` ×
`Transform.localScale = 0.6` (no parent, nothing compounding it) = 0.78;
cross-checked via its `SpriteRenderer`'s own sprite (`wall`, 512×512px @
187 PPU, fills its canvas edge-to-edge with no padding — confirmed by
extracting and viewing the actual texture) → native radius 1.37 × the same
0.6 scale ≈ 0.82. Both found by loading the game's real Unity scene data
directly (`level1`, reassembled from its split parts, read with UnityPy).

That 0.78m was plotted directly on this tool's shared "meters" ruler for a
long time, and it rendered far too small compared to real screenshots -
the user pushed on this repeatedly, and the true bug turned out to be a
unit-space mismatch, not a wrong measurement. `Main.maxDistance`'s raw
value (~20.3 for this save) *is* a genuine Unity world-space distance for
real gameplay logic (Space Displacer's mine placement and the actual
attack/hit-test code both use raw stat values directly - see below) - but
the visible on-screen ring the player sees for Attack Range is a separate,
purely cosmetic indicator object, not a literal drawing of that raw
distance. That object is `Main.towerRadiusObject`, confirmed (not
assumed) to be GameObject `Radius` (pathid 918 in `level1`) by directly
reading `Main`'s own serialized MonoBehaviour bytes and finding its PPtr
sandwiched exactly between `wallObject` and `towerRange`'s PPtrs, at the
byte offsets predicted by matching dump.cs's field declaration order.
`Main.MainCameraSizeCheck` overwrites this object's `Transform.localScale`
every single frame via `(x-3)/(x×0.05+2)+3.3` (`x` = raw `maxDistance`) -
a saturating curve that exists purely so the ring doesn't become absurdly
large on screen as `maxDistance` grows with player progress. The `0.05`
and `3.3` are real compiled float constants (Ghidra labels
`DAT_00d33420`/`DAT_00d33658`), read directly out of `libil2cpp.so`'s data
section with a headless Ghidra script (`read_data_values.py`) - not
guessed, not inferred from pixels. That object's own sprite (`Circle`,
4×4px @ 4 PPU → native radius 0.5) times that curve gives its true
on-screen Unity-world size: for this save (`maxDistance` ≈ 20.316),
`0.5 × [(20.316-3)/(20.316×0.05+2)+3.3] ≈ 4.52` - wildly different from
raw `maxDistance` itself, and the reason comparing Wall's raw 0.78
directly against "203.16m" was apples-to-oranges from the start.

So Wall's real 0.78 world-space size now goes through that same "how big
does this actually render" pipeline before being placed on the shared
ruler: `computeWallRadius(x) = (0.78 / attackRingWorldRadius(x)) × x`,
i.e. express Wall's true size as a fraction of the Attack Range ring's
true rendered size, then scale that fraction by the player's own
`maxDistance`. For this save that comes out to ≈3.51 raw units → **≈35m**
displayed, not 0.78m - matching the real screenshot far better than the
old flat constant, though not pixel-perfect (a direct pixel measurement of
the screenshot's wall ring implies something closer to ~55m; the
remaining ~1.5× gap is most likely measurement slop from the wall
sprite's own glow/bloom rendering extending past its exact collider edge,
not a wrong constant at the time - chased further after the user kept
flagging the visual mismatch, see below).

**The 1.5× gap turned out real, not slop - checked and ruled out every
code-level explanation, landed on bloom/glow post-processing as the
remaining one, and pinned down *why* it's specifically additive, not
multiplicative.** Went back through this systematically: re-verified the
sprite's `m_DrawMode = 0` (Simple, not Tiled/Sliced - so `Transform.
localScale` genuinely does control render size, no independent `m_Size`
override hiding anything); read `RebuildWallFunction`'s and
`StartNewRoundWallFunction`'s actual coroutine bodies end to end - both
rescale `wallObject` (zero it, tween back up via DOTween over ~1.25s) but
settle at the *same* steady-state `defaultWallScale × currentMultiplier`
either way, not a different one; confirmed only one `Main` instance exists
in the scene (not reading a stale copy); confirmed `TheWall` and
`Main.towerRadiusObject` share the same rendering layer (13) and that only
one camera (`Main Camera`) renders that layer at all, ruling out a
multi-camera zoom mismatch between them; confirmed the formula's `-3.0`
and `2.0` literals are genuine hardcoded constants, not disguised `DAT_`
references. With every code path exhausted, measured the *shape* of the
remaining gap directly rather than just its size: Ranged Enemy's ring
(thin, dashed) measures ~18px bigger than its own formula predicts, Wall
(thick, solid, the single brightest element on screen) measures ~35px
bigger - both roughly *constant-width* gaps in screen pixels, not a shared
percentage, and larger for the brighter/thicker source. That's the
signature of real-time bloom specifically (halo width is roughly constant
in screen space regardless of source shape, and scales with source
luminance/area) - not a multiplicative "1.5× bigger" effect, which is what
made the first pass at this explanation feel unconvincing and rightly got
pushed back on.

**Resolution: one number, not two.** Wall's true collider/sprite geometry
(`computeWallRadius()`, ≈35m for this save) is what's plotted. The
bloom-inflated on-screen appearance is real but isn't save-data-dependent
- it's a function of this screenshot's resolution and rendering, and
wouldn't generalize to a different player's stats or a different device
the way `computeWallRadius()` does. A screenshot will always look
somewhat bigger than this plot for Wall specifically (more than for
Attack Range/Ranged Enemy, because it's the brightest, thickest element)
- that's expected and doesn't mean the plotted number is wrong.

The Wall is also the one landmark with a real, distinctive in-game look
(the other reference lines are abstract stat boundaries, plotted as plain
dashed circles), so it gets its own rendering: `drawBrickWall()` draws
actual brick geometry - two rings of small trapezoidal blocks, staggered
half a brick between the inner and outer row (a real masonry bond, not two
identical rings), wrapped in an SVG glow filter - rather than reusing a
texture image, so it scales cleanly with the plot's zoom at any radius.
Based on directly extracting and viewing the game's own `wall` sprite this
session (512×512px, fills its canvas edge-to-edge, genuinely two-to-three
concentric brick tracks - confirming what the user described early on as
"3 light blue circles close together").

This reopens, rather than closes, the "Inner Land Mines fit inside the
Wall, Space Displacer sits outside it" ordering below: that check was run
against the *old*, un-converted numbers (raw Wall vs. raw Mine Radius vs.
raw Space Displacer, all compared directly). If Wall genuinely needs this
same "true rendered size, not raw stat value" conversion to land on the
player-visible ruler, Mine Radius and Space Displacer almost certainly do
too — and simply are not yet fixed the same way, not that Wall is
uniquely wrong. Left open; flagged rather than re-guessed.

**Land Mine Radius** is computed from `Main.CalculateUpgradeBonuses`' real
formula: `0.5 + 0.02×level + module bonus` — level read from the Workshop
Land Mine Radius stat (assumes the same workshop-seeds-the-in-round-counter
pattern confirmed for Range), module bonus auto-summed from equipped Armor's
actual Land Mine Radius substat(s). That raw formula output is divided by
`C.DISPLAY_SCALE` before plotting, same as Space Displacer/Wall - all three
are genuine, uncompressed Unity world-space quantities (unlike Attack
Range/Ranged Enemy/Orbit, which go through the cosmetic ring-compression
curve), confirmed for this one specifically by tracing the actual
positioning code, not assumed by analogy.

**Land Mine Radius - real native-collider multiplier found, same category
of fix as Wall (fixed collider × scale), not the orbit's hidden
parent-scale bug.** `LandMine.SetExplosionRadius` runs
`Transform.set_localScale(radius, radius, radius, ...)` directly on the
"Area of Effect" collider's own transform - the raw formula output becomes
a *scale*, not a radius. Found the real object (not assumed) by reading one
actual `LandMine` instance's serialized MonoBehaviour bytes directly
(`level1`, pathid 116724) field-by-field to resolve the true `areaOfEffect`
PPtr, then walked its full parent chain: "Area of Effect" (`CircleCollider2D`
native radius `0.9`) → `Container` → `LandMine` → "Inner Land Mine
Controller - Extra" (root-level) - every single link `scale = 1.0`,
confirmed, no hidden compounding parent scale the way orbs had. So the fix
here is simple and complete: true world radius = `0.9 × (0.5 + 0.02×level +
module bonus)`, not the raw formula output alone - `MINE_AOE_NATIVE_RADIUS`
implements this.

**Re-checked specifically for the DrawLine-style hidden-visual bug found on
Ranged Enemy Stand-off — confirmed clean, not the same issue.** "Area of
Effect" does have a sibling GameObject (also under `Container`) literally
named "Sprite" - so a separate visual object exists here too, same as
Ranged Enemy's `DrawLine`. But it's the mine's own icon/body art (sprite
`landMine`, 156×156px @ 100 PPU, `localScale=0.3` → effective visual size
≈0.234), not a blast-radius ring - its size has no reason to match the
collider's 0.9 blast radius, since it represents what the mine looks like,
not how far it explodes (two unrelated properties of the same object,
unlike Ranged Enemy's collider and `DrawLine`, which both represented the
*same* "how far to stay away" quantity via different rendering paths).
There's also no known player-toggleable "show mine blast radius" debug
view the way `HitTextSettings.showRangeOfRangedEnemy` exists for Ranged
Enemy, so there's no separate visual ring to even chase *for blast
radius specifically*. Re-confirmed the full parent chain independently
too (Area of Effect → Container → LandMine → Inner Land Mine Controller -
Extra, all scale 1.0). Conclusion, unchanged: `MINE_AOE_NATIVE_RADIUS =
0.9` (blast radius) is correct as-is - no fix needed for that quantity.

**Correction, same session: "no separate visual ring to even chase here"
above was too broad - there genuinely is one, just not tied to blast
radius at all.** The user pointed out real screenshots show an actual
ring of mine icons close to the tower, distinct from Space Displacer's
own ring farther out - a mine-*position* ring, not the blast-radius
boundary this tool had been plotting as "Inner land mine" the whole time.
Traced it properly this time: `LandMineController.Play`'s Ultimate-type
branch (`type=0` - confirmed via `dump.cs`'s `MineType` enum: `Ultimate=0,
EnemyDrop=1, ExtraSet=2, MagneticMine=3` - this is the real Inner Land
Mine *Ultimate Weapon's* periodic burst, not a Space-Displacer-adjacent
thing) only sets each mine's rotation angle
(`localEulerAngles.z = i×360/count`) and its blast-radius scale - no
position call at all. Reading the real "Inner Land Mine Controller" scene
instance (`level1`, the 12-slot Ultimate-type controller) explains why:
each `LandMine`'s own pivot sits at its parent's origin (matching what
gets rotated), but its actual visible content (`Container`, holding the
Sprite and the "Area of Effect" collider) sits at a fixed local offset of
`(0, 0.65, 0)` from that pivot - checked on two different mine slots,
identical both times (a shared prefab value). Rotating the pivot sweeps
that fixed 0.65 offset around in a circle - the exact same mechanism as
the Orb system's Container pivot, and the same *category* of true-world
size needing `trueWorldSizeToPlotted` as Wall/Space Displacer/PULSE, just
a different specific bug than any of those (a genuinely separate radius
this tool had never modeled at all, not a wrong conversion of one it had).
`INNER_LAND_MINE_ORBIT_RADIUS = 0.65` now implements this, and "Inner
land mine" renders as an actual mine-dot ring (`isMineRing: true`, same
style as Space Displacer) instead of a dashed blast-radius line. Blast
radius itself is untouched and still correct - it just no longer has a
landmark of its own on the plot, only the "Snap Card ring to blast
radius" button.

Also found at the time, not yet modeled: `Inner Land Mine Controller -
Extra` (`MineType.ExtraSet`, 6 slots) uses a *different* Container offset
- 1.2, not 0.65 - a possible third ring depending on account progression
that hadn't been chased down further. **Identified later the same
session as the "Extra Set of Inner Mines" Perk (see below) - and after a
same-session wrong turn (briefly concluded, from an eyeballed screenshot
crop, that it rendered on the same 0.65 ring - retracted a few messages
later once pixel-measured properly and re-checked against the scene data
a second time): it IS a genuinely separate, farther-out ring at 1.2, as
this paragraph originally found. `EXTRA_SET_MINE_ORBIT_RADIUS = 1.2` is
what the tool currently implements.**

**Mine count now wired to the save.** `Main.GetInnerLandMineQuantity()`'s
disassembly (re-decompiled: `Main__GetInnerLandMineQuantity`, RVA
`0x020f051c`) hardcodes array byte-offset `0x54` on both
`ultimateWeaponLevel` (`Main`+`0x10D8`) and `ultimateWeaponMaxLevel`
(`Main`+`0x10E0`) - `0x54 = 0x20 (Il2CppArray data start) + 13×4`, i.e.
flat index 13 into `ultimateWeaponLevel[]`. That array is a flat,
9-weapons × 3-base-stats-per-slot layout (confirmed independently via
`TheTowerSDK`'s `src/save/ultimate-weapons/read.ts`:
`UW_SAVE_BASE_STAT_LEVELS_PER_SLOT = 3`, weapon slot order Chain
Lightning/Smart Missiles/Death Wave/Chrono Field/**Inner Land Mines**/
Golden Tower/Poison Swamp/Black Hole/Spotlight, i.e. Inner Land Mines =
slot 4), each slot's 3 stats in the same order as `dump.cs`'s adjacent
`Main.GetInnerLandMineDamage`/`GetInnerLandMineQuantity`/
`GetInnerLandMineCooldown` declarations (Damage/Quantity/Cooldown) - so
flat index = 4×3 + 1 = **13**, matching the disassembly exactly. (The
naive "just count `Get*` declaration order" trick that worked for
`CardID` earlier this session does NOT reproduce 13 on its own here -
counting from `GetChainLightningQuantity` gives Quantity=12, off by one
somewhere before `GetBlackHoleSize`, whose independently-confirmed
`BLACK_HOLE_SIZE_STAT_INDEX=21` constant lands at ordinal 20 by pure
counting. The two independent confirmations above - direct disassembly
of this exact function, and the SDK's own save-chunking scheme - agree
with each other regardless, so 13 is treated as confirmed; the ordinal
mismatch is flagged rather than silently ignored, per this doc's own
sourcing standard.) The full formula from the same disassembly: `count =
3 + max(0, level)` where `level = ultimateWeaponLevel[13]`, `+
ModuleManager.InnerLandMinesQuantity` module bonus.
`applyPresetIndex()` now reads `saveRoot.ultimateWeaponLevel[13]` (global,
like Lab levels - Ultimate Weapons aren't per-preset) and auto-fills
`innerLandMineCount`; the field stays manually editable (default 3, the
formula's base) for saves where the array is absent or the weapon isn't
unlocked yet. Verified against the user's own save: `ultimateWeaponLevel`
has 27 entries (9 weapons × 3 stats), Inner Land Mines unlocked, index 13
= 2 → auto-filled count 5.

**Module term wired too, same session, after the user flagged it was
missing.** `ModuleManager.get_InnerLandMinesQuantity()` (re-decompiled,
RVA `0x0216f7e0`) is just
`GetEquippedClusterBenefit(0x3d) + GetEquippedAssistClusterBenefit(0x3d)`
- clusterId `0x3d` = 61. Identified via `TheTowerSDK`'s own game-data
catalog (`src/data/modules/enums.data.ts`): clusterValue 61 =
`Inner_Land_Mines_Quantity`, category **Core** (not Armor - a module
category this tool had never read before; only Armor has dropdowns/
detection, for Sentry Protocol). Its effect ids in
`src/data/assets/data.ts` are 274/275/276, `benefitType: 1` (flat add),
values +1/+2/+3 at rarity 6/8/10 = Legendary/Mythic/Ancestral - the same
shape as the existing "Orbs" Armor substat (ids 119/120), just one tier
lower (starts at Legendary, not Mythic) and on a Core module instead.
Implemented by generalizing the existing Armor-module save-resolution
pattern to Core: `resolveEquippedCore(i)`/`sumCoreSubstatValue(label)`
mirror `resolveEquippedArmor`/`sumArmorSubstatValue` exactly (same
`moduleEquipped[CORE_CATEGORY_IDX]` / `assistModuleSlots` / preset-GUID
resolution, `CORE_CATEGORY_IDX = CATEGORY_ORDER.indexOf('Core')` = 3),
reusing the same `inventoryByGuid` `buildInventoryIndex()` already builds
for Armor (it isn't category-filtered, so Core items were already being
indexed, just never read). New ids 274/275/276 added to the existing
`SUBSTAT_DETAILS` table (label `"Inner Land Mines - Quantity"`). New
field `modMineCount` ("+ Inner Land Mine count from modules") is
auto-filled from `sumCoreSubstatValue('Inner Land Mines - Quantity')` on
preset load, editable like `modMineRadius` already was for Land Mine
Radius, and summed with `innerLandMineCount` at the landmark-push site in
`render()` (capped at 40 combined, up from the old un-module-aware cap of
20). Checked against the user's own save: neither the equipped Primary
nor Assist Core module (infoIndex 37 "Multiverse Nexus", infoIndex 38
"Dimension Core") currently has this substat unlocked among their rolled
effects, so the auto-filled value is correctly 0 for that save - the
wiring itself is exercised and correct, just nothing to show yet on this
particular account. Space Displacer's own mine count remains manual (see
below - no save-provable formula found for it, a different gap; it has
no comparable module-bonus term in its own formula either).

**Third ring identified: "Extra Set of Inner Mines" Perk, same session,
from real gameplay screenshots.** The user provided two screenshots
(different waves, 1004 and 1011, same run) and named the mechanic: a
Perk, picked at most once per run, that adds a visibly distinct third set
of mine markers. Cropped and compared both closely (~2x zoom around the
tower): both show the same dashed yellow ring already modeled as "Inner
Land Mine," but with 2 of the dots rendered as small solid-magenta
circles (no white ring/border) at consistent positions relative to the
larger white-ringed dots - a real, repeatable visual distinction, not a
one-off animation artifact, and clearly on the *same* ring, not farther
out.

Re-decompiled `LandMineController.Play()` in full this time (RVA
`0x020b8024` - the earlier decompile in this session only captured the
`type==0`/Ultimate branch). Its `type==2` (`MineType.ExtraSet`) branch is
structurally identical to `type==0`'s: same
`localEulerAngles.z = i×360/count` rotate-into-place loop,
`LandMine.SetExplosionRadius`, `LandMine.Activate` per slot - except
`count` is read directly as this controller's own `landMines[]` array
length, not via a `Main.GetInnerLandMineQuantity()`-style formula call.
This confirms the "Extra Set" mines are a real, separate set of rotated
mine *positions* (matching the user's description), always fully
activated when this Perk fires (no partial-quantity gating the way the
primary Ultimate set has) - and, from the earlier scene read this
session, that array is 6 slots long (`Inner Land Mine Controller -
Extra`, pathid 106768).

**Retraction, same session: the "same ring" conclusion above was wrong.**
It rested on a subjective read of a 2x-upscaled crop (2 dots that looked
smaller/differently-colored), not a measurement. The user pushed back
directly ("+6 mines on the same ring" is wrong - check how the game
renders them). Redid it properly this time, two ways:

1. **Pixel measurement, not eyeballing.** Wrote a script to find every
   pink/magenta blob in both screenshots (`scipy.ndimage.label` on a
   color-threshold mask), compute each one's centroid and distance from
   the tower's own hexagon icon (independently located via its cyan
   color). Result: every genuine mine-dot-shaped blob in both screenshots
   clusters tightly at one radius (≈190-205px, ~10 dots, roughly evenly
   spaced by angle) - no second population at any radius. The two
   farther-out magenta-ish blobs the broader color search initially
   turned up turned out to be unrelated UI (a Guardian-bot marker and a
   target reticle), not mines, once cropped and viewed directly. So the
   screenshots themselves don't actually show a second ring at all in
   this rigorous read - the original "2 small dots" observation was very
   likely just 2 of the same ~10 primary-ring dots, misread.
2. **Re-checked the scene data directly, not from memory.** Reassembled
   `level1_full` fresh and read both controllers' full `LandMine` child
   hierarchies with UnityPy. The primary controller (`level1`, pathid
   2861/104151, `type=0`) has every `LandMine`'s own transform at local
   `(0,0,0)`, with only the *child* `Container` carrying the 0.65 offset
   - matching what was already documented. The Extra controller (pathid
   4690/106768, `type=2`) is structurally different: it has only 6
   `LandMine` slots, and each `LandMine`'s *own* transform already
   carries a distinct, non-zero local position - `(-1.028, 0.602)`,
   `(1.012, 0.602)`, `(0, -1.198)`, `(1.021, -0.598)`, `(-1.013, -0.587)`,
   `(0, 1.22)` - each ≈1.17-1.22 from the controller's origin. Since
   `Play()`'s `type==2` branch rotates each `LandMine`'s *own* transform
   (not the `Container`'s) around that origin, this bakes a genuine
   ≈1.2-unit orbit radius directly into the mine's position, independent
   of (and redundant with) the `Container`'s own 1.2 offset on this
   instance.

Both checks agree the scene data was right the first time: this is a
real, separate, farther-out ring, not the same one. Implemented as
`EXTRA_SET_MINE_ORBIT_RADIUS = 1.2`, its own landmark
(`trueWorldSizeToPlotted`-converted, same as every other true-world-size
landmark on this plot), pushed only when `extraSetPerk` is checked - a
manual in-round-only checkbox (like `rangedEnemyPerkActive` and the
original `orbPerk` before it became a stacked input - Perks are never in
the save), separate from the base ring's `innerLandMineCount`/
`modMineCount` terms.

**A second, separate bug found later: getting the true world size right
isn't enough if the surrounding plot math throws it away.** This landmark
(and Space Displacer's) briefly plotted at 10× too small a radius even
after the value above was correct - not a new derivation error, a
leftover `/C.DISPLAY_SCALE` division applied to `rInternal`, which isn't
label-only math, it's also the literal SVG radius input
(`r: rInternal*scale`, the same `scale` Attack Range's own circle uses via
`ar.capped`). Realized both Mine Radius and Space Displacer actually need
the *same* conversion Wall uses (`trueWorldSizeToPlotted`, i.e. express the
true world size as a fraction of the cosmetic Attack Range ring's own true
size, then land that fraction on `ar.capped`'s scale) - not plotted raw
against `ar.capped` (a first attempt at fixing this) and not divided by
`C.DISPLAY_SCALE` (the original bug) either. All three of Wall/Mine
Radius/Space Displacer are real, uncompressed Unity-world objects, so they
all go through the identical `trueWorldSizeToPlotted()` helper now.

**Space Displacer's mine orbit is drawn as actual mines, not just a line.**
`LandMineController.FixedUpdate` is gated behind
`ModuleManager.TryGetUniqueBenefit(instance, 19, ...)` (19 = Space
Displacer): when it passes, Ultimate-type Inner Land Mines orbit the tower,
each one LERPing smoothly toward an ideal target position = `rotatorPosition
+ direction × moduleTargetRadius`, direction based on the rotator's own live
rotation angle, evenly spaced by count (`angle_i = base + (360°/N)×i`) — a
plain circle, not an ellipse or offset shape, confirmed by reading the full
`FixedUpdate` body (the docking/spacing-speed lerp is just how mines
*approach* that position smoothly frame to frame, not a different final
shape). The rotator itself ("ModuleRotator", `level1`) sits at local
position `(0,0,0)`, parented under "Workshop Land Mine Controller" (also
`(0,0,0)`, root-level, scale 1.0) - centered on the tower with no hidden
offset.

**The radius itself was wrong for a session and a half - not a code-reading
error, a Unity per-instance override I hadn't checked.**
`LandMineController`'s COMPILED CLASS DEFAULT for `moduleTargetRadius` is
30.0 (its constructor batches four float field initializers into one NEON
store, raw bytes at that load address decode to exactly 30.0) - genuinely
correct as a *default*. But Unity lets a scene instance override any
field's default via the Inspector, and this field is overridden: reading
the real "Workshop Land Mine Controller" scene instance's own serialized
bytes directly (not the class default) gives **`moduleTargetRadius = 1.8`**.
(Confirmed this is the right instance: of the 4 `LandMineController`s in
`level1`, only this one has a non-null `moduleLandMineRotator` - the other
three, "Inner Land Mine Controller"/"...- Extra"/"Magnetic Hook
Controller", are for the separate Inner Land Mine Ultimate Weapon burst
mechanic, unrelated to this orbit.) `dockingSpeed`/`spacingSpeed` on the
same instance are correspondingly tiny (max step 0.002/frame) - consistent
with a small, slow orbit, not a wide sweeping one.

This resolves the camera/visibility tangent this same question led to
earlier (checking `Main Camera`'s dynamically-computed `orthographicSize`,
whether Chrono Field changes it, etc.) - all of that was chasing why a
30-unit orbit didn't seem to fit on screen, and the answer is simpler: it
isn't 30. At 1.8, Space Displacer sits comfortably in the same close-up
view as Wall/Attack-Range/Orbits, no camera-zoom reasoning required. It
also passes a sanity check the old 30 failed: Space Displacer's mines
should sit outside the Wall (confirmed by the user directly, early in this
investigation) - 1.8 > Wall's 0.78 (~2.3× ratio, a believable game-design
proportion), where 30 vs 0.78 was a 38× ratio that never made sense at this
scale.

**Unit convention, confirmed - and the plotting math corrected a second
time.** `Main.maxDistance` is raw (~20.3 for a 203m Attack Range) in real
Unity world-space terms - confirmed via both real writers
(`GetOutOfRoundMaxDistance`, `CalculateUpgradeBonuses`), with the ×10 shown
to the player existing only as a literal, one-off multiplication in the UI
text-building code, no spatial meaning. `moduleTargetRadius` (1.8, not the
compiled default of 30) shares that same raw, real Unity-world coordinate
space as Wall and Mine Radius - which means it needs the *same* conversion
those two use (`trueWorldSizeToPlotted`), not a flat `/C.DISPLAY_SCALE`.
That division was label-only math left over from this landmark's own
earlier code; since `rInternal` is also the literal SVG radius input, it
was quietly plotting Space Displacer 10× closer to the tower than its real
position relative to Attack Range - the reason it kept reading as "still
not in the right position" even after the 30→1.8 value fix landed. Fixed
now by routing it through the same helper as Wall/Mine Radius.

**The orbiting mine count is NOT `Main.GetInnerLandMineQuantity` — that was
wrong, and it's a completely different mechanic.** Re-decompiled this
function directly to confirm the formula rather than reuse the earlier
description: `iVar2 = 3; if (upgradeLevel >= 0) iVar2 = min(upgradeLevel,
plusUpgradeLevel) + 3;` then `+= ModuleManager.GetInnerLandMinesQuantity()`
(the equipped-module bonus) — i.e. base `3 + level` (clamped against a
"plus" cap array), plus module bonus, matching TheTowerSDK's community UW
chart ("x3" through "x6" at levels 0-3) as a secondary check, not the
source of the formula. This governs the Inner Land Mines *Ultimate
Weapon's own periodic burst* — how many mines `LandMineController.Play`'s
`iVar12==0` (type `Ultimate`) branch activates instantly in a circle when
the weapon's cooldown fires. That has nothing to do with what orbits under
Space Displacer.

The real mechanic lives in a *different* branch of that same `Play`
function — the one handling an ordinary Land Mine drop (from the Land Mine
Chance defense stat, unrelated to the Ultimate Weapon). With Space
Displacer equipped, each such drop rolls a rarity-scaled chance
(`ModuleManager.TryGetUniqueBenefit(vault, 0x13/*Space Displacer=19*/, &chance)`,
then `Random.value < chance`) to convert into an orbiting Inner Land Mine —
via a distinct `LandMine.ActivateModuleLandmine` call, parented to the same
orbit-pivot transform `FixedUpdate` rotates — instead of dropping normally.
That conversion is gated by a hard cap: it only fires while `iVar12 > 0x13`
(count > 19) is false, i.e. while 19 or fewer mines from this controller
are currently active — a "greater than 19" guard that lets counts 0
through 19 through, so **20** can be simultaneously active, not 19 (see
"`SPACE_DISPLACER_MINE_CAP` corrected from 19 to 20" further down in this
same section — that correction, cross-checked against the user's own
direct in-game count, applies here too; this paragraph originally
misread its own comparison direction before that correction landed). So
the real count is a live, probabilistic outcome of battle events — how
often mines drop, how many conversion rolls succeed — capped at 20, not
a fixed per-level formula, and not derivable from a save at all. It's a
manual field now (default 20, the confirmed cap), separate from the Inner
Land Mines Ultimate Weapon quantity above (which is real, but describes a
different pool of mines entirely and isn't shown anywhere on this plot).

Mine *size* isn't drawn as a blast radius: the Inner Land Mines Ultimate
Weapon's only stats are Damage/Quantity/Cooldown, no radius field exists
anywhere in its code, so each dot is a plain position marker, matching the
orb dots' style rather than inventing a hitbox size that isn't in the data.
The dashed reference-line ring is no longer drawn for this landmark either
— it's rendered as the mines themselves, with nothing else there to draw a
ring around.

**Ranged enemy stand-off — found it, and re-verified against the full
decompiled function (not just a byte scan).** The game itself draws this as
a real, player-toggleable radius indicator
(`HitTextSettings.showRangeOfRangedEnemy`, persisted in the save too) — a
`rangedEnemyRadiusObject` GameObject on `Main` whose scale gets set in
`Main.MainCameraSizeCheck`. Read that function's decompile line by line:
`radius = ((Main.maxDistance − 3.0) / 4.5 + 3.0) × (1 − VaultManager.GetBenefit(vault, 0x1018)) × (Lab.researchBenefit[226] × DAT_00d33128 + 1.0)`.
`Main.maxDistance` is the identical field the Attack Range line reads
(offset 0x3E4, confirmed in dump.cs) — so this radius is a real function of
the player's own range, growing 1 unit for every 4.5 units range grows.
`Lab.researchBenefit[226]` is the "Ranged Enemy Range" lab's live value:
chased down via the exact pointer chain in the decompiled function -
`Main.lab` (offset 0x60, confirmed typed as `Lab`), `Lab.researchBenefit`
(offset 0x218, confirmed `float[]`), and byte offset 0x3A8 into that array
lands precisely on index 226 ((0x3A8−0x20)/4=226, IL2CPP arrays having a
0x20-byte header). **Correction:** `DAT_00d33128`, read directly out of the
binary, is `-0.01` (−1%/level), not TheTowerSDK's "−0.5%/level" the tool
used before — the field default is unaffected (level 0 either way) but any
non-zero level was being under-reduced by half. `0x1018` = 4120 =
`VaultID.RangedRangeDistance`, confirmed by the hex match. This tool
doesn't have that node's per-level benefit table yet, so it's a manual %
field, 0 by default. A second, smaller "near" radius exists in the same
code (identical formula with +2.0 instead of +3.0, driving a separate
`nearRangedEnemyRadiusObject`) gated behind a condition not fully traced,
so only the primary (far) radius is drawn. **No third (Perk) term appears
anywhere in this function** — only the Vault node and this one Lab feed the
radius; if a Perk affects "ranged enemy" distance in some other way, it
isn't part of this specific circle's code path.

**Resolved: the formula's output was correct, but the unit-space it was
plotted in wasn't - same root cause as the Wall bug below.** The
~68m-vs-~145m gap flagged above (this formula's un-reduced ceiling vs. a
real screenshot's pixel-implied position) turned out to be exactly the
same mistake found later while chasing the user's separate Wall complaint:
this formula's output isn't a raw world distance, it's the same kind of
*scale multiplier* the real game applies to `rangedEnemyRadiusObject`'s own
Transform - directly analogous to the multiplier `Main.MainCameraSizeCheck`
applies to the Attack Range ring object itself
(`(x-3)/(x×0.05+2)+3.3`, constants confirmed by reading `libil2cpp.so`'s
data section directly via Ghidra). Both ring objects share the identical
native collider/sprite radius (0.5, confirmed independently for each), so
converting between them is a straight ratio: `plotted = (thisFormula's
output / attackRingScaleMultiplier(x)) × x`. For a 203m Attack Range with
no Lab/Vault reduction (matching the scenario this section originally
compared against), that ratio predicts **≈154m** - within 6% of the
~145m this section already measured from a real screenshot, independently,
before this connection was ever made. That's real corroboration between
two different investigations, not the same assumption checked twice.
`computeRangedStandoffPlotted()` now implements this conversion; the bare
`computeRangedStandoff()` formula above is unchanged and still correct as
a transcription, it's just no longer used directly for plotting.

**Ranged Enemy Perk — resolved, and now confirmed directly from two
decompiled functions, not from a community source.** A user screenshot
showed a real in-round "Trade-Off" Perk choice: "Ranged enemies attack
distance reduced, but ranged enemies damage ×3." Perk index 44 for this
effect was originally identified from TheTowerSDK's own notes — that part
of the sourcing is still a community claim, not independently re-derived
here (perk *names* live in localization strings, not in `dump.cs`, and
weren't re-traced this pass). But the actual *mechanic* — is it a
percentage that scales with a lab, or a flag — was re-checked directly
against the real compiled functions, and confirms the flag reading:

- `Enemy.get_RangedInRange` (decompiled directly, RVA `0x0240a564`): reads
  `Main.perks.perkLevel[44]` (bounds-checked against array length `0x2c`
  before the read) and does nothing more than pick which of two Enemy
  fields to return — offset `0x138` if `perkLevel[44] <= 0`, offset `0x139`
  if `> 0`. No magnitude is read here at all, just "is this perk's level
  above zero" — confirming the "pure boolean flag" claim directly, from the
  actual consumer, not from an unread array value.
- `Perks.PerkBenefitUp` (also decompiled directly, RVA `0x021b5864`) — the
  function that WOULD compute a scaled magnitude for a perk index if one
  existed — was checked to see what it does for index 44 structurally.
  Perk indices 42/43/45 explicitly read `Lab.researchBenefit[88]`
  (byte offset `0x180`, `(0x180-0x20)/4=88`) and apply `raw × (1 +
  labBenefit)`; every other index ≥ 40 not equal to 48, including 44,
  falls through to a structurally identical branch that *also* reads
  `researchBenefit[88]`. So `PerkBenefitUp(44)` is not special-cased to
  return a bare, unscaled number — it would apply the same lab scaling as
  the other trade-offs if called. That's fine and doesn't contradict the
  claim above: `get_RangedInRange` never calls `PerkBenefitUp` at all, so
  whatever that function would compute for index 44 is simply never
  consulted by the mechanic that actually matters here. (Attempted to read
  `perkBenefitUpIncrease[44]` directly off the live scene's `Perks`
  MonoBehaviour instance too, `level1` pathID `109713` — every one of its
  50 `perkLevel`/`perkMaxLevel`/`perkBenefitUpBase`/`perkBenefitUpIncrease`
  entries serialized as `0`, meaning this data is populated by code at
  runtime, not Inspector-authored — so that specific approach came up
  empty, but the `get_RangedInRange` finding above makes it moot.)

Both radii already exist in this tool's own `Main.MainCameraSizeCheck`
formula (see above) — far uses a `+3.0` offset, near uses `+2.0`, everything
else identical (same Vault/Lab factors). So the checkbox doesn't take a
manual percentage; it just swaps which offset `computeRangedStandoff` uses.
Research index 88 being the lab that scales *other* trade-off perks is now
independently confirmed by the offset arithmetic above, not just cited to
TheTowerSDK's `PERK_LAB_RESEARCH_INDEX.improveTradeOffPerks` — the specific
*name* "Improve Trade-off Perks" for that index is still the community
label, not re-derived here. Perk choices themselves are still never written
to `playerInfo.dat` (live combat state, not persistent progression), so
whether it's currently active is still something the user has to know and
toggle manually — there's no save field for that part.

**Energy Net radius still isn't shown** — no named field backs it anywhere
in the decompiled code, and unlike the ranged-enemy case there's no
player-facing debug/visualization toggle to chase. Rather than invent a
position for it, it's left off.

## Still open

Genuinely-unresolved items only — anything fully settled now lives in its
own section above, not here. (Pruned several redundant resolved entries
this pass: Range card's per-level values, Space Displacer's orbit radius,
and Orbit floor/ceiling were all fully resolved with the substance already
documented above, so they no longer need a placeholder here too.)

- **Inner Land Mine vs. Space Displacer icon size — real, measured,
  progression-dependent difference (near-zero gap at low range, ~8%
  diameter/~36% area at high range), source unconfirmed.** See the run of
  entries starting at "Checked, no fix needed: whether Space Displacer's
  converted mines render smaller..." through "Current best (unconfirmed)
  hypothesis" in the Workshop Orbit section above for the full trail
  (identification → retraction → re-confirmation → range-dependence).
  Every *static* code/asset path checked (sprite, scale-
  setting code, `moduleTargetRadius` writes, parent chain, material/
  shader, camera zoom-with-progression) is identical/ruled out between
  the two mine types. Current best hypothesis: not a persistent size
  difference at all, but a sampling artifact of the real `DOPunchScale`
  tween (~0.5s) combined with high-range accounts' much faster mine
  churn rate (constant enemy kills → constant Land Mine drops/Space
  Displacer conversion rolls cycling through up to 20 slots) making a
  screenshot far more likely to catch a Space Displacer mine mid-tween
  than at low range, where turnover is rare. Not independently
  confirmed - would need same-account, same-moment-apart screenshots to
  check whether an individual mine's measured size actually fluctuates.
  `MINE_ICON_NATIVE_RADIUS` left unchanged either way.
- **Workshop Range's level-79 cap — source unknown.** The counting
  convention itself (0-79 inclusive, no offset from the UI's own number)
  is confirmed from the user's save (see "Tower data" above); *where the
  game gets "79" from* at runtime is not — not a compiled constant, not in
  the save, not in the one RemoteConfig snapshot available. A different
  player's save reaching past 79 someday can't be predicted from this repo
  alone.
- **Orb Perk's in-round application code path.** The magnitude is
  confirmed (perk index 7: up to 2 picks, +1 orb each — see "Workshop
  Orbs" above, and the tool's UI/math already reflects this), but which
  function actually adds `perkLevel[7]` to the live orb count during a
  round hasn't been traced — Perks are in-round-only, so it isn't in
  `Main.GetOutOfRoundOrbCount`.
- **Ranged Enemy Stand-off's remaining ~2x gap — one specific hypothesis now
  checked and ruled out, real gap still unexplained.** With Lab and Vault
  terms both confirmed (Lab 12; Vault 0% for the reference save — its
  `VaultManager` dictionary has 9 entries, none with key `4120`
  /`RangedRangeDistance`, found by tracing `VaultManager.LoadConfig`'s
  `Resources.Load<VaultConfig>` asset chain directly since it has no
  compiled type tree — see "Reference lines" above for the formula), the
  formula still predicts about double the Wall-anchored screenshot
  measurement (6.06m vs ≈3.47m for that save). An earlier ×0.5 fix was
  tried and reverted (`CircleCollider2D.radius=0.5` looked like the
  missing factor, but that collider is invisible and halving broke the
  orbit-vs-standoff ordering a real screenshot shows).
  **Revisited directly with UnityPy after the Sentry Protocol PULSE bug
  raised the same question here: is this ALSO a hidden true-world-size
  never getting converted?** Found what actually draws the ring this
  time (previously "never found") — a child GameObject named `DrawLine`,
  not on `RangedEnemyRadius`/`NearRangedEnemyRadius` themselves (which
  really do only have the invisible collider, confirmed - no parent-scale
  surprise either, both are genuinely root-level, an earlier read of this
  same data mis-attributed the object's own dynamically-set scale as a
  parent's). `DrawLine`'s sprite is `circle-dotted`, 512×512px @ 100 PPU
  (native radius 2.56), at the child's own `localScale=0.202` — net
  effective native radius ≈0.517, confirmed genuinely close to but not
  identical to the 0.5 previously assumed (re-verified independently too:
  `towerRadiusObject`'s own "Circle" sprite really is 4×4px @ 4 PPU = an
  exact 0.5). **This is a real, now-applied precision correction
  (`RANGED_ENEMY_NATIVE_RADIUS = 0.517`, replacing the old bare-ratio
  cancellation) — but at only ~3.4% off from 0.5, it is nowhere near
  large enough to explain a ~75% gap.** So this specific bug category is
  ruled out here, unlike for PULSE; the true source of the remaining gap
  is still unidentified. Moot for the current reference save either way,
  since its real orb-radius auto-detection isn't active
  (`WORKSHOP_ORB_ADJUSTER_VAULT_ID` unowned, `innerOrbDistance` below its
  own floor) — Workshop/Card orbits render at the placeholder 6.0 floor
  regardless of this formula.
- **Space Displacer's mine-conversion chance has no per-rarity table
  extracted.** The mechanic is confirmed (rarity-scaled,
  `ModuleManager.TryGetUniqueBenefit(vault, 0x13, ...)`), but the actual
  live orbiting count can't be predicted from a save even in principle —
  manual field, capped at the confirmed maximum of 20 (see "Follow-up,
  same investigation" above for the corrected cap and the docking/spacing
  system that positions them).
- **"Near" ranged-enemy radius** — formula known, activation condition not
  traced.
- **Energy Net radius** — no lead found at all.
- **Orbit radius hasn't been re-verified against a real screenshot the way
  Wall/Ranged Enemy have been.** It's derived from raw `ar.capped` via
  `ringBounds`, matching the real Workshop/Card orbit-distance UI text's
  own ×10 convention (a different, separately-confirmed convention from
  the Attack Range ring's compression curve) — plausibly already correct
  on those grounds, just not screenshot-checked yet.
- **Workshop Orb level's cap of 4 isn't APK-confirmed.** The tool clamps
  `wsOrbLevel` to 4 (`Math.min(4, defenseRow[WS_ORBS_IDX])` in
  `applyPresetIndex`), matching the community-known level range, but no
  compiled constant or save field for the actual max has been traced
  directly - same unconfirmed-cap category as Workshop Range's 79 and
  Range lab's 80 above, just not yet written up with the same rigor.

General note: this plot's "m" scale is anchored to the one number
independently confirmed against the real game - Attack Range's displayed
"203.16m," which is a ×10 inflation of the raw `Main.maxDistance` value
used for everything spatial (confirmed: the ×10 exists only in that one
stat's own UI text-building code, not in any positional/rendering code
anywhere checked). Every ring on this plot is scaled into that same
"displayed meters" convention for its actual plotted position, not left in
raw Unity units - which for a field confirmed to already be in real
"meters" with no such inflation (Space Displacer) means dividing by 10
before plotting, not just relabeling.
