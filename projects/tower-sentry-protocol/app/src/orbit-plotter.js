const { decodePlayerInfoSaveBytes } = require('./decode-save');

function initPlotter(){
  const C = {
    LAB_BASE: 1.0, LAB_INCREASE: 0.02,
    UPG_BASE: 3.0, UPG_STEP: 0.05,
    CAP_KNEE: 8, CAP_CEIL: 22, CAP_SLOPE: 0.16,
    FLOOR_CONST: 6.0, CEIL_MULT: 1.3,
    PULSE: 1.5, DISPLAY_SCALE: 10,
    MINE_BASE: 0.5, MINE_STEP: 0.02,
    ILM_COLOR: '#c1633f', RANGED_COLOR: '#7fae8a', WALL_COLOR: '#5cd3f0',
  };

  // Confirmed directly from the user's own save: `presetUpgradeWorkshopLevel`
  // for their active preset reads exactly 79 for Range, matching the in-game
  // UI's own "79" label 1:1 (0=base/unowned, 79=max, no offset) - not merely
  // inferred from a community table's missing level-80 row. The cap's
  // ultimate *source* (where the game gets "79" from at runtime) still isn't
  // in the static APK - see methodology.md - but the value itself is settled.
  const WS_RANGE_MAX_LEVEL = 79;
  // Range lab's real max level - reported directly by the user from their
  // own account, not independently APK-confirmed: `Lab.researchLevelMax`
  // (dump.cs-confirmed field) exists but, like the Workshop cap above,
  // isn't in the save either - populated server-side at runtime. Same
  // "confirmed value, unconfirmed source" status as WS_RANGE_MAX_LEVEL was
  // before the save cross-check, one level less verified since there's no
  // equivalent save field to check it against directly.
  const RANGE_LAB_MAX_LEVEL = 80;

  // The Wall's own physical radius - not in the IL2CPP code at all (it's a
  // scene-authored Unity value, not a compiled constant), so found by
  // loading the game's actual scene data (level1 reassembled from its
  // .split parts) with UnityPy and scanning every CircleCollider2D
  // component. One unambiguous match: GameObject "TheWall",
  // CircleCollider2D.radius = 1.3, Transform.localScale = (0.6, 0.6, 1.0),
  // no parent - true Unity world-space collider radius = 1.3 × 0.6 = 0.78.
  // Cross-checked independently against the SpriteRenderer's own sprite
  // ("wall", 512×512px @ 187 PPU, fills its full canvas edge-to-edge, no
  // padding) at the same 0.6 scale: ≈0.82. Both agree - 0.78 is the real,
  // fixed, static Unity world-space size of the wall object. Not in doubt.
  //
  // What WAS wrong: comparing that 0.78 directly against the "203.16m"
  // Attack Range figure, as if both lived on one shared ruler. They don't.
  // `Main.maxDistance`'s raw value (~20.3 for this save) IS a real Unity
  // world-space gameplay distance (confirmed: Space Displacer's mine
  // placement and the real attack/hit-test logic both use raw stat values
  // directly, no conversion) - but the VISIBLE on-screen ring the player
  // sees for Attack Range is a separate, purely cosmetic indicator object
  // (`Main.towerRadiusObject`, confirmed to be the GameObject named
  // "Radius" (pathid 918) by directly reading Main's own serialized
  // MonoBehaviour bytes in level1 and finding its PPtr sandwiched exactly
  // between `wallObject` and `towerRange` - matching dump.cs field order).
  // Its render scale is NOT raw maxDistance; `Main.MainCameraSizeCheck`
  // overwrites its Transform.localScale every frame via
  // `(x-3)/(x×0.05+2)+3.3` (x = raw maxDistance) - a saturating curve that
  // exists purely so the ring doesn't become absurdly large on screen as
  // maxDistance grows. The 0.05 and 3.3 are real compiled float constants
  // (Ghidra DAT_00d33420/DAT_00d33658), read directly out of libil2cpp.so's
  // data section via a headless script - not guessed. That object's own
  // sprite ("Circle", 4×4px @ 4 PPU -> native radius 0.5) times that curve
  // gives its TRUE on-screen Unity-world size, wildly different from raw
  // maxDistance itself.
  //
  // So Wall's real 0.78 world-space size needs to go through that SAME
  // "how big does this actually render" pipeline to land on the same ruler
  // as the Attack Range ring the player is comparing it against by eye -
  // not be compared to raw maxDistance directly. That's what
  // computeWallRadius() below does: express Wall's true size as a fraction
  // of the Attack Range ring's true rendered size, then scale that fraction
  // by the player's displayed Attack Range number.
  //
  // Mine Radius and Space Displacer's orbit turned out NOT to need this
  // same ring-relative conversion - both are confirmed true, uncompressed
  // world-space distances (no cosmetic ring-compression involved), just
  // like Wall. Mine Radius needed its own native-collider factor
  // (MINE_AOE_NATIVE_RADIUS) and Space Displacer needed its scene-instance
  // override found (SPACE_DISPLACER_RADIUS = 1.8, not the compiled default
  // of 30) - see each constant's own comment. Not re-asserting the old
  // "mines fit inside Wall" ordering here without checking it at this
  // save's actual Mine Radius level - at low levels the true mine radius
  // (0.9×(0.5+0.02×level)) stays under Wall's 0.78, but it crosses over
  // Wall somewhere around level ~15-16, so whether it holds depends on the
  // specific save, not a fixed fact about the game.
  const WALL_WORLD_RADIUS = 1.3 * 0.6;
  const ATTACK_RING_NATIVE_RADIUS = 0.5;
  const ATTACK_RING_SCALE_A = 0.05;
  const ATTACK_RING_SCALE_B = 3.3;

  function attackRingScaleMultiplier(rawMaxDistance){
    const mult = (rawMaxDistance - 3.0) / (rawMaxDistance * ATTACK_RING_SCALE_A + 2.0) + ATTACK_RING_SCALE_B;
    return Math.max(0, mult);
  }

  function attackRingWorldRadius(rawMaxDistance){
    return ATTACK_RING_NATIVE_RADIUS * attackRingScaleMultiplier(rawMaxDistance);
  }

  // Shared by every landmark that's a real, uncompressed Unity-world object
  // (Wall, Mine Radius, Space Displacer - confirmed true world-space
  // distances, no cosmetic ring-compression applied to any of them). This
  // plot's shared axis is anchored to `ar.capped` (raw maxDistance, ~20.3)
  // standing in for the cosmetic Attack Range ring's own true on-screen
  // size (attackRingWorldRadius, ~4.52) - NOT a literal claim that raw
  // maxDistance IS that ring's world size. A real object's on-screen size
  // is governed by ITS true world size times the same camera zoom the ring
  // is rendered with, so its correct position on this axis is its true
  // size re-expressed as the SAME fraction of the ring that it truly is,
  // landed on ar.capped's scale: `trueSize/ringWorld × rawMaxDistance`.
  // Skipping this (plotting a true world size directly against ar.capped,
  // or applying an unrelated divide) was the exact bug that had Space
  // Displacer "still not in the right position" even after its true value
  // was corrected - the true-world value and this plot's axis aren't the
  // same scale, and conflating them isn't just a label issue, it moves the
  // actual plotted circle.
  function trueWorldSizeToPlotted(trueWorldSize, rawMaxDistance){
    const ringWorld = attackRingWorldRadius(rawMaxDistance);
    if (ringWorld <= 0) return 0;
    return (trueWorldSize / ringWorld) * rawMaxDistance;
  }

  function computeWallRadius(rawMaxDistance){
    return trueWorldSizeToPlotted(WALL_WORLD_RADIUS, rawMaxDistance);
  }

  // A real screenshot's wall ring will still look somewhat bigger than
  // WALL_WORLD_RADIUS predicts - checked every code-level explanation for
  // that (collider math, sprite draw mode - confirmed Simple, not
  // Tiled/Sliced, so Transform.localScale does directly control render
  // size - parent chain, RebuildWallFunction's rescale-on-rebuild tween,
  // which settles back to the same steady-state scale) and none of them
  // close the gap. Measuring the reference screenshot precisely: Ranged
  // Enemy's ring (thin, dashed) measures ~18px bigger than its own formula
  // predicts, while Wall (thick, solid, the brightest element on screen)
  // measures ~35px bigger - roughly CONSTANT-WIDTH additive gaps in screen
  // pixels, not a shared percentage, and bigger for the brighter/thicker
  // source. That's the signature of real-time bloom, not a sizing bug:
  // bloom halos are roughly constant-width in screen space regardless of
  // the source shape, so they inflate a small, bright, solid ring (Wall)
  // proportionally far more than a thin dashed line (Ranged Enemy). It
  // depends on this screenshot's resolution and rendering, not on any save
  // data, so there's no save-independent formula for it worth plotting -
  // unlike WALL_WORLD_RADIUS, it wouldn't generalize to a different
  // player's stats or a different device. Left as this note rather than a
  // second landmark for that reason.

  // Ranged Enemy Stand-off has the exact same unit-space bug Wall had, for
  // the same underlying reason. computeRangedStandoff()'s formula shape is
  // not a guess - it's transcribed directly from the real decompiled
  // `Main.MainCameraSizeCheck` code that sets `rangedEnemyRadiusObject`'s
  // own Transform.localScale every frame: `((x-3)/4.5+offset) × labFactor
  // × vaultFactor` (x = raw maxDistance). That means its output is a SCALE
  // MULTIPLIER, the exact same kind of quantity as
  // `attackRingScaleMultiplier()` above, not a raw world distance.
  //
  // What it's a multiplier ON, precisely (checked directly via UnityPy
  // after the ~2x gap below prompted re-examining whether this was another
  // hidden-true-world-size bug, same category as Sentry Protocol's PULSE):
  // `RangedEnemyRadius`/`NearRangedEnemyRadius` have no SpriteRenderer of
  // their own - only a CircleCollider2D (radius 0.5, invisible) - the
  // dashed ring the player actually sees lives on a CHILD GameObject
  // literally named "DrawLine" (previously undiscovered - the doc's own
  // "what draws this was never found" note, now resolved), sprite
  // "circle-dotted" 512×512px @ 100 PPU (native radius 2.56) at the
  // child's own `localScale=0.202`. Net effective native radius =
  // 2.56×0.202 ≈ 0.517 - confirmed close to but NOT identical to the
  // 0.5 collider radius previously assumed (a real, small ~3.4%
  // difference, not the missing factor a bigger gap would need). Both
  // `RangedEnemyRadius` objects are root-level with no parent scale
  // either (checked and ruled out - an earlier read of this data
  // mis-attributed the object's own dynamically-set scale as a parent's).
  // `towerRadiusObject`'s own "Circle" sprite was re-verified the same
  // way: 4×4px @ 4 PPU = exactly 0.5, confirming that side of the ratio
  // was already right.
  //
  // So: RANGED_ENEMY_NATIVE_RADIUS (0.517) replaces the bare cancellation
  // this used to rely on (assuming both sides were the same 0.5) - a real
  // precision fix, confirmed from the actual rendering object instead of
  // the nearby-but-different invisible collider. It is NOT, however, the
  // explanation for the still-unresolved ~2x gap noted in methodology.md's
  // "Still open" section - 3.4% is far too small a correction for that;
  // that mystery is confirmed to be something else, not this category of
  // bug this time.
  const RANGED_ENEMY_NATIVE_RADIUS = (512 / 100 / 2) * 0.202; // sprite native radius × DrawLine's own child scale

  function computeRangedStandoffPlotted(rawMaxDistance){
    const ringWorld = attackRingWorldRadius(rawMaxDistance);
    if (ringWorld <= 0) return 0;
    const trueWorldRadius = computeRangedStandoff(rawMaxDistance) * RANGED_ENEMY_NATIVE_RADIUS;
    return (trueWorldRadius / ringWorld) * rawMaxDistance;
  }

  // Orbit radius had the exact same unit-space bug as Wall and Ranged Enemy
  // - fully traced this time, not left as an open question. Confirmed via
  // Ghidra disassembly (register-level, not just decompiled pseudo-C) that
  // `Main.OrbCheck` runs `Main.get_WorkshopOrbAppliedDistance()`'s output
  // through the same compression curve as the rings
  // (`(x-3)/(x×0.05+2)+3.3`), times a real compiled constant `DAT_00d33400`
  // = 1.166, then calls `Transform.set_localPosition(0, thatValue, 0, ...)`
  // on the orb sprite's own transform - directly, no further code touches
  // it afterward. The missing piece was WHICH transform: found the real
  // `Main.orbObjects[]`/`orbSprites[]` arrays (13 elements each) by reading
  // the exact byte offsets inside `Main`'s own serialized data (the same
  // technique that found Wall/Attack-Range-ring/TowerRange earlier - full
  // field-by-field walk this time, correctly accounting for the two float
  // fields and one Transform PPtr sitting between `towerRange` and this
  // array, confirmed en route by `radiusBeyondRange` resolving to the
  // already-known "BeyondRange" object). Every orb sprite is a child of a
  // "Container" pivot (rotates only, scale 1.0, matches
  // `set_localEulerAngles`), and EVERY Container is a child of one shared
  // GameObject literally named "Orb" - root-level, `localScale = 0.43`.
  // That 0.43 is the missing multiplier: predicted world radius at this
  // save's floor (6.0 applied distance) = 5.369×0.43 = 2.309, against a
  // careful 9-point pixel measurement of the real screenshot implying
  // 2.358 - under 2% apart, closing what had been a 2.3× unexplained gap.
  const ORB_COMPRESSION_EXTRA = 1.166; // DAT_00d33400, Ghidra-confirmed
  const ORB_PIVOT_PARENT_SCALE = 0.43; // "Orb" GameObject's own scene scale

  // The orb's own visual SIZE (not its orbit distance, which the two
  // constants above govern) - for drawing the plotted dots to scale.
  // Read directly off the real "Orb" scene hierarchy (same `level1`
  // instance, pathid 6629, as ORB_PIVOT_PARENT_SCALE above): each
  // Container's child "OrbObject" has a `CircleCollider2D` with
  // `radius=0.27` in its own local space, `localScale=0.88` on OrbObject
  // itself, `Container` at scale 1.0, and the shared parent "Orb" at
  // 0.43 (same chain ORB_PIVOT_PARENT_SCALE already uses for distance).
  // Cross-checked against the equipped ball skin's own sprite
  // ("ball_assassin", 60×60px @ 100 PPU → native radius 0.3) - close to
  // the collider's 0.27, the small gap being normal (hit-collider
  // slightly smaller than its visual sprite, common for gameplay
  // fairness) - using the collider since it's skin-independent, unlike
  // the sprite which changes with equipped cosmetics.
  const ORB_NATIVE_RADIUS = 0.27 * 0.88 * ORB_PIVOT_PARENT_SCALE; // ≈0.1022, true world units

  function computeOrbPlottedRadius(appliedDistance, rawMaxDistance){
    // Unlike Ranged Enemy Stand-off (a bare scale multiplier on a shared
    // native-radius sprite, so the native radius cancels against the
    // Attack Range ring's own multiplier), fVar27 here is a literal
    // Transform.localPosition distance, already a complete world-space
    // radius once its parent chain's scale is applied - so it compares
    // against the ring's FULL true world size (native radius included,
    // attackRingWorldRadius), not the bare multiplier.
    const ringWorld = attackRingWorldRadius(rawMaxDistance);
    if (ringWorld <= 0) return 0;
    const trueWorldRadius = attackRingScaleMultiplier(appliedDistance) * ORB_COMPRESSION_EXTRA * ORB_PIVOT_PARENT_SCALE;
    return (trueWorldRadius / ringWorld) * rawMaxDistance;
  }

  // Space Displacer's mine-orbit radius - corrected. `LandMineController`'s
  // COMPILED CLASS DEFAULT for `moduleTargetRadius` is 30.0 (its .ctor's
  // NEON store decodes to exactly that) - but that's only the constructor
  // default, and Unity's per-instance scene serialization can override any
  // field's default value, which is exactly what happens here. Read the
  // REAL scene instance directly (`level1`, the actual "Workshop Land Mine
  // Controller" GameObject - confirmed as the right one because it's the
  // only one of 4 LandMineController instances with a non-null
  // `moduleLandMineRotator`; the other three ["Inner Land Mine Controller",
  // "...- Extra", "Magnetic Hook Controller"] are for the separate Inner
  // Land Mine Ultimate Weapon burst mechanic, not this orbit) - and its
  // serialized `moduleTargetRadius` is **1.8**, not 30. `dockingSpeed`/
  // `spacingSpeed` on the same instance are correspondingly tiny (max step
  // 0.002/frame), consistent with a small, slow orbit rather than a wide
  // sweeping one. This also passes a sanity check the old 30 failed:
  // Space Displacer's mines should sit outside the Wall (confirmed by the
  // user directly) - 1.8 > Wall's 0.78 (ratio ~2.3×, a believable game-
  // design ratio), where 30 > 0.78 was a 38× ratio that never made sense
  // at this scale.
  //
  // Position and orbit shape confirmed directly from
  // `LandMineController.FixedUpdate`: mines LERP smoothly toward an ideal
  // target = rotatorPosition + direction(evenly spaced, based on the
  // rotator's own live rotation angle) × moduleTargetRadius - a plain
  // circle, not an ellipse or offset shape. The rotator itself
  // ("ModuleRotator") sits at local position (0,0,0), parented under
  // "Workshop Land Mine Controller" (also (0,0,0), root-level, scale 1.0)
  // - so it's centered on the tower with no hidden offset, matching this
  // tool's existing "towerCenter + direction × radius" placement.
  //
  // Confirmed via both of Main's real maxDistance writers
  // (`GetOutOfRoundMaxDistance`/`CalculateUpgradeBonuses`) that
  // `Main.maxDistance` is raw (~20 for a "203m" Attack Range), with the
  // ×10 shown to the player existing only as a literal UI-text
  // multiplication - not a real spatial scaling factor. Space Displacer's
  // real spatial position and Attack Range's real spatial position share
  // that same raw-unit convention, so this is plotted the same way: raw
  // value divided by `C.DISPLAY_SCALE` so the standard ×10 label math
  // re-multiplies it back to the correct 18m.
  const SPACE_DISPLACER_RADIUS = 1.8;

  // "Inner land mine" was plotted as a blast-radius boundary line (a dashed
  // reference circle) - the user pointed out that's not what's actually
  // visible in-game: real screenshots show it as an actual RING OF MINE
  // ICONS, same rendering style as Space Displacer, just closer to center -
  // not a stat boundary at all. Traced where that ring's radius actually
  // comes from: `LandMineController.Play`'s Ultimate-type branch (type=0,
  // the real Inner Land Mine Ultimate Weapon's periodic burst - confirmed
  // by MineType enum in dump.cs: Ultimate=0, EnemyDrop=1, ExtraSet=2,
  // MagneticMine=3) only sets each mine's `localEulerAngles.z = i×360/count`
  // and its explosion-radius *scale* - no position call at all. Reading the
  // real "Inner Land Mine Controller" scene instance directly (level1,
  // 12-slot Ultimate-type controller) explains why: each `LandMine`'s own
  // pivot sits at its parent's origin (0,0,0, matching what gets rotated),
  // but its actual visible content (`Container`, holding the Sprite and the
  // "Area of Effect" collider) sits at a fixed local offset of
  // `(0, 0.65, 0)` from that pivot - checked on two different mine slots,
  // identical both times (a shared prefab value, not per-slot). Rotating
  // the pivot sweeps that fixed 0.65 offset around in a circle, same
  // mechanism as the Orb system's Container pivot. A true, fixed
  // Unity-world radius, same category as Wall/Space Displacer/PULSE - goes
  // through the same `trueWorldSizeToPlotted` conversion, not plotted raw.
  // (Also found: `Inner Land Mine Controller - Extra` (MineType.ExtraSet)
  // uses a genuinely different, farther-out radius - see
  // EXTRA_SET_MINE_ORBIT_RADIUS below for the full story, including a
  // same-session correction after an initial screenshot misread.)
  const INNER_LAND_MINE_ORBIT_RADIUS = 0.65;

  // "Extra Set of Inner Mines" Perk - picked at most once per run per the
  // user (matches every other Perk in this tool: in-round-only, no save
  // field, manual toggle). Re-decompiled `LandMineController.Play()`
  // (RVA 0x020b8024) in full this session: its `type==2` (ExtraSet) branch
  // is structurally the same rotate-into-place loop as the primary
  // (`type==0`) branch - `localEulerAngles.z = i×360/count` per mine, same
  // `LandMine.SetExplosionRadius`/`Activate` calls - just with `count` read
  // directly as this controller's own `landMines[]` array length instead of
  // a `Main.GetInnerLandMineQuantity()`-style formula call, i.e. it always
  // activates all of its own slots at once when the Perk fires.
  //
  // Correction, same session: an earlier pass here concluded (from two real
  // screenshots) that the extra mines render on the *same* ring as the
  // primary set, superseding the scene data's own 1.2 Container offset. The
  // user pointed out that was wrong. Re-checked the actual scene data (not
  // just a screenshot pixel-measurement) directly: the "Inner Land Mine
  // Controller - Extra" instance (pathid 106768, `level1`) has only 6
  // `LandMine` slots, and unlike the primary controller - where every
  // `LandMine`'s own transform sits at local (0,0,0) and only its *child*
  // `Container` carries the 0.65 offset - here each `LandMine`'s own
  // transform already carries a distinct, non-zero local position: (-1.028,
  // 0.602), (1.012, 0.602), (0, -1.198), (1.021, -0.598), (-1.013, -0.587),
  // (0, 1.22) - each ≈1.17-1.22 from the controller's origin (its `Container`
  // child then adds the *same* 1.2 offset again on top, on this instance -
  // apparently redundant/vestigial, since `Play()` only ever rotates the
  // `LandMine`'s own transform, not the `Container`'s). Rotating each
  // `LandMine` around the controller's origin - exactly what `Play()`'s
  // `type==2` branch does - sweeps that ≈1.2 baked-in radius around in a
  // circle, same mechanism as the primary ring but at roughly double its
  // distance. This is a real, separate, farther-out ring - the original
  // scene-data reading was right; the screenshot re-read that overturned it
  // was the mistake (most likely: two ordinary primary-ring dots misread as
  // a visually distinct pair, not evidence of a shared radius - a rigorous
  // color-blob re-measurement of both screenshots afterward found every
  // pink/magenta dot clustering on one single ~190-205px-radius ring, no
  // second population at any radius).
  const EXTRA_SET_MINE_ORBIT_RADIUS = 1.2;
  const EXTRA_SET_MINE_COUNT = 6;

  // Space Displacer's orbiting mine COUNT is not `Main.GetInnerLandMineQuantity`
  // (that formula - base 3 + Quantity upgrade level + Core bonus - governs the
  // Inner Land Mines Ultimate Weapon's own periodic burst, a completely
  // different mechanic). Traced Space Displacer's real effect into
  // `LandMineController.Play` (the function that handles an ordinary Land
  // Mine drop, not the Ultimate Weapon firing): when Space Displacer is
  // equipped, each standard mine drop gets a rarity-scaled chance
  // (`ModuleManager.TryGetUniqueBenefit(vault, 0x13/*Space Displacer*/, &chance)`,
  // then `Random.value < chance`) to convert into an orbiting Inner Land Mine
  // via a distinct `LandMine.ActivateModuleLandmine` call, instead of dropping
  // normally - gated by a cap check `iVar12 > 0x13` (count > 19) that blocks
  // further conversions once tripped - allowing counts 0-19 through, i.e. 20
  // simultaneously active, matching the user's own direct in-game count of
  // 20 (reconciles the "0x13" cap value with a 20-mine real maximum: it's a
  // "greater than 19" guard, not a "19 max" one). So the real count is a
  // live, probabilistic outcome of battle events (how often mines drop and
  // how many conversion rolls succeed), not something derivable from a save
  // at all - left as a manual field, capped at the confirmed real maximum.
  const SPACE_DISPLACER_MINE_CAP = 20; // confirmed max converted count (0x13 cap check + user's own in-game count)

  // Ranged enemy stand-off radius: Main.MainCameraSizeCheck's real write to
  // rangedEnemyRadiusObject's Transform.localScale (the game's own player-
  // toggleable "show ranged enemy range" debug circle - HitTextSettings.
  // showRangeOfRangedEnemy). radius = ((maxDistance-3)/4.5+3) × vaultFactor ×
  // labFactor. maxDistance is the same field (Main, offset 0x3E4, confirmed
  // in dump.cs) the Attack Range line already reads. The lab term traces
  // Main.lab (0x60, typed Lab) -> Lab.researchBenefit (0x218, float[]) ->
  // byte offset 0x3A8 into that array, which is index 226 given IL2CPP's
  // 0x20-byte array header ((0x3A8-0x20)/4=226) - the "Ranged Enemy Range"
  // research. Read the full Main.MainCameraSizeCheck decompile directly
  // (not just a byte scan) to confirm the exact formula:
  // farRadius = ((maxDistance-3)/4.5+3) × (1-vaultBenefit) × (researchBenefit[226]×DAT_00d33128+1),
  // nearRadius = ((maxDistance-3)/4.5+2) × the same two factors. No third
  // (Perk) term appears anywhere in this function - only the Vault node
  // (0x1018 = 4120 = VaultID.RangedRangeDistance, confirmed) and this Lab.
  // DAT_00d33128, read directly from the binary, is -0.01 - i.e. -1%/level,
  // not TheTowerSDK's "-0.5%/level" - so this step was corrected to match
  // the confirmed constant.
  //
  // The "Ranged Enemy Perk" (Trade-Off perk #44, "Ranged Enemies Attack
  // Distance Reduced, but Tower Ranged Enemies Damage x3") isn't a percentage
  // at all - TheTowerSDK's decompiled notes on this exact perk found its own
  // benefit-increase table entry is 0 and unused; taking it is read as a pure
  // flag that switches the game from the FAR radius formula (+3.0 offset) to
  // the NEAR one (+2.0 offset, already known from MainCameraSizeCheck above)
  // for `Enemy.get_RangedInRange`. So the checkbox just swaps which offset
  // this tool uses - no manual percentage to guess at, and none applied.
  const RANGED_STANDOFF_REF_UNITS = 3.0;
  const RANGED_STANDOFF_DIVISOR = 4.5;
  const RANGED_STANDOFF_FAR_OFFSET = 3.0;
  const RANGED_STANDOFF_NEAR_OFFSET = 2.0;
  const RANGED_LAB_STEP = 0.01;
  const RANGED_LAB_MAX_LEVEL = 30;
  const RANGED_ENEMY_RANGE_LAB_IDX = 226;

  // Fixed catalog order for the two workshop stat categories we need — copied
  // from TheTowerSDK's workshop-tracker-definitions.js CATEGORY_STATS, not
  // reconstructed. Only the order matters here.
  const WS_ATTACK_ORDER = ['Damage','Attack Speed','Critical Chance','Critical Factor','Range','Damage / Meter','Multishot Chance','Multishot Targets','Rapid Fire Chance','Rapid Fire Duration','Bounce Shot Chance','Bounce Shot Targets','Bounce Shot Range','Super Crit Chance','Super Crit Mult','Rend Armor Chance','Rend Armor Mult'];
  const WS_DEFENSE_ORDER = ['Health','Health Regen','Defense Percent','Defense Absolute','Thorns','Lifesteal','Knockback Chance','Knockback Force','Orb Speed','Orbs','Shockwave Size','Shockwave Frequency','Land Mine Chance','Land Mine Damage','Land Mine Radius','Wall Health','Wall Rebuild'];
  const WS_RANGE_IDX = WS_ATTACK_ORDER.indexOf('Range');   // 4
  const WS_ORBS_IDX = WS_DEFENSE_ORDER.indexOf('Orbs');    // 9
  const WS_MINE_RADIUS_IDX = WS_DEFENSE_ORDER.indexOf('Land Mine Radius'); // 14
  const CARD_RANGE_ID = 4;    // Cards.CardID.Range, confirmed via save read
  const CARD_EXTRAORB_ID = 16; // Cards.CardID.InnerOrb ("Extra Orb"), confirmed via dump.cs
  // Was read from the old TechTreeManager flat array (powerNodesLevel/Unlocked[41])
  // - wrong system. The real out-of-round formula (Main.GetOutOfRoundOrbCount,
  // decompiled directly) reads VaultManager.GetBenefit(vault, VaultID.OrbsCount)
  // - VaultID.OrbsCount=280, confirmed by name in dump.cs's VaultID enum - the
  // same current VaultManager Dictionary<VaultID,int> system used below for the
  // Workshop Orb Adjuster and (separately) Ranged Enemy Stand-off's Vault term,
  // not the positional powerNodesLevel[] array. Confirmed 0 on the reference
  // save either way, so this fix doesn't change today's plotted number, but it
  // was reading the wrong field.
  const VAULT_ORBS_COUNT_VAULT_ID = 280;

  // Real orb-orbit radius fields, confirmed by reverse-engineering: `Main`
  // has `workshopOrbDistance`/`innerOrbDistance` float fields (0x2C4/0x2C0),
  // mirrored 1:1 in the save at the same names. `Main.get_WorkshopOrbAppliedDistance`
  // only uses `workshopOrbDistance` if VaultID 2020 (0x7e4, "Workshop Orb
  // Adjuster") has been bought - otherwise it's `min(maxDistance, 6.0)`
  // regardless of whatever's stored there. This is a DIFFERENT save system
  // than the Vault Power grid above (`powerNodesLevel[]`, positionally
  // indexed) - this one is `VaultManager`'s own system, a real
  // `Dictionary<VaultID, int>` at `vault['<UpgradesLevel>k__BackingField'].KeyValuePairs`,
  // looked up by VaultID directly, not by array position. No equivalent gate
  // was found for Card's `innerOrbDistance` (`get_InnerOrbMinDistance`/
  // `get_InnerOrbMaxDistance` exist and share the same 6.0/×1.3 bounds as
  // Workshop, but no "InnerOrbAppliedDistance"-style gated getter exists) -
  // still open whether it's ungated or gated by something not yet found.
  const WORKSHOP_ORB_ADJUSTER_VAULT_ID = 2020;

  function vaultUpgradeLevel(vaultId){
    const dict = saveRoot && saveRoot.vault && saveRoot.vault['<UpgradesLevel>k__BackingField'];
    const pairs = dict && Array.isArray(dict.KeyValuePairs) ? dict.KeyValuePairs : [];
    const hit = pairs.find(p => p && p.key && coerceNum(p.key.value__) === vaultId);
    return hit ? (coerceNum(hit.value) || 0) : 0;
  }

  let mineWorkshopLevel = 0;

  const $ = id => document.getElementById(id);

  // ============== save file loading ==============
  let saveRoot = null;

  function coerceNum(v){
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'object' && 'value__' in v) return coerceNum(v.value__);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function toNumArr(raw){ return Array.isArray(raw) ? raw.map(v => coerceNum(v) ?? 0) : []; }
  function toBoolArr(raw){ return Array.isArray(raw) ? raw.map(v => typeof v==='boolean' ? v : coerceNum(v)===1) : []; }
  function toStrArr(raw){ return Array.isArray(raw) ? raw.map(v => String(v ?? '').trim()).filter(Boolean) : []; }

  // .NET List<T> fields decode via the NRBF reader as {typeName, _items, _size,
  // _version} objects, not plain JS arrays (unlike C# T[] fields, which do
  // decode as plain arrays). This unwraps either shape to a plain array.
  function unwrapList(raw){
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw._items)) {
      const size = coerceNum(raw._size);
      return size != null ? raw._items.slice(0, size) : raw._items;
    }
    return [];
  }

  // A save's preset-level matrix (e.g. presetUpgradeWorkshopLevel) can arrive
  // already nested (array of per-preset arrays) or, for a save with only one
  // populated preset, as one flat array — handle both.
  function asMatrix(raw, columns){
    if (!Array.isArray(raw) || raw.length === 0) return [];
    if (Array.isArray(raw[0])) return raw.map(row => toNumArr(row));
    return [toNumArr(raw)];
  }

  async function handleFileLoad(file){
    const statusEl = $('loadStatus');
    statusEl.className = 'load-status';
    statusEl.textContent = 'Reading ' + file.name + '…';
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { parsedRoot } = decodePlayerInfoSaveBytes(buf);
      saveRoot = parsedRoot;
      if (!saveRoot || typeof saveRoot !== 'object') throw new Error('Decoded root was empty');
      statusEl.className = 'load-status ok';
      statusEl.textContent = 'Loaded ' + file.name + '.';
      populatePresetsFromSave();
    } catch (err) {
      statusEl.className = 'load-status err';
      statusEl.textContent = 'Could not read save: ' + err.message;
    }
  }

  $('fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) handleFileLoad(f);
  });

  function populatePresetsFromSave(){
    const wsNames = toStrArr(saveRoot.workshopPresetName);
    const cardNames = toStrArr(saveRoot.presetName);
    const names = wsNames.length ? wsNames : cardNames;
    const sel = $('presetSelect');
    sel.innerHTML = '';
    if (names.length === 0){
      sel.innerHTML = '<option>No presets found in save</option>';
      sel.disabled = true;
      return;
    }
    names.forEach((n, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = n || ('Preset ' + i);
      sel.appendChild(opt);
    });
    sel.disabled = false;
    const current = coerceNum(saveRoot.currentWorkshopPreset) ?? 0;
    sel.value = Math.min(names.length - 1, Math.max(0, current));
    applyPresetIndex(parseInt(sel.value, 10));
  }

  $('presetSelect').addEventListener('change', () => {
    if (saveRoot) applyPresetIndex(parseInt($('presetSelect').value, 10));
  });

  function applyPresetIndex(i){
    if (!saveRoot) return;

    // Lab level is global (not per-preset).
    const researchLevel = toNumArr(saveRoot.researchLevel);
    if (researchLevel.length > 3) $('labLevel').value = researchLevel[3];
    if (researchLevel.length > RANGED_ENEMY_RANGE_LAB_IDX) $('rangedRangeLabLevel').value = researchLevel[RANGED_ENEMY_RANGE_LAB_IDX];

    // Ultimate Weapon levels are global (not per-preset). ultimateWeaponLevel[]
    // is a flat save array, 3 base-stat levels per weapon slot (confirmed via
    // TheTowerSDK's readUltimateWeaponsFromSaveRoot chunking, UW_SAVE_BASE_STAT_LEVELS_PER_SLOT=3),
    // slot order Chain Lightning/Smart Missiles/Death Wave/Chrono Field/Inner
    // Land Mines/Golden Tower/Poison Swamp/Black Hole/Spotlight (Inner Land
    // Mines = slot 4), each slot's 3 stats in Damage/Quantity/Cooldown order
    // (dump.cs Main.GetInnerLandMineDamage/Quantity/Cooldown declaration
    // order). So Quantity = flat index 4*3+1 = 13 - independently confirmed by
    // disassembling Main.GetInnerLandMineQuantity itself, which hardcodes
    // array byte-offset 0x54 (= 0x20 array-data-start + 13*4) when reading
    // ultimateWeaponLevel. Formula from that same disassembly: count = 3 +
    // max(0, level) [+ ModuleManager module bonus, not modeled here like other
    // module contributions this tool doesn't track].
    const uwLevel = toNumArr(saveRoot.ultimateWeaponLevel);
    const ILM_QUANTITY_STAT_INDEX = 13;
    if (uwLevel.length > ILM_QUANTITY_STAT_INDEX) {
      $('innerLandMineCount').value = 3 + Math.max(0, uwLevel[ILM_QUANTITY_STAT_INDEX]);
    }

    // Workshop levels are per-preset matrices, one row per preset.
    const attackMatrix = asMatrix(saveRoot.presetUpgradeWorkshopLevel, WS_ATTACK_ORDER.length);
    const defenseMatrix = asMatrix(saveRoot.presetUpgradeWorkshopDefenseLevel, WS_DEFENSE_ORDER.length);
    const attackRow = attackMatrix[i] || attackMatrix[0] || [];
    const defenseRow = defenseMatrix[i] || defenseMatrix[0] || [];
    if (attackRow[WS_RANGE_IDX] != null) $('wsLevel').value = attackRow[WS_RANGE_IDX];
    if (defenseRow[WS_ORBS_IDX] != null) $('wsOrbLevel').value = Math.min(4, defenseRow[WS_ORBS_IDX]);
    if (defenseRow[WS_MINE_RADIUS_IDX] != null) mineWorkshopLevel = defenseRow[WS_MINE_RADIUS_IDX];

    // Card level is global; "active in this preset" is per-preset slot assignment.
    const cardLevel = toNumArr(saveRoot.cardLevel);
    if (cardLevel[CARD_RANGE_ID] != null) $('cardLevel').value = cardLevel[CARD_RANGE_ID];

    const slotCard = saveRoot.slotPresetCardInt;
    const slotAssigned = saveRoot.slotPresetCardAssignedBool;
    let rangeActive = false;
    if (Array.isArray(slotCard) && Array.isArray(slotCard[i])) {
      const row = slotCard[i];
      const assignedRow = Array.isArray(slotAssigned) && Array.isArray(slotAssigned[i]) ? slotAssigned[i] : null;
      row.forEach((cardIdx, slot) => {
        if (coerceNum(cardIdx) === CARD_RANGE_ID && (!assignedRow || assignedRow[slot])) rangeActive = true;
      });
    }
    $('cardActive').checked = rangeActive;

    // Real orb-orbit distances, confirmed save fields (see
    // WORKSHOP_ORB_ADJUSTER_VAULT_ID above) - global, not per-preset. Workshop
    // only actually gets applied if the Vault node is bought; Card's gate (if
    // any) isn't confirmed, so it's applied unconditionally here as the best
    // current guess, flagged in methodology.md.
    const wsAdjusterOwned = vaultUpgradeLevel(WORKSHOP_ORB_ADJUSTER_VAULT_ID) > 0;
    $('wsAdjuster').checked = wsAdjusterOwned;
    if (wsAdjusterOwned || saveRoot.innerOrbDistance != null) {
      const arNow = computeAttackRange();
      const boundsNow = ringBounds(arNow.capped);
      if (wsAdjusterOwned && saveRoot.workshopOrbDistance != null) {
        $('wsStep').value = radiusToStep(coerceNum(saveRoot.workshopOrbDistance) || 0, boundsNow);
      }
      if (saveRoot.innerOrbDistance != null) {
        $('cardStep').value = radiusToStep(coerceNum(saveRoot.innerOrbDistance) || 0, boundsNow);
      }
    }

    refreshArmorModules(i);
    applyVaultAndArmorDetection(); // also calls render()
  }

  // ============== modules ==============
  const CATEGORY_ORDER = ['Cannon','Armor','Generator','Core'];
  const ASSIST_TYPE_TO_CATEGORY = { 0: 'Cannon', 1: 'Armor', 2: 'Generator', 3: 'Core' };

  // infoIndex -> {name, category}. 1-48 pulled from TheTowerSDK's module-info
  // catalog. 49-52 (the newest wave, v29.0.2) were unresolved by that catalog
  // and are added here after direct verification: ModuleManager$$GetModuleName's
  // decompiled switch (decompiled-all.txt) maps case 0x31..0x34 to localization
  // term constants 0xe65..0xe68 (3685-3688 decimal); those exact term numbers,
  // in that exact order, were found as consecutive raw strings "Acceleration
  // Augment"/"Sentry Protocol"/"Gilded Sniper"/"Tactical Barrage" inside the
  // game's own asset bundle (sharedassets1.assets.split... /
  // 6f04703ffb986d94a9ec742d74a9e0ad). Category follows the same
  // Cannon/Armor/Generator/Core wave pattern as the two prior 4-module waves
  // (41-44, 45-48), and is cross-checked against each module's unique-effect
  // description text (a second decompiled switch, GetModuleUniqueDescription):
  // 49's is a Rapid Fire/Rend Armor buff (Cannon), 50's is "orb speed reduced
  // to zero" (Armor - this is Sentry Protocol itself), 51's is an on-kill coin
  // bonus (Generator), 52's doubles a lab bonus and fires homing missiles
  // (Core). No case above 0x34 exists in that switch, so 52 is the current max.
  const MODULE_NAMES = {1:{name:'Energy Cannon',category:'Cannon'},2:{name:'Matter Cannon',category:'Cannon'},3:{name:'Bounce Blitzer',category:'Cannon'},4:{name:'Swiftstrike Blitzer',category:'Cannon'},5:{name:'Rapidreach Blitzer',category:'Cannon'},6:{name:'Omniboost Blitzer',category:'Cannon'},7:{name:'Havoc Bringer',category:'Cannon'},8:{name:'Death Penalty',category:'Cannon'},9:{name:'Being Annihilator',category:'Cannon'},10:{name:'Astral Deliverance',category:'Cannon'},11:{name:'Energy Barrier',category:'Armor'},12:{name:'Matter Barrier',category:'Armor'},13:{name:'Nano Intercept',category:'Armor'},14:{name:'Photon Counter',category:'Armor'},15:{name:'Solar Reflector',category:'Armor'},16:{name:'Diamond Nanowall',category:'Armor'},17:{name:'Wormhole Redirector',category:'Armor'},18:{name:'Negative Mass Projector',category:'Armor'},19:{name:'Space Displacer',category:'Armor'},20:{name:'Anti-Cube Portal',category:'Armor'},21:{name:'Matter Converter',category:'Generator'},22:{name:'Energy Converter',category:'Generator'},23:{name:'Stellar Lift',category:'Generator'},24:{name:'Orbital Sail',category:'Generator'},25:{name:'Solar Dyson Sphere',category:'Generator'},26:{name:'Antimatter Reactor',category:'Generator'},27:{name:'Black Hole Digestor',category:'Generator'},28:{name:'Pulsar Harvester',category:'Generator'},29:{name:'Galaxy Compressor',category:'Generator'},30:{name:'Singularity Harness',category:'Generator'},31:{name:'Energy Chip',category:'Core'},32:{name:'Matter Chip',category:'Core'},33:{name:'Chronosync',category:'Core'},34:{name:'Eon Mind',category:'Core'},35:{name:'Galactic Librarian',category:'Core'},36:{name:'Matrix Sim',category:'Core'},37:{name:'Multiverse Nexus',category:'Core'},38:{name:'Dimension Core',category:'Core'},39:{name:'Harmony Conductor',category:'Core'},40:{name:'Om Chip',category:'Core'},41:{name:'Shrink Ray',category:'Cannon'},42:{name:'Sharp Fortitude',category:'Armor'},43:{name:'Project Funding',category:'Generator'},44:{name:'Magnetic Hook',category:'Core'},45:{name:'Amplifying Strike',category:'Cannon'},46:{name:'Orbital Augment',category:'Armor'},47:{name:'Restorative Bonus',category:'Generator'},48:{name:'Primordial Collapse',category:'Core'},49:{name:'Acceleration Augment',category:'Cannon'},50:{name:'Sentry Protocol',category:'Armor'},51:{name:'Gilded Sniper',category:'Generator'},52:{name:'Tactical Barrage',category:'Core'}};

  // effectId -> [label, rarityName, displayValue] for every Armor substat id
  // (81-154, all 6 rarity tiers per stat where the game has that tier). Built
  // directly from the game's own datamined per-effect table (id -> {clusterIndex,
  // rarity, benefit}, TheTowerSDK's assets.ts MODULE_EFFECTS_TABLE) cross-referenced
  // against its separately-verified in-game display-value chart
  // (module-substats.ts) for the formatted value string - the raw "benefit"
  // numbers in the effect table are in different internal units per stat (e.g.
  // Land Mine Damage's raw benefit is 100x the displayed multiplier), so the
  // curated chart value is authoritative for what's actually shown in-game.
  const SUBSTAT_DETAILS = {81:["Health Regen","Common","+0.2x"],82:["Health Regen","Rare","+0.4x"],83:["Health Regen","Epic","+0.6x"],84:["Health Regen","Legendary","+1x"],85:["Health Regen","Mythic","+2x"],86:["Health Regen","Ancestral","+4x"],87:["Defense","Common","+1%"],88:["Defense","Rare","+2%"],89:["Defense","Epic","+3%"],90:["Defense","Legendary","+5%"],91:["Defense","Mythic","+6%"],92:["Defense","Ancestral","+8%"],93:["Defense Absolute","Common","0.15x"],94:["Defense Absolute","Rare","0.25x"],95:["Defense Absolute","Epic","+0.4x"],96:["Defense Absolute","Legendary","+1x"],97:["Defense Absolute","Mythic","+5x"],98:["Defense Absolute","Ancestral","+10x"],99:["Thorns Damage","Epic","+2%"],100:["Thorns Damage","Legendary","+4%"],101:["Thorns Damage","Mythic","+7%"],102:["Thorns Damage","Ancestral","+10%"],103:["Lifesteal","Epic","+0.3%"],104:["Lifesteal","Legendary","+0.5%"],105:["Lifesteal","Mythic","+1.5%"],106:["Lifesteal","Ancestral","+2%"],107:["Knockback Chance","Epic","+2%"],108:["Knockback Chance","Legendary","+4%"],109:["Knockback Chance","Mythic","+6%"],110:["Knockback Chance","Ancestral","+9%"],111:["Knockback Force","Epic","+0.1"],112:["Knockback Force","Legendary","+0.4"],113:["Knockback Force","Mythic","+0.9"],114:["Knockback Force","Ancestral","+1.5"],115:["Orb Speed","Epic","+1"],116:["Orb Speed","Legendary","1.5"],117:["Orb Speed","Mythic","+2"],118:["Orb Speed","Ancestral","+3"],119:["Orbs","Mythic","+1"],120:["Orbs","Ancestral","+2"],121:["Shockwave Size","Epic","+0.1"],122:["Shockwave Size","Legendary","+0.3"],123:["Shockwave Size","Mythic","+0.7"],124:["Shockwave Size","Ancestral","+1"],125:["Shockwave Frequency","Epic","-1"],126:["Shockwave Frequency","Legendary","-2"],127:["Shockwave Frequency","Mythic","+-3"],128:["Shockwave Frequency","Ancestral","-4"],129:["Land Mine Chance","Rare","+1.5%"],130:["Land Mine Chance","Epic","+3%"],131:["Land Mine Chance","Legendary","+6%"],132:["Land Mine Chance","Mythic","+9%"],133:["Land Mine Chance","Ancestral","+12%"],134:["Land Mine Damage","Rare","+0.3x"],135:["Land Mine Damage","Epic","+0.5x"],136:["Land Mine Damage","Legendary","+1.5x"],137:["Land Mine Damage","Mythic","+5x"],138:["Land Mine Damage","Ancestral","+8x"],139:["Land Mine Radius","Rare","+0.1"],140:["Land Mine Radius","Epic","+0.15"],141:["Land Mine Radius","Legendary","+0.3"],142:["Land Mine Radius","Mythic","+0.75"],143:["Land Mine Radius","Ancestral","+1"],144:["Death Defy","Legendary","+1.5%"],145:["Death Defy","Mythic","+3.5%"],146:["Death Defy","Ancestral","+5%"],147:["Wall Health","Epic","+0.2x"],148:["Wall Health","Legendary","+0.4x"],149:["Wall Health","Mythic","+0.9x"],150:["Wall Health","Ancestral","+1.2x"],151:["Wall Rebuild","Epic","-20s"],152:["Wall Rebuild","Legendary","-40s"],153:["Wall Rebuild","Mythic","-60s"],154:["Wall Rebuild","Ancestral","-100s"],
    // Core-category substat (not Armor), effect ids 274/275/276, clusterIndex
    // 61 "Inner_Land_Mines_Quantity" per TheTowerSDK's own game-data catalog
    // (src/data/modules/enums.data.ts / src/data/assets/data.ts), benefitType
    // 1 (flat add) values 1/2/3 at rarity 6/8/10 = Legendary/Mythic/Ancestral.
    // This is exactly the module term `ModuleManager.GetInnerLandMinesQuantity()`
    // sums (GetEquippedClusterBenefit(0x3d) + GetEquippedAssistClusterBenefit(0x3d),
    // clusterId 0x3d=61) inside Main.GetInnerLandMineQuantity() - see
    // INNER_LAND_MINE_ORBIT_RADIUS/applyPresetIndex's ultimateWeaponLevel[13]
    // read for the rest of that formula.
    274:["Inner Land Mines - Quantity","Legendary","+1"],
    275:["Inner Land Mines - Quantity","Mythic","+2"],
    276:["Inner Land Mines - Quantity","Ancestral","+3"],
  };

  // Module's own overall rarity (ModuleItem.currentRarity), confirmed straight
  // from the game's ModuleRarity enum in dump.cs - 0 (None) through 15
  // (Ancestral 5), the "+"/numbered tiers coming from merging duplicate copies.
  const MODULE_RARITY_NAMES = {0:"None",1:"Common",2:"Rare",3:"Rare +",4:"Epic",5:"Epic +",6:"Legendary",7:"Legendary +",8:"Mythic",9:"Mythic +",10:"Ancestral",11:"Ancestral 1",12:"Ancestral 2",13:"Ancestral 3",14:"Ancestral 4",15:"Ancestral 5"};

  let currentArmor = { Primary: null, Assist: null };
  let currentCore = { Primary: null, Assist: null };
  let inventoryByGuid = {};
  let primaryArmorOptions = [];
  let assistArmorOptions = [];
  let sentryProtocolInPlay = false;
  const ARMOR_CATEGORY_IDX = CATEGORY_ORDER.indexOf('Armor'); // 1
  const CORE_CATEGORY_IDX = CATEGORY_ORDER.indexOf('Core'); // 3

  function readModuleItem(raw){
    if (!raw || typeof raw !== 'object') return null;
    const effects = toNumArr(raw.effects);
    const effectLocked = toBoolArr(raw.effectLocked);
    if (coerceNum(raw.infoIndex) == null && effects.every(e => e === 0)) return null; // empty slot
    return {
      infoIndex: coerceNum(raw.infoIndex),
      level: coerceNum(raw.level),
      rarityEnum: coerceNum(raw.currentRarity),
      effects,
      effectLocked,
      unlockedCount: effectLocked.filter(Boolean).length,
      guid: raw.guid,
    };
  }

  // A save's inventory list excludes whatever's currently equipped anywhere
  // (confirmed against a real save: a module sitting in moduleEquipped[Armor]
  // has a guid absent from inventory entirely) - so the full pool of owned
  // modules is inventory UNION the live Primary/Assist equipped slots, or an
  // Ancestral copy that's currently equipped under one preset silently
  // vanishes from another preset's dropdown (and its own preset's GUID
  // lookup falls through to whatever's live-equipped instead, resolving to
  // the wrong module entirely).
  function buildInventoryIndex(){
    inventoryByGuid = {};
    const addItem = raw => {
      const item = readModuleItem(raw);
      if (item && item.guid) inventoryByGuid[item.guid] = item;
    };
    unwrapList(saveRoot.inventory).forEach(addItem);
    unwrapList(saveRoot.moduleEquipped).forEach(addItem);
    unwrapList(saveRoot.assistModuleSlots).forEach(slot => { if (slot) addItem(slot.equippedModule); });
  }

  // A save's globalPresets (List<GlobalPresetData>) ties workshop/cards/bots/
  // modules/guardians preset indices together per named preset. The preset
  // selector above indexes into the workshop preset list directly, so match
  // by name to find the corresponding modulesIndex; fall back to the same
  // raw index if globalPresets is absent or has no matching name.
  function findGlobalPresetForIndex(i){
    const wsNames = toStrArr(saveRoot.workshopPresetName);
    const name = wsNames[i];
    const globalList = unwrapList(saveRoot.globalPresets);
    if (name) {
      const match = globalList.find(g => g && g.presetName === name);
      if (match) return match;
    }
    return globalList[i] || null;
  }

  // Every Armor module the player owns, for the dropdown lists — not just
  // what's equipped, so a different one can be previewed without switching
  // gear in-game.
  function buildArmorInventoryOptions(){
    const options = [];
    Object.values(inventoryByGuid).forEach(item => {
      const known = MODULE_NAMES[item.infoIndex];
      if (known && known.category === 'Armor') options.push(item);
    });
    options.sort((a, b) => (b.rarityEnum ?? -1) - (a.rarityEnum ?? -1));
    return options;
  }

  // Which Armor module this save preset actually equips for a role, via
  // globalPresets -> modulePresets (GUID, Armor slot) -> inventory. Falls
  // back to the currently-equipped slot if the GUID isn't found in inventory
  // or modulePresets is absent from this save. Assist slots nest their
  // ModuleItem under equippedModule, not on the slot object itself.
  function resolveEquippedArmor(i){
    const result = { Primary: null, Assist: null };
    if (!saveRoot) return result;

    const modulePresetsList = unwrapList(saveRoot.modulePresets);
    const globalEntry = findGlobalPresetForIndex(i);
    const modulesIndex = globalEntry ? coerceNum(globalEntry.modulesIndex) : null;
    const preset = modulePresetsList[modulesIndex != null ? modulesIndex : i] || null;

    if (preset) {
      const pGuid = Array.isArray(preset.primaryModuleGuids) ? preset.primaryModuleGuids[ARMOR_CATEGORY_IDX] : null;
      const aGuid = Array.isArray(preset.assistModuleGuids) ? preset.assistModuleGuids[ARMOR_CATEGORY_IDX] : null;
      if (pGuid) result.Primary = inventoryByGuid[pGuid] || null;
      if (aGuid) result.Assist = inventoryByGuid[aGuid] || null;
    }

    if (!result.Primary) {
      const equipped = unwrapList(saveRoot.moduleEquipped);
      const item = readModuleItem(equipped[ARMOR_CATEGORY_IDX]);
      if (item) result.Primary = item;
    }
    if (!result.Assist) {
      const slots = unwrapList(saveRoot.assistModuleSlots);
      const armorSlot = slots.find(s => s && ASSIST_TYPE_TO_CATEGORY[coerceNum(s.type)] === 'Armor');
      const item = armorSlot ? readModuleItem(armorSlot.equippedModule) : null;
      if (item) result.Assist = item;
    }

    return result;
  }

  // Same resolution as resolveEquippedArmor above but for the Core category -
  // there's no Core dropdown UI in this tool (unlike Armor, which needs one
  // for Sentry Protocol detection/preview), this just needs the live
  // equipped Primary/Assist Core modules to sum their "Inner Land Mines -
  // Quantity" substat, the module term of Main.GetInnerLandMineQuantity()'s
  // formula (see SUBSTAT_DETAILS ids 274/275/276 above).
  function resolveEquippedCore(i){
    const result = { Primary: null, Assist: null };
    if (!saveRoot) return result;

    const modulePresetsList = unwrapList(saveRoot.modulePresets);
    const globalEntry = findGlobalPresetForIndex(i);
    const modulesIndex = globalEntry ? coerceNum(globalEntry.modulesIndex) : null;
    const preset = modulePresetsList[modulesIndex != null ? modulesIndex : i] || null;

    if (preset) {
      const pGuid = Array.isArray(preset.primaryModuleGuids) ? preset.primaryModuleGuids[CORE_CATEGORY_IDX] : null;
      const aGuid = Array.isArray(preset.assistModuleGuids) ? preset.assistModuleGuids[CORE_CATEGORY_IDX] : null;
      if (pGuid) result.Primary = inventoryByGuid[pGuid] || null;
      if (aGuid) result.Assist = inventoryByGuid[aGuid] || null;
    }

    if (!result.Primary) {
      const equipped = unwrapList(saveRoot.moduleEquipped);
      const item = readModuleItem(equipped[CORE_CATEGORY_IDX]);
      if (item) result.Primary = item;
    }
    if (!result.Assist) {
      const slots = unwrapList(saveRoot.assistModuleSlots);
      const coreSlot = slots.find(s => s && ASSIST_TYPE_TO_CATEGORY[coerceNum(s.type)] === 'Core');
      const item = coreSlot ? readModuleItem(coreSlot.equippedModule) : null;
      if (item) result.Assist = item;
    }

    return result;
  }

  // Mirrors sumArmorSubstatValue above but over the equipped Core modules.
  function sumCoreSubstatValue(label){
    let total = 0;
    [currentCore.Primary, currentCore.Assist].forEach(item => {
      if (!item) return;
      item.effects.forEach((id, idx) => {
        if (!id || !item.effectLocked[idx]) return;
        const detail = SUBSTAT_DETAILS[id];
        if (detail && detail[0] === label) {
          const v = parseFloat(detail[2]);
          if (!isNaN(v)) total += v;
        }
      });
    });
    return total;
  }

  // Any assist slot's own unlocked flag governs that category — the save's
  // top-level assistModulesAvailable was found to read false even on a save
  // where all 4 assist slots report unlocked:true, so it's not used here.
  function isAssistArmorUnlocked(){
    const slots = unwrapList(saveRoot.assistModuleSlots);
    const armorSlot = slots.find(s => s && ASSIST_TYPE_TO_CATEGORY[coerceNum(s.type)] === 'Armor');
    return !!(armorSlot && armorSlot.unlocked === true);
  }

  // Whether Sentry Protocol is equipped as Armor anywhere in this save - the
  // live Primary/Assist slots, or any saved preset's Armor GUID - so the
  // "not Sentry Protocol" warning doesn't fire while just previewing a
  // different Armor module that isn't the one actually in play.
  function isSentryProtocolEquippedAnywhere(){
    const isSentryItem = item => {
      if (!item) return false;
      const known = MODULE_NAMES[item.infoIndex];
      return !!known && known.name.toLowerCase() === 'sentry protocol';
    };

    const equipped = unwrapList(saveRoot.moduleEquipped);
    if (isSentryItem(readModuleItem(equipped[ARMOR_CATEGORY_IDX]))) return true;

    const assistSlots = unwrapList(saveRoot.assistModuleSlots);
    const armorSlot = assistSlots.find(s => s && ASSIST_TYPE_TO_CATEGORY[coerceNum(s.type)] === 'Armor');
    if (armorSlot && isSentryItem(readModuleItem(armorSlot.equippedModule))) return true;

    const presets = unwrapList(saveRoot.modulePresets);
    return presets.some(p => {
      if (!p) return false;
      const pGuid = Array.isArray(p.primaryModuleGuids) ? p.primaryModuleGuids[ARMOR_CATEGORY_IDX] : null;
      const aGuid = Array.isArray(p.assistModuleGuids) ? p.assistModuleGuids[ARMOR_CATEGORY_IDX] : null;
      return isSentryItem(pGuid && inventoryByGuid[pGuid]) || isSentryItem(aGuid && inventoryByGuid[aGuid]);
    });
  }

  function optionsWithFallback(baseOptions, item){
    if (!item) return baseOptions;
    if (item.guid && baseOptions.some(o => o.guid === item.guid)) return baseOptions;
    return [item, ...baseOptions];
  }

  function populateArmorSelect(selectEl, options){
    selectEl.innerHTML = options.length
      ? options.map(o => {
          const known = MODULE_NAMES[o.infoIndex];
          const label = known ? known.name : ('infoIndex ' + o.infoIndex);
          const rarityName = MODULE_RARITY_NAMES[o.rarityEnum] ?? ('rarity ' + o.rarityEnum);
          return '<option value="' + (o.guid || '') + '">' + label + ' — ' + rarityName + '</option>';
        }).join('')
      : '<option value="">No owned Armor modules found</option>';
  }

  function refreshArmorModules(i){
    buildInventoryIndex();
    sentryProtocolInPlay = isSentryProtocolEquippedAnywhere();
    const equipped = resolveEquippedArmor(i);
    const baseOptions = buildArmorInventoryOptions();
    primaryArmorOptions = optionsWithFallback(baseOptions, equipped.Primary);
    assistArmorOptions = optionsWithFallback(baseOptions, equipped.Assist);

    populateArmorSelect($('modulePrimarySelect'), primaryArmorOptions);
    populateArmorSelect($('moduleAssistSelect'), assistArmorOptions);
    if (equipped.Primary) $('modulePrimarySelect').value = equipped.Primary.guid || '';
    if (equipped.Assist) $('moduleAssistSelect').value = equipped.Assist.guid || '';

    currentArmor = equipped;
    currentCore = resolveEquippedCore(i);
    $('modMineCount').value = sumCoreSubstatValue('Inner Land Mines - Quantity');
    renderModuleDetail('Primary');
    renderModuleDetail('Assist');
  }

  function buildModuleCardHtml(item, role){
    if (!item) return '<div class="mod-empty">No Armor module selected.</div>';

    const known = MODULE_NAMES[item.infoIndex];
    const name = known ? known.name : ('Unresolved module (infoIndex ' + item.infoIndex + ')');
    const isSentryProtocol = known ? known.name.toLowerCase() === 'sentry protocol' : null;

    let banner = '';
    if (isSentryProtocol === true) {
      banner = '<div class="mod-ok">This is the Sentry Protocol module — the mechanics in this tool are active for it.</div>';
    } else if (isSentryProtocol === false && !sentryProtocolInPlay) {
      banner = '<div class="mod-warn">This is <strong>' + name + '</strong>, not Sentry Protocol — the orb-targeting mechanics this tool models are not active unless Sentry Protocol is equipped somewhere.</div>';
    } else if (isSentryProtocol == null && !sentryProtocolInPlay) {
      banner = '<div class="mod-warn">Unrecognized module (infoIndex ' + item.infoIndex + ') — outside this tool\'s catalog (infoIndex 1–52), so this could be Sentry Protocol or could not be. Check the name in-game to be sure.</div>';
    }

    const substatRows = item.effects.map((id, idx) => {
      if (!id) return '';
      const unlocked = item.effectLocked[idx];
      const detail = SUBSTAT_DETAILS[id];
      const label = detail ? detail[0] : ('Unresolved substat (id ' + id + ')');
      const rarity = detail ? detail[1] : '?';
      const value = detail ? detail[2] : '';
      const isOrbs = label === 'Orbs';
      return '<div class="substat-row' + (unlocked ? '' : ' locked') + '">' +
        '<span>' + label + (isOrbs ? ' <span class="orbflag">Orbs</span>' : '') + '</span>' +
        '<span class="lockflag">' + rarity + (value ? ' · ' + value : '') + '</span>' +
        '</div>';
    }).join('');

    const rarityName = MODULE_RARITY_NAMES[item.rarityEnum] ?? ('rarity ' + item.rarityEnum);
    return '<div class="mod-card">' +
      '<div class="mod-head"><span class="name">' + name + '</span>' +
      '<span class="meta">' + role + ' · Armor · ' + rarityName + ' · ' + item.unlockedCount + '/8 unlocked</span></div>' +
      banner +
      '<div class="substat-list">' + (substatRows || '<div class="mod-empty">No substats recorded.</div>') + '</div>' +
      '</div>';
  }

  function renderModuleDetail(role){
    const sel = role === 'Primary' ? $('modulePrimarySelect') : $('moduleAssistSelect');
    const detailEl = role === 'Primary' ? $('modDetailPrimary') : $('modDetailAssist');
    const options = role === 'Primary' ? primaryArmorOptions : assistArmorOptions;
    const item = options.find(o => o.guid === sel.value) || null;
    detailEl.innerHTML = buildModuleCardHtml(item, role);
  }

  $('modulePrimarySelect').addEventListener('change', () => renderModuleDetail('Primary'));
  $('moduleAssistSelect').addEventListener('change', () => renderModuleDetail('Assist'));

  function hasOrbsSubstat(item){
    if (!item) return false;
    return item.effects.some((id, idx) => id === 120 && item.effectLocked[idx]);
  }

  // Sums an unlocked substat's numeric value (by label) across whichever
  // Armor modules are equipped Primary/Assist in this preset - used for the
  // Land Mine Radius module bonus, computed from the save rather than typed in.
  function sumArmorSubstatValue(label){
    let total = 0;
    [currentArmor.Primary, currentArmor.Assist].forEach(item => {
      if (!item) return;
      item.effects.forEach((id, idx) => {
        if (!id || !item.effectLocked[idx]) return;
        const detail = SUBSTAT_DETAILS[id];
        if (detail && detail[0] === label) {
          const v = parseFloat(detail[2]);
          if (!isNaN(v)) total += v;
        }
      });
    });
    return total;
  }

  function isSpaceDisplacerEquipped(){
    const isSD = item => {
      if (!item) return false;
      const known = MODULE_NAMES[item.infoIndex];
      return !!known && known.name === 'Space Displacer';
    };
    return isSD(currentArmor.Primary) || isSD(currentArmor.Assist);
  }

  function applyVaultAndArmorDetection(){
    // Vault "Orbs" node (VaultID.OrbsCount=280) - VaultManager dictionary
    // lookup, not the old TechTreeManager powerNodesLevel[] array. See
    // VAULT_ORBS_COUNT_VAULT_ID above for the full sourcing note.
    const vaultOrb = vaultUpgradeLevel(VAULT_ORBS_COUNT_VAULT_ID) > 0;
    $('vaultOrbNode').checked = vaultOrb;

    // Assist Armor may not be unlocked at all yet.
    const assistUnlocked = isAssistArmorUnlocked();
    const primaryArmor = currentArmor.Primary;
    const assistArmor = currentArmor.Assist;

    $('primaryArmorOrbs').checked = hasOrbsSubstat(primaryArmor);

    const effInput = $('assistArmorOrbsEff');
    if (!assistUnlocked || !hasOrbsSubstat(assistArmor)) {
      effInput.value = 0;
    } else if (!effInput.value || effInput.value === '0') {
      effInput.value = 100;
    }

    // Hide the Assist module dropdown entirely if the system isn't unlocked.
    $('assistModuleWrap').style.display = assistUnlocked ? '' : 'none';
    $('modulePrimarySelect').disabled = false;
    $('moduleAssistSelect').disabled = !assistUnlocked;

    // Land Mine Radius module bonus: summed from the save, not typed in.
    $('modMineRadius').value = fmt(sumArmorSubstatValue('Land Mine Radius'), 2);

    const spaceDisplacerEquipped = isSpaceDisplacerEquipped();
    const sdCheckbox = $('showSpaceDisplacer');
    sdCheckbox.disabled = !spaceDisplacerEquipped;
    sdCheckbox.checked = spaceDisplacerEquipped;

    render();
  }

  // ============== core math (unchanged) ==============
  // Verified against Main.CalculateUpgradeBonuses' actual write to maxDistance
  // (not just the SDK's paraphrase of it): the cap REDUCES raw as it climbs
  // past the knee — the sign was backwards here before. DAT_00d33134=0.16
  // confirmed straight out of the binary.
  function softCap(raw){
    if (raw < C.CAP_KNEE) return raw;
    const capped = Math.min(raw, C.CAP_CEIL);
    const scale = 1 - C.CAP_SLOPE * (capped - C.CAP_KNEE) / (C.CAP_CEIL - C.CAP_KNEE);
    return raw * scale;
  }

  // Cards.cardBenefit[4,level] — field offsets confirmed (dump.cs), the
  // per-level values themselves are not: this is TheTowerSDK's community
  // table (unconfirmed against the binary, see methodology.md). Levels
  // beyond the table clamp to the last known value.
  const CARD_BENEFIT_TABLE = [null, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.45];
  function cardBenefitForLevel(level){
    const lvl = Math.max(1, Math.min(CARD_BENEFIT_TABLE.length - 1, Math.round(level)));
    return CARD_BENEFIT_TABLE[lvl];
  }

  function computeAttackRange(){
    // Two confirmed, distinct real functions share this formula shape but read
    // different arrays:
    //   Main.GetOutOfRoundMaxDistance  -> Main.upgradeWorkshopLevel[4]  (pre-battle, Workshop screen)
    //   Main.CalculateUpgradeBonuses   -> Main.upgradeLevel[4]          (in-round cash buys, resets to 0/battle)
    // raw = (base + increase×labLevel) × (upgradeX[4]×0.05 + 3.0) × cardBenefit[4,level]
    const lab = Math.min(RANGE_LAB_MAX_LEVEL, Math.max(0, parseFloat($('labLevel').value) || 0));
    const midBattle = $('midBattle').checked;
    // Only the Workshop-level path has a confirmed real cap (79) - in-round
    // cash buys (battleLevel) reset to 0 each battle and have no known limit,
    // so that path is intentionally left unclamped here.
    const upgradeCount = midBattle
      ? (parseFloat($('battleLevel').value) || 0)
      : Math.min(WS_RANGE_MAX_LEVEL, Math.max(0, parseFloat($('wsLevel').value) || 0));
    const cardOn = $('cardActive').checked;
    const cardLvl = parseInt($('cardLevel').value, 10) || 1;
    const cardMult = cardOn ? cardBenefitForLevel(cardLvl) : 1;

    const labTerm = C.LAB_BASE + C.LAB_INCREASE * lab;
    const upgradeMult = C.UPG_BASE + C.UPG_STEP * upgradeCount;
    const raw = labTerm * upgradeMult * cardMult;
    const capped = softCap(raw);
    return { labTerm, upgradeMult, raw, capped };
  }

  function ringBounds(attackRange){
    const floor = Math.min(attackRange, C.FLOOR_CONST);
    const ceil = attackRange * C.CEIL_MULT;
    const steps = attackRange > C.FLOOR_CONST ? 10 : 5;
    return { floor, ceil, steps };
  }

  function stepToRadius(step, bounds){
    const s = Math.max(0, Math.min(bounds.steps, step));
    return bounds.floor + (bounds.ceil - bounds.floor) / bounds.steps * s;
  }

  function radiusToStep(radius, bounds){
    if (bounds.ceil <= bounds.floor) return 0;
    const s = (radius - bounds.floor) / (bounds.ceil - bounds.floor) * bounds.steps;
    return Math.round(Math.max(0, Math.min(bounds.steps, s)));
  }

  // A single ring's own orbs, evenly spaced by count, starting at the top -
  // still correct for a self-contained ring (e.g. the Space Displacer mine
  // orbit, which has no Workshop/Card split of its own).
  function computeEvenAngles(N){
    const angles = [];
    for (let i = 0; i < N; i++) angles.push(-Math.PI/2 + i * (2*Math.PI/N));
    return angles;
  }

  // Confirmed against three of the user's own screenshots (two different
  // Workshop-orbit radii, one with the Card slider at floor and one at
  // ceiling): Workshop and Card orbs are NOT two independent rings. Every
  // active orb - both types together - shares ONE combined evenly-spaced
  // angular grid: angle_i = i × 360°/(wsN+cardN), traced to Main.OrbCheck's
  // final step, which LINQ-filters Main.orbObjects, merges in the Card ring's
  // transforms when the Extra Orb card is active, and evenly spaces the
  // WHOLE combined List<Transform> with one loop
  // (`localEulerAngles.z = index × 360/count`). Each orb's RADIUS is simply
  // its own type's slider radius (wsR/cardR) - no bonus-orb compression.
  // A compression-shaped formula does exist in Main.OrbCheck
  // (`((r-3)/(r×0.05+2)+3.3)×1.166`, computed from Main.WorkshopOrbAppliedDistance
  // right before a loop that positions orb slots 4+), so an earlier version of
  // this tool applied it to every Workshop/Card orb beyond the first 4. Two
  // independent real screenshots disproved that: a 4-base + 2-bonus + 3-card
  // save measured all 9 orbs (bonus included) within a 1.5px radius spread
  // (171.8-173.3px) - dead flat, no split. So whatever that OrbCheck formula
  // actually gates (still unconfirmed - possibly a different/rarer extra-orb
  // source than Orb Perk/Armor substat/Vault node), it isn't triggered by the
  // ordinary ways a save can have more than 4 Workshop or Card orbs, and the
  // tool no longer applies it.

  // The combined list's build order - confirmed against two real screenshots
  // at different Workshop/Card counts, not just one anymore, and they pin
  // down a single general rule instead of a fixed "4 base" guess. A
  // 4-Workshop + 2-bonus + 3-Card save (6 Workshop, 3 Card) measured
  // Workshop,Workshop,Workshop,Workshop,Card,Workshop,Card,Workshop,Card - an
  // initial run of 4 Workshop. A separate save with 7 Workshop (level +
  // substats + a 1-stack Orb Perk) and 3 Card measured
  // Workshop×5,Card,Workshop,Card,Workshop,Card - an initial run of 5. Both
  // fit exactly: initialRun = majorCount - minorCount + 1 (4 = 6-3+1,
  // 5 = 7-3+1), then the remainder alternates minor,major,minor,...,minor -
  // i.e. the minor type opens AND closes that alternating tail, sandwiching
  // (minorCount-1) of the major type between minorCount of the minor type.
  // Only the Workshop-majority direction has real screenshot evidence;
  // Card-majority (more Card orbs than Workshop) is extrapolated
  // symmetrically below, not independently confirmed. Radius doesn't vary
  // within a type (see note above), so this order only affects angle.
  function buildCombinedOrbSlots(wsN, wsR, cardN, cardR){
    wsN = Math.max(0, Math.round(wsN));
    cardN = Math.max(0, Math.round(cardN));

    const slots = [];
    const majorIsWs = wsN >= cardN;
    const majorN = majorIsWs ? wsN : cardN;
    const minorN = majorIsWs ? cardN : wsN;
    const majorSlot = { type: majorIsWs ? 'ws' : 'card', r: majorIsWs ? wsR : cardR };
    const minorSlot = { type: majorIsWs ? 'card' : 'ws', r: majorIsWs ? cardR : wsR };

    const initialRun = majorN - Math.max(0, minorN - 1);
    for (let i = 0; i < initialRun; i++) slots.push({ ...majorSlot });

    let remainingMajor = majorN - initialRun; // = minorN - 1, once minorN>0
    for (let i = 0; i < minorN; i++){
      slots.push({ ...minorSlot });
      if (remainingMajor > 0){ slots.push({ ...majorSlot }); remainingMajor--; }
    }
    return slots;
  }

  // Each slot gets its shared angle (index × 360°/N, starting at the top)
  // plus its own individually-computed radius.
  function placeCombinedOrbs(slots){
    const n = slots.length;
    return slots.map((s, i) => ({
      ...s,
      angle: n > 0 ? (-Math.PI/2 + i * (2*Math.PI/n)) : 0,
    }));
  }

  // C.PULSE (1.5) is not a cosmetic halo radius picked for looks - it's
  // Sentry Protocol's real mini-orb targeting radius, confirmed directly
  // from `Main.SentryProtocolFire`'s decompile: `Physics2D.OverlapCircle
  // (orbPosition, 0x3fc00000/*=1.5f*/, ...)`, called once per orb each
  // tick to find a nearby enemy to fire a mini-orb at. That's a true,
  // fixed Unity-world-space radius - the same category as Wall/Mine
  // Radius/Space Displacer - so it needs the same `trueWorldSizeToPlotted`
  // conversion before it's comparable to `placed` orbs' already-converted
  // radii, exactly like every other true-world quantity on this plot. It
  // was NOT getting that conversion before - used directly as if it were
  // already in plotted units - which silently broke both the "no gaps"
  // check and the halo visual at any save whose ring-compression ratio
  // differs much from 1:1 (i.e. most saves, and increasingly so at higher
  // stats). Caught directly from real gameplay evidence: three screenshots
  // showing three non-adjacent orbs (7, 8, 9 on a 9-orb ring) all firing
  // mini-orbs at one nearby enemy - real adjacent-orb spacing at that
  // account's scale is far too large for that to happen if 1.5 raw units
  // were being compared against already-converted (and much larger at
  // that scale) plotted-space gaps directly.
  //
  // Adjacent orbs (by shared angular order) can sit at different radii, so
  // the gap between them is the straight-line distance between two polar
  // points, via the law of cosines - not a same-radius chord formula.
  function coverageStatsFromPlacedOrbs(placed, pulsePlotted){
    if (!placed || placed.length === 0) return null;
    const n = placed.length;
    let maxGap = 0;
    let minR = Infinity, maxR = 0;
    for (let i = 0; i < n; i++){
      const a = placed[i], b = placed[(i+1) % n];
      const dTheta = (b.angle - a.angle + 2*Math.PI) % (2*Math.PI) || 2*Math.PI/n;
      const dist = Math.sqrt(a.r*a.r + b.r*b.r - 2*a.r*b.r*Math.cos(dTheta));
      maxGap = Math.max(maxGap, dist);
      minR = Math.min(minR, a.r);
      maxR = Math.max(maxR, a.r);
    }
    return { spacing: maxGap, band: [minR - pulsePlotted, maxR + pulsePlotted], gapFree: maxGap <= 2*pulsePlotted };
  }

  // The real out-of-round formula (Main.GetOutOfRoundOrbCount, decompiled
  // directly) is workshopLevel + ModuleManager.OrbCount (equipped+assist
  // "Orbs" substat cluster) + VaultManager.GetBenefit(vault, VaultID.OrbsCount)
  // - no Perk term appears in it at all, because Perks are an in-round-only
  // mechanic and this is the out-of-round formula. The Orb Perk is real
  // (found separately, disassembling Perks.Initialize() and cross-checking
  // the localization table - perk index 7: maxLevel=2, base=0/increase=1,
  // exempt from lab scaling, matching strings "Orbs"/"+{0} orb"), just not
  // part of this formula - it's applied in-round, exact code path not yet
  // traced. So: Workshop (0-4, +1/level, confirmed), Orb Perk (0-2 stacks,
  // +1 orb each, confirmed magnitude, in-round-only so not save-detectable),
  // Orbs substat on primary Ancestral Armor (+2, read from the save), the
  // same substat on an Assist Armor module scaled by its substat efficiency
  // (+2 × eff%, presence read from the save / manual efficiency), and the
  // Vault "Orbs" node (+1, VaultID.OrbsCount, read from the save). This is
  // the MAIN/Workshop ring's population — the Extra Orb card drives a
  // wholly separate ring (see Card orbit below).
  function computeWorkshopOrbTotal(){
    const level = Math.min(4, parseInt($('wsOrbLevel').value, 10) || 0);
    const perk = Math.min(2, Math.max(0, parseInt($('orbPerk').value, 10) || 0));
    const primaryArmor = $('primaryArmorOrbs').checked ? 2 : 0;
    const assistEff = parseFloat($('assistArmorOrbsEff').value) || 0;
    const assistArmor = 2 * (assistEff / 100);
    const vault = $('vaultOrbNode').checked ? 1 : 0;
    return level + perk + primaryArmor + assistArmor + vault;
  }

  // Confirmed real formula (Main.CalculateUpgradeBonuses' write to mineRadius):
  // 0.5 + 0.02×level + module bonus. Level here assumes the same
  // workshop-seeds-the-in-round-counter pattern confirmed for Range. This is
  // the raw game stat (blast radius) only - see MINE_AOE_NATIVE_RADIUS below
  // for the true-world conversion. No longer plotted as its own landmark
  // (that's INNER_LAND_MINE_ORBIT_RADIUS now, a different real quantity -
  // see its comment) - this still drives the "Snap Card ring to blast
  // radius" button.
  function computeMineRadius(){
    const modBonus = parseFloat($('modMineRadius').value) || 0;
    return C.MINE_BASE + C.MINE_STEP * mineWorkshopLevel + modBonus;
  }

  // "Area of Effect" CircleCollider2D's own native radius (level1, resolved
  // via LandMine's serialized bytes). The raw mineRadius stat gets applied
  // as a Transform scale on that collider, so true world blast radius =
  // mineRadius × this, not mineRadius alone.
  const MINE_AOE_NATIVE_RADIUS = 0.9;

  // The mine ICON's own visual size (not its blast radius, MINE_AOE_NATIVE_RADIUS
  // above) - for drawing the mine-ring dots to scale, same fix as
  // ORB_NATIVE_RADIUS. Read off the same "landMine" Sprite child already
  // used for the ring-radius investigation (present under all three mine
  // rings this tool draws - primary Inner Land Mine, Extra Set, and Space
  // Displacer's converted mines, all share this one prefab/sprite,
  // confirmed by reading all three scene instances): 156×156px @ 100 PPU,
  // `localScale=0.3` → native radius (156/100/2)×0.3 = 0.234 true world
  // units.
  const MINE_ICON_NATIVE_RADIUS = (156 / 100 / 2) * 0.3;

  function computeRangedStandoff(attackRangeUnits){
    const perkActive = $('rangedEnemyPerkActive').checked;
    const offset = perkActive ? RANGED_STANDOFF_NEAR_OFFSET : RANGED_STANDOFF_FAR_OFFSET;
    const base = (attackRangeUnits - RANGED_STANDOFF_REF_UNITS) / RANGED_STANDOFF_DIVISOR + offset;
    const labLevel = Math.min(RANGED_LAB_MAX_LEVEL, parseFloat($('rangedRangeLabLevel').value) || 0);
    const labFactor = 1 - RANGED_LAB_STEP * labLevel;
    const vaultPct = parseFloat($('rangedRangeVaultPct').value) || 0;
    const vaultFactor = 1 - vaultPct / 100;
    return Math.max(0, base * labFactor * vaultFactor);
  }

  function fmt(n, d){ return (Math.round(n * Math.pow(10,d)) / Math.pow(10,d)).toFixed(d); }
  function m(units){ return units * C.DISPLAY_SCALE; }

  const svgns = 'http://www.w3.org/2000/svg';
  function el(tag, attrs){
    const e = document.createElementNS(svgns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function render(){
    // Mid-battle in-round buys only matter if there's Workshop level left to
    // out-buy - if this preset's Range is already at the real hard cap (79),
    // there's nothing for it to add, so hide the toggle instead of showing a
    // control with no effect.
    const wsMaxed = (parseFloat($('wsLevel').value) || 0) >= WS_RANGE_MAX_LEVEL;
    $('midBattleWrap').style.display = wsMaxed ? 'none' : '';
    if (wsMaxed) $('midBattle').checked = false;

    const ar = computeAttackRange();
    const bounds = ringBounds(ar.capped);

    $('wsStep').max = bounds.steps;
    $('cardStep').max = bounds.steps;

    const wsAdjuster = $('wsAdjuster').checked;
    $('wsStep').disabled = !wsAdjuster;
    $('wsLockNote').textContent = wsAdjuster ? '' : 'Locked at floor — no Workshop Orb Adjuster (Vault) owned.';

    const wsStepVal = wsAdjuster ? parseInt($('wsStep').value, 10) : 0;
    const cardStepVal = parseInt($('cardStep').value, 10);

    // stepToRadius/bounds stay in raw "applied distance" space (matches
    // Main.get_WorkshopOrb/InnerOrbMin/MaxDistance exactly) - conversion to
    // this plot's shared ruler happens here, right before wsR/cardR get
    // used for anything visual (placement, reference circles, labels).
    const wsRRaw = wsAdjuster ? stepToRadius(wsStepVal, bounds) : bounds.floor;
    const cardRRaw = stepToRadius(cardStepVal, bounds);
    const wsR = computeOrbPlottedRadius(wsRRaw, ar.capped);
    const cardR = computeOrbPlottedRadius(cardRRaw, ar.capped);

    $('wsStepVal').textContent = wsAdjuster ? (wsStepVal + ' / ' + bounds.steps) : 'locked';
    $('cardStepVal').textContent = cardStepVal + ' / ' + bounds.steps;

    const wsNExact = computeWorkshopOrbTotal();
    const wsN = Math.round(wsNExact);
    $('wsOrbTotal').textContent = wsN + ' orbs' + (Math.abs(wsNExact - wsN) > 0.01 ? ' (exact: ' + fmt(wsNExact,2) + ')' : '');
    const cardN = parseInt($('cardOrbCount').value, 10) || 0;
    const slots = buildCombinedOrbSlots(wsN, wsR, cardN, cardR);
    const placed = placeCombinedOrbs(slots);
    const pulsePlotted = trueWorldSizeToPlotted(C.PULSE, ar.capped);
    const combinedCov = coverageStatsFromPlacedOrbs(placed, pulsePlotted);

    const landmarks = [];
    // Land Mine blast radius (0.9 × the raw formula output -
    // `LandMine.SetExplosionRadius` sets it as a *scale* on the "Area of
    // Effect" collider, native radius 0.9, no hidden parent scale - see
    // MINE_AOE_NATIVE_RADIUS above) is still real and still computed, via
    // `computeMineRadius()` - just no longer what "Inner land mine" plots
    // below (that's the real mine-position ring now, see
    // INNER_LAND_MINE_ORBIT_RADIUS above). Blast radius still drives the
    // "Snap Card ring to blast radius" button.
    if ($('showMineRadius').checked) {
      landmarks.push({
        name: 'Inner land mine',
        // Real mine-position ring (INNER_LAND_MINE_ORBIT_RADIUS=0.65,
        // confirmed from the actual scene hierarchy - see its comment
        // above), not the blast-radius line this used to plot. Same
        // true-world conversion and rendering style as Space Displacer.
        rInternal: trueWorldSizeToPlotted(INNER_LAND_MINE_ORBIT_RADIUS, ar.capped),
        isMineRing: true,
        // Base+level term (innerLandMineCount, wired to
        // ultimateWeaponLevel[13]) plus the module term (modMineCount,
        // equipped Core modules' "Inner Land Mines - Quantity" substat).
        // The "Extra Set of Inner Mines" Perk is a separate, farther-out
        // ring - see EXTRA_SET_MINE_ORBIT_RADIUS's landmark below, not
        // added in here.
        count: Math.max(0, Math.min(40,
          (parseInt($('innerLandMineCount').value, 10) || 0) +
          (parseInt($('modMineCount').value, 10) || 0))),
        color: C.ILM_COLOR,
      });
    }
    if ($('showMineRadius').checked && $('extraSetPerk').checked) {
      landmarks.push({
        name: 'Extra Set of Inner Mines (Perk)',
        // Genuinely separate, farther-out ring - see
        // EXTRA_SET_MINE_ORBIT_RADIUS's comment above for the scene-data
        // confirmation and the same-session correction of an earlier
        // (wrong) "same ring as the primary" reading.
        rInternal: trueWorldSizeToPlotted(EXTRA_SET_MINE_ORBIT_RADIUS, ar.capped),
        isMineRing: true,
        count: EXTRA_SET_MINE_COUNT,
        color: C.ILM_COLOR,
      });
    }
    if ($('showWall').checked) landmarks.push({ name: 'Wall', rInternal: computeWallRadius(ar.capped), color: C.WALL_COLOR, isBrickWall: true });
    if (!$('showSpaceDisplacer').disabled && $('showSpaceDisplacer').checked) {
      landmarks.push({
        name: 'Space Displacer mine orbit',
        // moduleTargetRadius=1.8 (the real scene-instance value, not the
        // 30.0 compiled default - see SPACE_DISPLACER_RADIUS above) is a
        // true, uncompressed world-space distance - converted the same way
        // as Wall/Mine Radius above, not plotted raw.
        rInternal: trueWorldSizeToPlotted(SPACE_DISPLACER_RADIUS, ar.capped),
        isMineRing: true,
        count: Math.max(0, Math.min(SPACE_DISPLACER_MINE_CAP, parseInt($('spaceDisplacerMineCount').value, 10) || 0)),
        color: C.ILM_COLOR,
      });
    }
    if ($('showRangedStandoff').checked) {
      landmarks.push({ name: 'Ranged enemy', rInternal: computeRangedStandoffPlotted(ar.capped), color: C.RANGED_COLOR });
    }

    drawBoard(ar, bounds, placed, landmarks, wsAdjuster);
    drawReadout(ar, bounds, wsR, wsN, cardR, cardN, combinedCov, wsAdjuster, landmarks);
    drawLegend(landmarks);
  }

  function drawBoard(ar, bounds, placed, landmarks, wsAdjuster){
    const svg = $('rings');
    svg.innerHTML = '';
    const cx = 320, cy = 320;
    // bounds.floor/bounds.ceil are raw "applied distance" - same space as
    // Main.get_WorkshopOrb/InnerOrbMin/MaxDistance - converted here (not
    // used raw) so the min/max reference ring actually lines up with where
    // wsR/cardR (already converted) place the real orb dots below.
    const orbFloorPlotted = computeOrbPlottedRadius(bounds.floor, ar.capped);
    const orbCeilPlotted = computeOrbPlottedRadius(bounds.ceil, ar.capped);
    const landmarkMax = Math.max(0, ...landmarks.map(l => l.rInternal || 0));
    const orbMax = Math.max(0, ...placed.map(p => p.r || 0));
    const maxUnits = Math.max(orbCeilPlotted, landmarkMax, orbMax) * 1.08 || 10;
    const scale = 270 / maxUnits;
    // Sentry Protocol's real mini-orb targeting radius (see
    // coverageStatsFromPlacedOrbs' comment) - a true world size, converted
    // here the same way as Wall/Mine Radius, not used raw.
    const pulsePlotted = trueWorldSizeToPlotted(C.PULSE, ar.capped);
    // The orb's own real size (ORB_NATIVE_RADIUS above), same conversion -
    // drives the plotted dot radius below so the dots render to scale
    // instead of a fixed cosmetic size. Floored at 1.5px so a dot never
    // vanishes at very compressed/zoomed-out scales.
    const orbNativePlotted = trueWorldSizeToPlotted(ORB_NATIVE_RADIUS, ar.capped);
    // Same "render to scale" fix, applied to the mine-ring dots (Inner Land
    // Mine, Extra Set, Space Displacer) - see MINE_ICON_NATIVE_RADIUS above.
    const mineIconPlotted = trueWorldSizeToPlotted(MINE_ICON_NATIVE_RADIUS, ar.capped);

    const gridStep = niceStep(maxUnits / 5);
    for (let u = gridStep; u <= maxUnits; u += gridStep){
      svg.appendChild(el('circle', { cx, cy, r: u*scale, fill:'none', stroke:'#22323f', 'stroke-width':1 }));
      const t = el('text', { x: cx + 4, y: cy - u*scale - 3, fill:'#4a5c68', 'font-size':9, 'font-family':"'IBM Plex Mono'" });
      t.textContent = fmt(m(u),0) + 'm';
      svg.appendChild(t);
    }
    svg.appendChild(el('line', { x1:cx-9, y1:cy, x2:cx+9, y2:cy, stroke:'#e7ddc4', 'stroke-width':1.4 }));
    svg.appendChild(el('line', { x1:cx, y1:cy-9, x2:cx, y2:cy+9, stroke:'#e7ddc4', 'stroke-width':1.4 }));
    svg.appendChild(el('circle', { cx, cy, r:3.5, fill:'#e7ddc4' }));

    [ orbFloorPlotted, orbCeilPlotted ].forEach(u => {
      svg.appendChild(el('circle', { cx, cy, r:u*scale, fill:'none', stroke:'#5a6d78', 'stroke-width':1, 'stroke-dasharray':'2 4' }));
    });

    svg.appendChild(el('circle', { cx, cy, r:ar.capped*scale, fill:'none', stroke:'#9aa9ad', 'stroke-width':1.3 }));

    // Reference lines get a dashed ring; mine-based landmarks (Space
    // Displacer) render as the actual mines instead, no ring line at all -
    // there's nothing there but the mines themselves. Wall gets its own
    // brick-ring rendering (drawBrickWall) instead of a plain dashed line -
    // it's the one landmark with a real, distinctive in-game sprite
    // (extracted and viewed directly: a two-row masonry ring, brick
    // divisions staggered between rows, soft glow) rather than an abstract
    // stat boundary.
    landmarks.forEach(l => {
      if (l.rInternal == null || l.rInternal <= 0 || l.isMineRing || l.isBrickWall) return;
      const color = l.color || '#c1633f';
      svg.appendChild(el('circle', { cx, cy, r:l.rInternal*scale, fill:'none', stroke:color, 'stroke-width':2, 'stroke-dasharray':'1 5', 'stroke-linecap':'round' }));
    });

    landmarks.forEach(l => {
      if (l.isBrickWall && l.rInternal > 0) drawBrickWall(svg, cx, cy, scale, l.rInternal, l.color || C.WALL_COLOR);
    });

    // Actual mine markers for any ring landmark - evenly spaced by real count,
    // same placement math as LandMineController.FixedUpdate's orbit formula.
    landmarks.forEach(l => {
      if (l.isMineRing) drawRing(svg, cx, cy, scale, l.rInternal, computeEvenAngles(l.count), l.color || '#c1633f', 0.9, 0, mineIconPlotted);
    });

    // Faint reference circles at each type's actual radii present (nominal
    // slider radius, plus the compressed bonus radius if any orbs use it) -
    // context for where the dots below actually sit.
    const wsRadii = [...new Set(placed.filter(p => p.type === 'ws').map(p => p.r))];
    const cardRadii = [...new Set(placed.filter(p => p.type === 'card').map(p => p.r))];
    wsRadii.forEach(r => svg.appendChild(el('circle', { cx, cy, r: r*scale, fill:'none', stroke:'#c99a4c', 'stroke-width':1, opacity: wsAdjuster ? 0.35 : 0.2 })));
    cardRadii.forEach(r => svg.appendChild(el('circle', { cx, cy, r: r*scale, fill:'none', stroke:'#6fb8c4', 'stroke-width':1, opacity:0.35 })));

    // The real arrangement: every active orb (Workshop + Card together)
    // sharing one evenly-spaced angular grid, each at its own type's radius.
    placed.forEach(p => {
      const x = cx + p.r*scale*Math.cos(p.angle), y = cy + p.r*scale*Math.sin(p.angle);
      const color = p.type === 'ws' ? '#c99a4c' : '#6fb8c4';
      svg.appendChild(el('circle', { cx:x, cy:y, r:pulsePlotted*scale, fill:color, opacity:0.16, stroke:'none' }));
      svg.appendChild(el('circle', { cx:x, cy:y, r:Math.max(1.5, orbNativePlotted*scale), fill:color, stroke:'#0e1720', 'stroke-width':1 }));
    });
  }

  function polarPt(cx, cy, r, a){
    return { x: cx + r*Math.cos(a), y: cy + r*Math.sin(a) };
  }

  // Re-checked directly against a fresh crop of the reference screenshot
  // (not the extracted 512x512 texture, which read differently out of
  // context and misled the first two passes at this): the real wall is a
  // SINGLE row of elongated bricks with thin mortar gaps, not two staggered
  // masonry rows. Rebuilt to match - one ring of longer blocks.
  function drawBrickWall(svg, cx, cy, scale, R, color){
    const rPx = R * scale;
    if (rPx <= 0) return;
    const thickness = Math.max(5, rPx * 0.16);
    const rowHalf = thickness / 2;
    const brickCount = Math.max(10, Math.min(28, Math.round(rPx / 11)));
    const slot = 2*Math.PI / brickCount;
    const gap = slot * 0.1;

    const filterId = 'wallGlow';
    if (!svg.querySelector('#' + filterId)) {
      const defs = el('defs', {});
      const filter = el('filter', { id: filterId, x:'-80%', y:'-80%', width:'260%', height:'260%' });
      filter.appendChild(el('feGaussianBlur', { stdDeviation: Math.max(1.5, thickness*0.4) }));
      defs.appendChild(filter);
      svg.appendChild(defs);
    }

    function buildBricks(){
      const g = el('g', {});
      for (let i = 0; i < brickCount; i++){
        const a0 = i*slot + gap/2;
        const a1 = (i+1)*slot - gap/2;
        const rIn = rPx - rowHalf, rOut = rPx + rowHalf;
        const p0 = polarPt(cx, cy, rIn, a0), p1 = polarPt(cx, cy, rIn, a1);
        const p2 = polarPt(cx, cy, rOut, a1), p3 = polarPt(cx, cy, rOut, a0);
        const d = 'M ' + p0.x + ' ' + p0.y + ' A ' + rIn + ' ' + rIn + ' 0 0 1 ' + p1.x + ' ' + p1.y +
                  ' L ' + p2.x + ' ' + p2.y + ' A ' + rOut + ' ' + rOut + ' 0 0 0 ' + p3.x + ' ' + p3.y + ' Z';
        g.appendChild(el('path', { d, fill:color }));
      }
      return g;
    }

    // Soft blurred halo underneath, low opacity so it reads as ambient
    // glow, not as the shape itself - then a crisp, unblurred brick layer
    // on top so individual blocks and the gaps between them stay readable
    // (a single blurred-and-opaque pass was smearing everything into one
    // solid ring, which is what the user flagged as not matching the game).
    const halo = buildBricks();
    halo.setAttribute('filter', 'url(#' + filterId + ')');
    halo.setAttribute('opacity', '0.55');
    svg.appendChild(halo);
    const crisp = buildBricks();
    crisp.setAttribute('opacity', '0.95');
    svg.appendChild(crisp);
  }

  function drawRing(svg, cx, cy, scale, R, angles, color, opacity, haloRadius, dotRadius){
    const g = el('g', { opacity: opacity });
    const r = Math.max(1.5, (dotRadius || 0) * scale);
    angles.forEach(a => {
      const x = cx + R*scale*Math.cos(a), y = cy + R*scale*Math.sin(a);
      if (haloRadius) g.appendChild(el('circle', { cx:x, cy:y, r:haloRadius*scale, fill:color, opacity:0.16, stroke:'none' }));
      g.appendChild(el('circle', { cx:x, cy:y, r, fill:color, stroke:'#0e1720', 'stroke-width':1 }));
    });
    svg.appendChild(g);
  }

  function niceStep(x){
    const pow = Math.pow(10, Math.floor(Math.log10(x || 1)));
    const n = x / pow;
    const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
    return step * pow;
  }

  function drawReadout(ar, bounds, wsR, wsN, cardR, cardN, combinedCov, wsAdjuster, landmarks){
    const grid = $('readoutGrid');
    grid.innerHTML = '';

    function block(cls, label, valueHtml, borderColor){
      const d = document.createElement('div');
      d.className = 'rblock ' + cls;
      if (borderColor) d.style.borderLeftColor = borderColor;
      d.innerHTML = '<div class="label">' + label + '</div><div class="value">' + valueHtml + '</div>';
      return d;
    }

    grid.appendChild(block('', 'Attack range', fmt(m(ar.capped),1) + 'm'));
    grid.appendChild(block('', 'Orbit bounds', fmt(m(computeOrbPlottedRadius(bounds.floor, ar.capped)),0) + '–' + fmt(m(computeOrbPlottedRadius(bounds.ceil, ar.capped)),0) + 'm'));

    grid.appendChild(block('brass', 'Workshop radius' + (wsAdjuster?'':' (locked)') + ' · ' + wsN + ' orbs', fmt(m(wsR),0) + 'm'));
    grid.appendChild(block('cyan', 'Card radius · ' + cardN + ' orbs', fmt(m(cardR),0) + 'm'));

    if (combinedCov){
      grid.appendChild(block('', 'Combined spacing (worst gap) · ' + (wsN+cardN) + ' orbs share one grid', fmt(m(combinedCov.spacing),0) + 'm' +
        '<span class="flag ' + (combinedCov.gapFree?'ok':'warn') + '">' + (combinedCov.gapFree ? 'no gaps' : 'gaps present') + '</span>'));
    }

    (landmarks || []).forEach(l => {
      if (l.rInternal == null || l.rInternal <= 0) return;
      grid.appendChild(block('', l.name, fmt(l.rInternal*C.DISPLAY_SCALE,0) + 'm' + (l.count != null ? ' <small>(' + l.count + ' mines)</small>' : ''), l.color));
    });
  }

  function drawLegend(landmarks){
    const l = $('legend');
    const items = [
      ['#c99a4c','solid','Workshop orbit'],
      ['#6fb8c4','solid','Card orbit'],
      ['#9aa9ad','solid','Attack range'],
      ['#5a6d78','dashed','Orbit min / max'],
    ];
    const seen = new Map();
    landmarks.filter(x=>x.rInternal).forEach(x => {
      const key = (x.color||'#c1633f') + '|' + x.name;
      if (!seen.has(key)) seen.set(key, { color: x.color||'#c1633f', name: x.name, isBrickWall: !!x.isBrickWall });
    });
    l.innerHTML = items.map(([c,style,label]) =>
      '<div class="legend-item"><span class="legend-swatch" style="border-top-color:' + c + ';border-top-style:' + style + '"></span>' + label + '</div>'
    ).join('') + [...seen.values()].map(({color,name,isBrickWall}) =>
      // Wall gets a "double" border to echo its two-row brick rendering on
      // the plot itself, instead of the generic dotted line every other
      // reference boundary uses - it's the one landmark with a real,
      // distinctive in-game look (see drawBrickWall), so the legend
      // shouldn't flatten it back into looking like an abstract stat line.
      '<div class="legend-item"><span class="legend-swatch" style="border-top-color:' + color + ';border-top-style:' + (isBrickWall?'double':'dotted') + (isBrickWall?';border-top-width:4px':'') + '"></span>' + name + '</div>'
    ).join('');
  }

  // Numeric inverse of computeOrbPlottedRadius (monotonic in appliedDistance
  // over its real domain) - needed because "touch" below has to combine a
  // raw applied-distance value (wsR) with a true-world size (C.PULSE) that
  // only has a defined meaning in *plotted* space; there's no closed-form
  // inverse of the compression curve, so bisection is the direct fix.
  function appliedDistanceForPlottedOrbRadius(targetPlotted, rawMaxDistance){
    if (targetPlotted <= 0) return 0;
    let lo = 0, hi = Math.max(rawMaxDistance * 2, 100);
    for (let i = 0; i < 40; i++){
      const mid = (lo + hi) / 2;
      if (computeOrbPlottedRadius(mid, rawMaxDistance) < targetPlotted) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- targeting presets (Card ring) ----
  function applyPreset(kind){
    const ar = computeAttackRange();
    const bounds = ringBounds(ar.capped);
    const wsAdjuster = $('wsAdjuster').checked;
    const wsStepVal = wsAdjuster ? parseInt($('wsStep').value,10) : 0;
    const wsR = wsAdjuster ? stepToRadius(wsStepVal, bounds) : bounds.floor;

    let target;
    if (kind === 'min') target = bounds.floor;
    else if (kind === 'max') target = bounds.ceil;
    else if (kind === 'touch') {
      // wsR is raw applied-distance; C.PULSE is a true world size (Sentry
      // Protocol's real mini-orb targeting radius - see
      // coverageStatsFromPlacedOrbs' comment). They only share units in
      // plotted space, so combine them there and convert the sum back to
      // raw applied-distance for the Card step slider, not the reverse.
      const wsRPlotted = computeOrbPlottedRadius(wsR, ar.capped);
      const pulsePlotted = trueWorldSizeToPlotted(C.PULSE, ar.capped);
      target = appliedDistanceForPlottedOrbRadius(wsRPlotted + 2 * pulsePlotted, ar.capped);
    }
    else if (kind === 'range') target = ar.capped;
    $('cardStep').value = radiusToStep(target, bounds);
    render();
  }

  const presetDefs = [
    ['min','Tightest (min density)'],
    ['touch','Touch Workshop orbs'],
    ['range','Snap to attack range'],
    ['max','Max reach'],
  ];
  $('presets').innerHTML = presetDefs.map(([k,label]) =>
    '<button type="button" class="preset" data-preset="' + k + '">' + label + '</button>'
  ).join('');
  $('presets').addEventListener('click', e => {
    const b = e.target.closest('button[data-preset]');
    if (b) applyPreset(b.dataset.preset);
  });

  $('snapMineBtn').addEventListener('click', () => {
    const ar = computeAttackRange();
    const bounds = ringBounds(ar.capped);
    $('cardStep').value = radiusToStep(computeMineRadius(), bounds);
    render();
  });

  // "Sync ring position" - keeps Workshop's and Card's ring-position
  // sliders locked to the same step. Both already share the same `max`
  // (set from the same `bounds.steps` in render(), see $('wsStep').max /
  // $('cardStep').max above), so copying the raw step value across is
  // always valid, no rescaling needed. Registered before the generic
  // input->render binding below so the copy happens first and the
  // subsequent render() (fired by that generic binding, on the same
  // element) already sees both sliders in sync.
  $('wsStep').addEventListener('input', () => {
    if ($('syncSteps').checked) $('cardStep').value = $('wsStep').value;
  });
  $('cardStep').addEventListener('input', () => {
    if ($('syncSteps').checked) $('wsStep').value = $('cardStep').value;
  });
  $('syncSteps').addEventListener('change', () => {
    if ($('syncSteps').checked) {
      // Snap together immediately on enabling - from whichever slider is
      // actually active (wsStep is disabled/ignored unless the Workshop
      // Orb Adjuster is owned, see wsAdjuster above).
      if (!$('wsStep').disabled) $('cardStep').value = $('wsStep').value;
      else $('wsStep').value = $('cardStep').value;
    }
    // Fires after the generic input->render binding below runs for this
    // same 'change' event's paired 'input' event (checkboxes fire both),
    // so the snap above needs its own render() to actually show up.
    render();
  });

  document.querySelectorAll('input:not(#fileInput)').forEach(inp => inp.addEventListener('input', render));

  render();
}

module.exports = { initPlotter };
