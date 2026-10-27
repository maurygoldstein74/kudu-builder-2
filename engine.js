/* KUIU Field Kit — engine.js  v2.02
 * Pure JS warmth-budget stack builder. No DOM. Runs in the browser (window.FK) and in Node (module.exports).
 * Spec: docs/SPEC-v2.00.md + docs/SPEC-v2.02-ADDENDUM.md (garment-reality matrix, phase choreography, sit-hours,
 *       round 7: the canonical ladder + temperature x wind x sit-hours lattice for coherent picks along every axis).
 * Science: ISO 11079 IREQ (required insulation), ISO 9920 (garment clo, ensemble sum, wind/permeability correction).
 * Calibration notes: docs/TUNING-NOTES.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2.02';

  /* ================================================================================================
   * 1. TUNABLES — every calibration constant lives here
   * ============================================================================================== */
  const TUNE = {
    // metabolic rate (MET) per hunt phase
    met: { deer_sit: 1.2, deer_walk: 2.5, deer_still: 2.0, deer_stop: 1.2, upland: 3.0, wf_sit: 1.3 },
    // MOVING phases: target position between ISO "minimal" (acceptable cooling) and "neutral" (no cooling): 0 = start cold
    K: { walk: 0.4, still: 0.5, stop: 0.0, upland: 0.75 },
    stopFactor: 0.88,                                        // a 20-30 min stop is dressed lighter than a sit (fraction of the stop target)
    // hunter calibration of the ISO static requirement (ISO neutral is a lab no-cooling criterion; see TUNING-NOTES)
    cal: 0.61,
    // SITS (v2.02, addendum D): comfort hours are ABSOLUTE and depend only on kit + weather —
    //   hours(S) = hoursK / (calSit x ISO-neutral - S), capped at hoursCap. The sit target is simply the warmth that
    //   gives hours >= the planned sit: R = calSit x neutral - hoursK / sitHours. Same kit + weather => same hours,
    //   a 1-hour sit allows a lighter stack, a 6-hour sit demands a warmer one. Calibrated to the reference loadouts
    //   in TUNING-NOTES (Round 6).
    //   The all-day line is a MAP from the ISO neutral static Icl (which climbs very steeply with cold + wind) to what
    //   hunters in these windproof pieces actually report (Round 6 anchors): piecewise linear, ISO -> calibrated clo.
    sitNeutralMap: [[1.5, 1.10], [2.0, 1.33], [2.4, 1.52], [2.8, 1.78], [3.5, 2.10], [4.6, 2.27], [5.4, 2.60], [6.6, 2.80], [8.2, 2.97], [10, 3.12], [14, 3.5]],   // round 7: 4.6 -> 2.27 so W6 (Proximity stack, 25F / 15 mph, all-day sits reported) reaches 3 h while the Haven kit at 4F / 20 mph stays <= 3 h
    hoursK: 0.45, hoursCap: 8,                              // hours = hoursK / deficit^2 (0.3 clo short ~ 5 h, 0.4 ~ 2.8 h, 0.6 ~ 1.25 h, 1.0 ~ 0.5 h)
    // fraction of the forecast 10 m wind that reaches the body
    windAtBody: { deer: 0.5, deer_still: 0.5, upland: 0.9, wf_marsh: 0.7, wf_dry: 0.9 },   // marsh blinds/brush give some shelter; dry field / pass shooting is open
    // outer-layer wind rating -> air permeability (l/m2s) for the ISO 9920 correction
    perm: { 0: 1000, 1: 8, 2: 1 },
    seated: 0.90,                                            // ISO 9920 seated compression of the ensemble
    compress: { down: 0.90, syn: 0.95, fleece: 1.0, merino: 1.0, none: 1.0 },  // puffy under a SNUG shell / SNUG puffy over a soft shell
    wetNoShell: { down: 0.3, syn: 0.55, fleece: 0.6, merino: 0.7, none: 1 },  // soaked, no membrane over it
    comboWetWiden: 4,
    rainSwapMinClo: 0.5,                                     // rain walk-in: an insulated piece worn UNDER the shell (>= this clo) is carried, swapped in at the stand; a fleece is never swapped                                        // the insulated rain pieces (Gale Force) reach 6 degF warmer when it is wet
    insulCapOver: 2,                                         // sits: an insulated outer-fit piece is never worn more than this above its tmax (no puffy at 52)
    insulSitMaxF: 46,                                        // ...and never at all on a sit above this dressed temp (round 7: the Proximity is not a 47-degree jacket)
    moveShellWindMin: 10,                                    // moving phases (still-hunt, upland, walk-in), DRY: a plain rain shell is the outer only at/above this wind at the body
    sitSoftshellOptAboveF: 58, sitSoftshellOptWind: 8,      // dry sits above this temp: a soft shell is worn only in real wind (same line as softshellWindMin), otherwise offered as optional
    bareHandsSitF: 66,                                       // sits: bare hands at/above this wind chill (gloves at 68 on a bow sit are a nit)
    softshellWindAboveF: 66,                                 // dry sit between this and noOuterAboveF: a soft shell only when wind at the body >= softshellWindMin
    softshellWindMin: 8,
    fleeceOuterWindSit: 8, fleeceOuterWindMove: 15,            // a knit fleece as the outermost piece: only up to this wind at the body (sitting / walking)
    wetTooWarmF: 75,                                         // above this, rain is just taken — no shell forced
    wetProb: 40, wetIn: 0.02,                                // what counts as "wet" (precip prob % / inches)
    windyGust: 20, windyWind: 15,                            // what counts as "windy" (forecast mph)
    legShare: 0.18,                                          // legs clo >= legShare x (torso + legs) clo (a floor only — the leg priors do the real balancing)
    torsoShare: 0.5, torsoShareMinLegs: 0.7,                // legs stack >= 0.7 clo (bib / over-pant) => torso must be >= 50% of torso+legs (no 'heating the legs to cover the core')
    sumA: 0.835, sumB: 0.161,                                // ISO 9920 ensemble: Icl = A * sum(Iclu) + B
    sunC: { 0: 0, 1: 4, 2: 8 },                              // sky -> degC added to the radiant temperature
    dressOffset: { sit: 0, walk: 12, still: 10, upland: 14 },// eligibility-window shift by activity (deg F)
    optWiden: 6,                                             // eligibility widening for alternates (deg F)
    altMargin: 1.3,                                          // cost margin for an alternate to be shown
    peelSlack: 0.3,                                          // walk-in sub-stack may exceed its target by this much
    // eligibility is soft: a piece outside its tmin-tmax window pays cost.outOfBand per degF of distance (so a piece 4 deg
    // out beats one 8 deg out), with two hard limits: a warm-weather piece (tmin more than oobWarmIn above the dressed
    // temp) is never pulled into a cold stack, and a piece more than oobColdIn below its tmax is left out of the enumeration.
    // A last-resort pass with every window open runs only when nothing legal exists at all (trip mode).
    oobWarmIn: 20, oobColdIn: 25,
    // SMOOTH cost (round 3): there is no "must meet the target" gate any more — a shortfall above deficitTol is simply
    // expensive (12/clo), overshoot is cheap (1/clo), so a quiet stack a hair short beats a loud one a hair over, and
    // neighbouring temperatures choose neighbouring stacks instead of flipping on 0.05-clo differences.
    cost: { deficit: 12, overshoot: 1.0, overshootMild: 2.5, overshootMildF: 50,   // overshoot is priced 2.5x on days of 50F+ (a puffy over a shirt at 52 is not "safe", it is sweaty)
      layer: 0.35, loud: 0.2, weight: 0.2, carryWeight: 0.6, specialist: 0.25, outOfBand: 0.2, outOfBandCold: 0.08, outOfBandSq: 0.04, snug: 0.6,
      basePrior: 4.0,        // per 0.1 clo the base layer deviates from the expected base warmth for the dressed temp (see basePrior below)
      legsBasePrior: 2.0,    // same for the base bottom and the pant (legsBasePrior / pantPrior tables)
      stability: 3.0,        // per piece worn 1 degF warmer that this stack DROPS (coherence: colder = add or swap warmer, never drop)
      stabilityCap: 1.0,     // ...but the lighter-swap term can never outweigh a real cost gap bigger than this (addendum E: families may change when a windproof outer starts paying for itself)
      dropBelowRef: 12,      // per clo this stack is COLDER than the pick 2 degF warmer (monotonic warmth)
      lighterSwap: 1.0,      // per role swapped for a LIGHTER piece than the 2-degF-warmer stack wore
      shellNoInsul: 3.0,     // HD Flex (sized over a puffy) worn in RAIN with nothing insulated under it (the Kutana is the plain rain shell); dry it is simply not allowed
      downWetUnderShell: 1.0,// down (Super Down PRO) under a rain shell in rain / sleet: the synthetic Proximity or the Gale Force is preferred unless nothing else reaches the target
      noOuterCold: 2.0,      // moving phase with wind chill below moveOuterBelowF and no outer at all
      stopStability: 1.5,    // still-hunt: changing the carried stop piece from the one chosen 1 degF warmer (hysteresis; waived when that piece now runs short)
      shortSwitch: 1.5 },    // a not-short outfit within this much cost of the cheapest is taken instead (v2.02: hours are the
                             // planned sit's own measure, so dressing to reach them is the point; beyond it the `warmer` option is named)
    // expected base-layer warmth by dressed degF (piecewise linear): a tee in the heat, a 200-weight through the 40s-50s,
    // the insulated Vital PRO below the high 30s. Keeps the base from flip-flopping as other layers do the work.
    basePrior: [[60, 0.12], [55, 0.16], [50, 0.22], [47, 0.22], [43, 0.25], [36, 0.32]],   // tee -> light LS -> stand shirt / 200 merino -> insulated base
    legsBasePrior: [[52, 0], [48, 0.17], [38, 0.17], [34, 0.28]],
    pantPriorWetShift: 12,   // degF: on a wet day the pant prior reads colder (sleet / wet snow at 36 -> the insulated waterproof bib, not a rain pant over the soft-shell pant; round 7)
    legsBaseMoveShift: 10,   // degF: on moving phases the base-bottom prior is read this much warmer (fleece btm < 38 dressF, Vital btm < 24)
    pantPrior: [[70, 0.15], [62, 0.24], [46, 0.24], [40, 0.32], [30, 0.32], [24, 0.55]],      // Tiburon -> Attack -> Encounter -> Gale Force pant in the frigid band (v2.01; a forced pant, e.g. Pro Brush, is exempt)
    noOuterAboveF: 74,                                       // a DRY sit this warm wears no outer at all, however it blows (the ISO wind term over-asks at 75F)
    noSoftshellAboveF: 74,                                   // ...no soft shell above this either; between softshellWindAboveF and here only in real wind
    comboDryMaxF: 32,                                        // the Gale Force jacket is worn on a DRY sit only at/below this (it is the wet/frigid outer)
    moveOuterBelowF: 30,                                     // moving phases: below this wind chill an outer is required, not optional
    walkBareBaseBelowF: 45,                                  // walk-in: below this dressed temp the base is never walked in bare (fleece mid on, zips open)
    stopMinHours: 1, stopNeverShortF: 50,                    // a stop is 20-30 min: only "short" when under an hour, never at 50F+
    warmerMinGain: 0.10,                                     // a "would get you the full sit" alternative must supply at least this much more clo (no rounding artefacts)
    neverShortAboveF: 58,                                    // a sit this warm is never "short" (the ISO wind term over-asks in a mild breeze); the cost still adds a layer when it helps
    loudWeight: { deer: 1, waterfowl: 1, upland: 0.1 },      // fabric noise matters at bow range, not to a flushing bird
    loudSit: 1.5,                                            // ...and most of all on a deer stand (cost.loud x 1.5 = 0.30 on deer sit phases)
    shortTol: 0.03,                                          // (moving phases) within 3% of target counts as met
    deficitTol: 0.15,                                        // a shortfall this small (clo) is noise on moving phases / stops
    optOvershoot: { default: 0.4, upland: 0.55 },            // an optional outer is offered if it keeps the overshoot under this (clo)
    extremityMoveOffset: 6,                                  // walking warms hands/head: wind-chill ladder shifts this much (deg F) on moving phases
    sitBootHeavyBelowF: 45,                                  // sits: the tall neoprene boot below this wind chill, the ankle boot above
    wctBlendF: 55                                            // NWS wind chill applies at/below 50F; between 50 and this it is blended toward the air temp (no cliff)
  };

  /* ================================================================================================
   * 2. CATALOG — the owned closet, single source of truth (spec section 2)
   *    clo = whole-body contribution (ISO 9920 Iclu style).  tmin/tmax = eligibility window in dressed degF.
   * ============================================================================================== */
  const ALL = ['deer', 'upland', 'waterfowl'];
  const T = (o) => Object.assign({ slot: 'torso', fit: 'skin', relaxed: false, wind: 0, wp: 0, quiet: 7, ins: 'none', active: true,
    combo: false, terminal: false, overInsul: false, disc: ALL, pattern: 'Valo', w: 0 }, o);
  const CATALOG = [
    // ---- torso ----
    T({ id: 'merino120_ss', name: '120 Merino SS', cat: 'base', pos: ['base'], clo: 0.09, quiet: 9, ins: 'merino', tmin: 58, tmax: 110, pattern: 'Universal', w: 0.13 }),
    T({ id: 'merino120_ls', name: '120 Merino LS', cat: 'base', pos: ['base'], clo: 0.16, quiet: 9, ins: 'merino', tmin: 45, tmax: 90, pattern: 'Universal', w: 0.16 }),
    T({ id: 'peloton118', name: 'Peloton 118', cat: 'base', pos: ['base'], clo: 0.14, quiet: 8, ins: 'syn', tmin: 48, tmax: 85, pattern: 'Universal', w: 0.18 }),
    T({ id: 'tiburon_snap', name: 'Tiburon Snap Shirt', cat: 'shirt', pos: ['base'], relaxed: true, clo: 0.07, quiet: 7, ins: 'syn', tmin: 62, tmax: 110, w: 0.20 }),   // relaxed woven snap shirt (KUIU 'loose fitting')
    T({ id: 'encounter_lt', name: 'Encounter LT shirt', cat: 'shirt', pos: ['base'], relaxed: true, clo: 0.22, quiet: 10, ins: 'syn', active: false, tmin: 44, tmax: 70, disc: ['deer', 'upland'], w: 0.45 }),   // relaxed collared stand shirt
    T({ id: 'upland_shirt', name: 'Upland shirt', cat: 'shirt', pos: ['base'], relaxed: true, clo: 0.12, wind: 0, wp: 1, quiet: 5, ins: 'syn', tmin: 50, tmax: 90, disc: ['upland'], w: 0.32 }),   // KUIU 'Mild': a thin woven shirt, not a cold-walk base
    T({ id: 'promerino200', name: 'Pro Merino 200 Zip-T', cat: 'base', pos: ['base'], clo: 0.24, wind: 1, quiet: 8, ins: 'merino', tmin: -10, tmax: 60, pattern: 'Universal', w: 0.30 }),   // owners shed it around 60
    T({ id: 'vitalpro_top', name: 'Vital PRO top', cat: 'base', pos: ['base'], clo: 0.32, quiet: 8, ins: 'syn', active: false, tmin: -20, tmax: 42, pattern: 'Universal', w: 0.37 }),   // worn alone on 30-40 mornings
    T({ id: 'peloton200', name: 'Peloton 200 Zip-T', cat: 'mid', pos: ['mid', 'outer'], fit: 'mid', clo: 0.30, quiet: 9, ins: 'fleece', tmin: -10, tmax: 62, w: 0.29 }),
    T({ id: 'rubicon', name: 'Rubicon jacket', cat: 'softshell', pos: ['outer'], fit: 'outer', clo: 0.35, wind: 1, wp: 1, quiet: 7, ins: 'fleece', tmin: 34, tmax: 72, w: 0.52 }),   // the light wind layer for a breezy mild sit
    T({ id: 'guide_dcs', name: 'Guide DCS jacket', cat: 'softshell', pos: ['outer'], fit: 'outer', clo: 0.42, wind: 1, wp: 1, quiet: 5, ins: 'fleece', tmin: 28, tmax: 62, w: 0.68 }),
    T({ id: 'axis_hybrid', name: 'Axis Hybrid Hooded jacket', cat: 'softshell', pos: ['outer'], fit: 'outer', clo: 0.45, wind: 1, wp: 1, quiet: 6, ins: 'fleece', tmin: 22, tmax: 58, w: 0.69 }),
    T({ id: 'proximity_jacket', name: 'Proximity jacket', cat: 'insulation', pos: ['insul', 'outer'], fit: 'outer', clo: 0.60, wind: 2, wp: 1, quiet: 10, ins: 'syn', active: false, tmin: -5, tmax: 46, w: 0.91 }),
    T({ id: 'superdown_pro', name: 'Super Down PRO jacket', cat: 'insulation', pos: ['insul', 'outer'], fit: 'outer', clo: 0.70, wind: 1, wp: 1, quiet: 6, ins: 'down', active: false, tmin: -15, tmax: 40, disc: ['deer', 'waterfowl'], w: 0.42 }),
    T({ id: 'haven', name: 'Super Down Haven jacket', cat: 'insulation', pos: ['outer'], fit: 'outer', clo: 1.05, wind: 2, wp: 1, quiet: 10, ins: 'down', active: false, terminal: true, tmin: -25, tmax: 34, disc: ['deer', 'waterfowl'], w: 1.13 }),   // tmax 34: owners sweat out above the mid-30s; the Super Down PRO owns 34-40 dry
    T({ id: 'kutana_jacket', name: 'Kutana Storm Shell jacket', cat: 'shell', pos: ['outer'], fit: 'outer', clo: 0.22, wind: 2, wp: 2, quiet: 4, ins: 'none', tmin: -20, tmax: 75, w: 0.57 }),
    T({ id: 'hdflex_jacket', name: 'HD Flex Storm Shell', cat: 'shell', pos: ['outer'], fit: 'outer', clo: 0.28, wind: 2, wp: 2, quiet: 3, ins: 'none', active: false, overInsul: true, tmin: -20, tmax: 58, w: 1.06 }),
    T({ id: 'galeforce_jacket', name: 'Kutana Gale Force jacket', cat: 'shell', pos: ['outer'], fit: 'outer', clo: 0.85, wind: 2, wp: 2, quiet: 4, ins: 'syn', combo: true, tmin: -25, tmax: 42, wetWiden: 0, disc: ['deer', 'waterfowl'], w: 1.24 }),   // Frigid piece: no wet widening (manager decision, round 7) — 45 deg rain sits are fleece + Kutana
    // ---- legs ----
    T({ id: 'tiburon_pant', name: 'Tiburon pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.15, quiet: 6, ins: 'syn', tmin: 58, tmax: 110, w: 0.35 }),
    T({ id: 'attack_pant', name: 'Attack pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.24, wind: 1, wp: 1, quiet: 5, ins: 'syn', tmin: 38, tmax: 76, w: 0.52 }),
    T({ id: 'probrush_pant', name: 'Pro Brush pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.27, wind: 1, wp: 1, quiet: 4, ins: 'syn', tmin: 30, tmax: 74, disc: ['upland'], w: 0.56 }),
    T({ id: 'encounter_pant', name: 'Encounter pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.32, wind: 1, wp: 1, quiet: 10, ins: 'fleece', tmin: 20, tmax: 62, disc: ['deer', 'waterfowl'], w: 0.74 }),   // alone to ~40, with a base bottom to the low 30s, under a bib colder (stand pant; 'active' only means it walks)
    T({ id: 'galeforce_pant', name: 'Kutana Gale Force pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.55, wind: 2, wp: 2, quiet: 4, ins: 'syn', combo: true, active: false, tmin: -25, tmax: 40, disc: ['deer', 'waterfowl'], w: 1.0 }),   // over a base bottom ONLY (KUIU); +comboWetWiden when wet
    T({ id: 'kutana_pant', name: 'Kutana Storm Shell pant', cat: 'pant', slot: 'legs', pos: ['overpant'], clo: 0.17, wind: 2, wp: 2, quiet: 4, ins: 'none', tmin: -20, tmax: 72, w: 0.49 }),
    T({ id: 'encounter_fleece_btm', name: 'Encounter 200 Fleece Bottom', cat: 'base', slot: 'legs', pos: ['base'], clo: 0.17, quiet: 9, ins: 'fleece', tmin: -10, tmax: 48, pattern: 'Universal', w: 0.21 }),
    T({ id: 'vitalpro_btm', name: 'Vital PRO bottoms', cat: 'base', slot: 'legs', pos: ['base'], clo: 0.28, quiet: 8, ins: 'syn', active: false, tmin: -25, tmax: 36, pattern: 'Universal', w: 0.33 }),
    T({ id: 'wader_hdflex', name: 'PRO HD Flex Zip Wader', cat: 'wader', slot: 'wader', pos: ['wader'], clo: 0.50, wind: 2, wp: 2, quiet: 3, ins: 'none', tmin: -20, tmax: 75, disc: ['waterfowl'], w: 3.3 }),   // uninsulated laminate body (0.35) + 7 mm neoprene boot-foot (0.15): it covers legs AND feet, the warmth is what goes under it
    // ---- head / neck / hands / feet / sock / vest ----
    T({ id: 'prohat_valo', name: 'Pro Hat - Valo', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.02, quiet: 8, tmin: 42, tmax: 120 }),
    T({ id: 'prohat_orange', name: 'Pro Hat - Orange', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.02, quiet: 8, tmin: 42, tmax: 120, disc: ['deer'], pattern: 'Blaze' }),
    T({ id: 'kenai_beanie', name: 'Kenai beanie', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.06, wind: 2, wp: 1, quiet: 9, ins: 'syn', tmin: -25, tmax: 24 }),   // KUIU's warmest beanie (120 g 3DeFX+ + sherpa, tested to -22): the frigid-sit beanie; the quieter Proximity beanie owns 25-42
    T({ id: 'proximity_beanie', name: 'Proximity beanie', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.05, wind: 2, wp: 1, quiet: 10, ins: 'syn', tmin: -25, tmax: 42 }),
    T({ id: 'proximity_gaiter', name: 'Proximity neck gaiter', cat: 'accessory', slot: 'neck', pos: ['neck'], clo: 0.03, wind: 2, wp: 1, quiet: 10, ins: 'fleece', tmin: -25, tmax: 50 }),
    T({ id: 'precision_glove', name: 'Precision glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.03, wind: 1, quiet: 7, tmin: 44, tmax: 75 }),   // the shooting glove for every discipline
    T({ id: 'yukon_glove', name: 'Yukon glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.06, wind: 2, wp: 2, quiet: 6, ins: 'syn', tmin: 30, tmax: 48 }),
    T({ id: 'kenai_glove', name: 'Kenai glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.06, wind: 2, wp: 1, quiet: 7, ins: 'syn', tmin: 20, tmax: 45 }),
    T({ id: 'northstar_glove', name: 'Northstar glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.10, wind: 2, wp: 2, quiet: 6, ins: 'syn', tmin: 5, tmax: 35 }),   // owners: hand warmers / a muff below ~20 sitting
    T({ id: 'merino_sock', name: 'ULTRA Merino Crew Sock', cat: 'boots', slot: 'sock', pos: ['sock'], clo: 0.03, quiet: 9, ins: 'merino', tmin: -40, tmax: 120, pattern: 'Universal' }),
    T({ id: 'ankle_mud', name: 'Ankle Mud Boot', cat: 'boots', slot: 'feet', pos: ['feet'], clo: 0.14, wind: 2, wp: 2, quiet: 6, tmin: 35, tmax: 68 }),
    T({ id: 'danner', name: 'Danner lace-up boots', cat: 'boots', slot: 'feet', pos: ['feet'], clo: 0.12, wind: 1, wp: 1, quiet: 6, tmin: 20, tmax: 85, pattern: 'Solid' }),
    T({ id: 'hd_mud', name: 'HD Mud Boot', cat: 'boots', slot: 'feet', pos: ['feet'], clo: 0.25, wind: 2, wp: 2, quiet: 6, ins: 'syn', active: false, tmin: 15, tmax: 65, disc: ['deer', 'waterfowl'] }),   // KUIU: stand comfort ~70 to 15; below that it is a pac-boot / heated-sock job
    T({ id: 'blaze_vest', name: 'Blaze Orange Vest', cat: 'accessory', slot: 'vest', pos: ['vest'], clo: 0.05, wp: 1, quiet: 7, tmin: -40, tmax: 120, disc: ['deer'], pattern: 'Blaze' }),
    T({ id: 'upland_vest', name: 'Upland Field Vest', cat: 'accessory', slot: 'vest', pos: ['vest'], clo: 0.10, wind: 1, wp: 1, quiet: 4, tmin: -40, tmax: 120, disc: ['upland'] })
  ];

  /* ================================================================================================
   * 3. PHYSICS — required insulation, comfort hours, wind chill
   * ============================================================================================== */
  // ISO 11079 IREQ closed-form approximation + ISO 9920 dynamic/static correction (see test/simple.js, test/ireq.js)
  function requiredClo(o) {
    const met = o.met == null ? 1.2 : o.met, windMph = o.windMph || 0, perm = o.perm || 8, sunC = o.sunC || 0;
    const M = Math.min(400, Math.max(58, 58.15 * met));
    const ta = (o.tempF - 32) / 1.8;
    const v = Math.max(0.4, windMph * 0.447);
    const w = Math.min(1.2, o.walkMs != null ? o.walkMs : 0.0052 * (M - 58));
    const Ia = 0.092 * Math.exp(-0.15 * v - 0.22 * w) - 0.0045;
    const hr = 4.5, hc = 1 / Ia - hr;
    const taEff = ta + sunC * hr / (hr + hc);
    const minimal = o.variant === 'minimal';
    const Tsk = minimal ? 33.34 - 0.0354 * M : 35.7 - 0.0285 * M;
    const Hdry = minimal ? M * (0.93 - 0.0004 * M) : M * (0.88 - 0.0004 * M);
    let ireq = (Tsk - taEff) / Hdry;
    for (let i = 0; i < 3; i++) ireq = (Tsk - taEff) / Hdry - Ia / (1 + 1.197 * ireq);
    ireq = Math.max(0, ireq);
    const fcl = 1 + 1.197 * ireq;
    const CF = 0.54 * Math.exp(-0.15 * v - 0.22 * w) * Math.pow(perm, 0.075) - 0.06 * Math.log(perm) + 0.5;
    const iclStatic = Math.max(0, ((ireq + Ia / fcl) / CF - 0.085 / fcl) / 0.155);
    return { ireqClo: ireq / 0.155, iclStaticClo: iclStatic, CF: CF, Hdry: Hdry, Tsk: Tsk, Ia: Ia, ta: ta };
  }
  // calibrated target for a MOVING phase / stop, in the static domain, for a given outer-layer permeability
  function targetClo(p) {
    const neu = requiredClo({ tempF: p.tempF, windMph: p.windMph, met: p.met, perm: p.perm, sunC: p.sunC });
    const min = requiredClo({ tempF: p.tempF, windMph: p.windMph, met: p.met, perm: p.perm, sunC: p.sunC, variant: 'minimal' });
    const raw = min.iclStaticClo + p.K * (neu.iclStaticClo - min.iclStaticClo);
    return { target: raw * TUNE.cal * (p.factor || 1), raw: raw, neu: neu, min: min };
  }
  // SIT model (addendum D): the calibrated ISO-neutral static insulation is the "all day" line; the hours a stack is
  // comfortable is an absolute heat-debt time below that line, and the sit TARGET is the warmth that gives the planned
  // hours. One formula, three uses: target, hours, short.
  function lerpAsc(tab, x) {
    if (x <= tab[0][0]) return tab[0][1] * (x / tab[0][0]);
    for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const f = (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]); return tab[i - 1][1] + f * (tab[i][1] - tab[i - 1][1]); }
    const n = tab.length - 1; return tab[n][1] + (x - tab[n][0]) * (tab[n][1] - tab[n - 1][1]) / (tab[n][0] - tab[n - 1][0]);
  }
  function sitNeutral(p) {
    const neu = requiredClo({ tempF: p.tempF, windMph: p.windMph, met: p.met, perm: p.perm, sunC: p.sunC });
    return { neutral: lerpAsc(TUNE.sitNeutralMap, neu.iclStaticClo), neu: neu };
  }
  // the sit target: the warmth whose comfort hours equal the planned sit
  function sitTarget(neutralCal, sitHours) { return neutralCal - Math.sqrt(TUNE.hoursK / Math.max(0.5, sitHours || 3)); }
  // comfortable hours for a stack: hoursK / deficit^2 (a small shortfall is a long slow cool-down, a big one is not), capped
  function hoursRaw(supplied, neutralCal, cap) {
    const c = cap || TUNE.hoursCap, deficit = neutralCal - supplied;
    if (deficit <= 0) return c;
    return Math.min(c, TUNE.hoursK / (deficit * deficit));
  }
  function hoursOfComfort(supplied, neutralCal, cap) { return Math.max(0.5, Math.round(hoursRaw(supplied, neutralCal, cap) * 2) / 2); }
  function met(supplied, target) { return target - supplied <= TUNE.deficitTol || supplied >= target * (1 - TUNE.shortTol); }
  // plain-language hours: "about 2 h", "about 1.5 h", "under an hour"
  function fmtHours(h) { if (h == null) return ''; if (h < 1) return 'under an hour'; const r = Math.round(h * 2) / 2; return 'about ' + (r % 1 ? r.toFixed(1) : r) + ' h'; }
  // NWS wind chill (deg F); identity above wctBlendF, blended toward the air temp between 50 and wctBlendF (no cliff at 50)
  function windChill(tempF, windMph) {
    if (tempF > TUNE.wctBlendF || windMph < 3) return tempF;
    const v = Math.pow(windMph, 0.16);
    const nws = 35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v;
    if (tempF <= 50) return Math.round(nws);
    const w = (TUNE.wctBlendF - tempF) / (TUNE.wctBlendF - 50);
    return Math.round(tempF + w * Math.min(0, nws - tempF));
  }

  /* ================================================================================================
   * 4. CATALOG HELPERS — custom items, overrides, clo estimation
   * ============================================================================================== */
  function slug(s) { return 'c_' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  function num(v) { v = Number(v); return isFinite(v) ? v : null; }

  // whole-body clo estimate for a researched/custom piece (spec section 6)
  function estimateClo(it) {
    const slot = it.slot, ins = it.ins || 'none', gsm = num(it.fabric_gsm), igsm = num(it.insulation_gsm), oz = num(it.fill_oz);
    const hood = /hood/i.test(it.name || '') ? 0.05 : 0;
    const vest = /vest/i.test(it.name || '') && slot === 'torso';
    let c;
    if (slot === 'torso') {
      const posStr = (it.pos || []).join(',');
      if (ins === 'down') c = Math.min(1.5, 0.25 + 0.09 * (oz || 3)) + hood;
      // synthetic insulation: an insulated jacket with no published g/m2 is treated as 100 g (never as a softshell)
      else if (ins === 'syn' && (igsm || it.cat === 'insulation' || /insul/.test(posStr) || /insul|puff/i.test(it.name || ''))) { const g = igsm || 100; c = (g <= 60 ? 0.42 : g <= 100 ? 0.58 : g <= 133 ? 0.70 : 0.90) + hood; if (it.wp === 2) c = Math.max(c, 0.85); }
      else if (ins === 'fleece') c = /outer/.test(posStr) && it.fit === 'outer' ? 0.42 : (gsm == null ? 0.30 : gsm < 150 ? 0.22 : gsm < 260 ? 0.30 : 0.38);
      else if (/outer/.test(posStr) || it.fit === 'outer') c = it.wp === 2 ? 0.22 : 0.28;
      else c = gsm == null ? 0.16 : gsm <= 150 ? (/\bss\b|short/i.test(it.name || '') ? 0.09 : 0.16) : gsm < 300 ? 0.24 : 0.32;
      if (vest) c *= 0.55;
    } else if (slot === 'legs') {
      const posStr = (it.pos || []).join(',');
      if (/base/.test(posStr)) c = ins === 'syn' && igsm ? 0.28 : (gsm != null && gsm < 170 ? 0.12 : 0.17);
      else if (/overpant/.test(posStr)) c = 0.17;
      else if (it.wp === 2 && (igsm || ins === 'syn' || ins === 'down')) c = 0.55;
      else if (ins === 'fleece' || (gsm != null && gsm >= 280)) c = 0.30;
      else c = gsm != null && gsm < 180 ? 0.15 : 0.26;
    } else if (slot === 'wader') c = /neoprene/i.test(it.name || '') ? 0.65 : 0.45;
    else if (slot === 'head') c = ins === 'none' ? 0.02 : 0.05;
    else if (slot === 'neck') c = 0.03;
    else if (slot === 'hands') c = ins === 'none' ? 0.03 : (igsm && igsm >= 200 ? 0.10 : 0.06);
    else if (slot === 'feet') c = /neoprene|mud|pac/i.test(it.name || '') ? (/ankle/i.test(it.name || '') ? 0.14 : 0.25) : 0.12;
    else if (slot === 'sock') c = 0.03;
    else if (slot === 'vest') c = 0.05;
    else c = 0.05;
    return Math.round(c * 100) / 100;
  }

  // map a v1.84-style custom item (name, cat, tmin, tmax, disc, pattern, q, w, wp, ...) or a v2 research result to the schema
  function normalizeCustom(raw) {
    const name = String(raw.name || '').trim(); if (!name) return null;
    const cat = String(raw.cat || 'shirt').toLowerCase();
    const n = name.toLowerCase();
    let slot = raw.slot, pos = raw.pos, fit = raw.fit;
    const relaxed = !!raw.relaxed || /relaxed|loose/i.test(String(raw.fit || '')) || (cat === 'shirt' && /snap|button|sporter/.test(n));
    if (fit && /relaxed|loose/i.test(String(fit))) fit = 'skin';
    if (!slot) {
      if (cat === 'base') { if (/bottom|pant|legging|tight/.test(n)) { slot = 'legs'; pos = ['base']; } else { slot = 'torso'; pos = ['base']; } }
      else if (cat === 'shirt') { slot = 'torso'; pos = ['base']; }
      else if (cat === 'mid') { slot = 'torso'; pos = ['mid']; fit = fit || 'mid'; }
      else if (cat === 'insulation') { slot = 'torso'; pos = (fit === 'mid') ? ['insul'] : ['insul', 'outer']; fit = fit || 'outer'; }
      else if (cat === 'softshell' || cat === 'shell') { slot = 'torso'; pos = ['outer']; fit = 'outer'; }
      else if (cat === 'pant') { slot = 'legs'; pos = /rain|storm|shell/.test(n) && !/insul/.test(n) ? ['overpant'] : ['pant']; }
      else if (cat === 'wader') { slot = 'wader'; pos = ['wader']; }
      else if (cat === 'headwear') { slot = 'head'; pos = ['head']; }
      else if (cat === 'gloves') { slot = 'hands'; pos = ['hands']; }
      else if (cat === 'boots') { if (/sock/.test(n)) { slot = 'sock'; pos = ['sock']; } else { slot = 'feet'; pos = ['feet']; } }
      else if (cat === 'accessory') { if (/gaiter|balaclava|neck/.test(n)) { slot = 'neck'; pos = ['neck']; } else if (/vest/.test(n)) { slot = 'vest'; pos = ['vest']; } else { slot = null; } }
      else { slot = 'torso'; pos = ['base']; }
    }
    if (!pos) pos = [slot];
    if (!fit) fit = (slot === 'torso') ? (pos.indexOf('outer') >= 0 || pos.indexOf('insul') >= 0 ? 'outer' : pos.indexOf('mid') >= 0 ? 'mid' : 'skin') : 'skin';
    let ins = raw.ins || raw.insulation_type;
    if (!ins) {
      if (/down/.test(n)) ins = 'down';
      else if (/fleece|peloton|strongfleece/.test(n)) ins = 'fleece';
      else if (/merino|wool/.test(n)) ins = 'merino';
      else if (cat === 'insulation' || /insulated|primaloft|3defx|puff/.test(n)) ins = 'syn';
      else ins = 'none';
    }
    ins = ({ down: 'down', synthetic: 'syn', syn: 'syn', fleece: 'fleece', merino: 'merino', wool: 'merino', none: 'none' })[String(ins).toLowerCase()] || 'none';
    const wp = raw.wp === true || raw.wp === 2 || raw.membrane === true ? 2 : (raw.wp === 1 || raw.w || raw.dwr || /dwr|resist/.test(String(raw.water || '')) ? 1 : 0);
    const wind = raw.wind != null ? Number(raw.wind) : (wp === 2 || raw.windproof === true ? 2 : (raw.w ? 1 : 0));
    const quiet = raw.quiet != null ? Number(raw.quiet) : (raw.quiet_1_10 != null ? Number(raw.quiet_1_10) : (raw.q ? 9 : 5));
    const it = {
      id: raw.id || slug(name), name: name, cat: cat, slot: slot, pos: pos, fit: fit, relaxed: relaxed && slot === 'torso',
      wind: Math.max(0, Math.min(2, wind || 0)), wp: wp, quiet: Math.max(1, Math.min(10, quiet || 5)), ins: ins,
      active: raw.active != null ? !!raw.active : !(ins === 'down' || (ins === 'syn' && (cat === 'insulation' || pos.indexOf('insul') >= 0))),
      combo: !!raw.combo || (wp === 2 && (ins === 'syn' || ins === 'down') && slot === 'torso'),
      terminal: !!raw.terminal, overInsul: !!raw.overInsul,
      tmin: num(raw.tmin), tmax: num(raw.tmax),
      disc: Array.isArray(raw.disc) && raw.disc.length ? raw.disc.slice() : ALL.slice(),
      pattern: raw.pattern || 'Valo', url: raw.url || null, note: raw.note || null,
      fabric_gsm: num(raw.fabric_gsm), insulation_gsm: num(raw.insulation_gsm), fill_oz: num(raw.fill_oz),
      w: num(raw.weight_oz) != null ? num(raw.weight_oz) * 0.02835 : 0, custom: true
    };
    if (it.combo && slot === 'torso') { it.pos = ['outer']; it.fit = 'outer'; }
    if (it.tmin == null || it.tmax == null) { it.tmin = it.tmin == null ? -40 : it.tmin; it.tmax = it.tmax == null ? 120 : it.tmax; }
    it.clo = num(raw.clo) != null ? num(raw.clo) : estimateClo(it);
    return it;
  }

  // build the working gear list: built-ins minus removed, overrides applied (by display name), plus customs
  function applyOverrides(catalog, overridesByName, removedNames, customItems) {
    const removed = new Set(removedNames || []), ov = overridesByName || {};
    const out = [];
    (catalog || CATALOG).forEach(function (c) {
      if (removed.has(c.name)) return;
      const it = Object.assign({}, c, { custom: false });
      const o = ov[c.name];
      if (o) {
        if (num(o.tmin) != null) it.tmin = num(o.tmin);
        if (num(o.tmax) != null) it.tmax = num(o.tmax);
        if (typeof o.pattern === 'string') it.pattern = o.pattern;
        if (typeof o.url === 'string' && o.url.trim()) it.url = o.url.trim();
        it.edited = true;
      }
      out.push(it);
    });
    (customItems || []).forEach(function (raw) {
      if (!raw || removed.has(raw.name)) return;
      const it = raw.slot && raw.clo != null ? Object.assign({}, raw, { custom: true }) : normalizeCustom(raw);
      if (!it || !it.slot) return;
      const o = ov[it.name];
      if (o) { if (num(o.tmin) != null) it.tmin = num(o.tmin); if (num(o.tmax) != null) it.tmax = num(o.tmax); if (typeof o.pattern === 'string') it.pattern = o.pattern; if (typeof o.url === 'string' && o.url.trim()) it.url = o.url.trim(); it.edited = true; }
      out.push(it);
    });
    return out;
  }

  /* ================================================================================================
   * 5. ENGINE — phases, enumeration, scoring
   * ============================================================================================== */
  const FIT = { skin: 0, mid: 1, outer: 2 };
  // 'shell' = the moving outer kept on UNDER the carried stop layer (still-hunt stops). Its item carries `tag`:
  // 'SHELL' for a plain rain shell, 'MID' for a soft shell / fleece — the app renders item.tag over ROLE_LABEL when present.
  const ROLE_LABEL = { base: 'BASE', mid: 'MID', insul: 'INSUL', shell: 'SHELL', outer: 'OUTER', pant: 'PANT', overpant: 'OVER', wader: 'WADER' };
  const ROLE_ORDER = { base: 0, mid: 1, insul: 2, shell: 2.5, outer: 3 };
  const HARNESS_PORT = { proximity_jacket: true, haven: true };   // the only jackets with a treestand harness port (KUIU)

  function pick(it, role, why, extra) { return Object.assign({ id: it.id, name: it.name, role: role, fit: it.fit, why: why || '', alt: [] }, extra || {}); }
  function label(txt, why) { return { id: null, name: txt, role: 'label', why: why || '', alt: [], label: true }; }

  /* ---------- GARMENT-REALITY MATRIX (addendum A) ----------
   * KUIU's layering rules: outer-fit over mid-fit; base + fleece mid + mid-fit insulated + outer-fit shell stack in one
   * size; never two outer-fit jackets in the same size (a shell compresses an outer-fit puffy); never a mid-fit insulated
   * piece over an outer-fit soft shell. Every piece is classed by construction (so researched/custom pieces are covered),
   * and canOver(outer, stackUnder) answers YES / SNUG (works, flag "size up") / NO (physically or KUIU-wrong). */
  const classCache = new WeakMap();
  function torsoClass(it) {
    if (!it || it.slot !== 'torso') return null;
    let c = classCache.get(it); if (c !== undefined) return c;
    c = torsoClassRaw(it); classCache.set(it, c); return c;
  }
  function torsoClassRaw(it) {
    if (it.combo) return 'combo';                                   // insulated + waterproof in one (Gale Force jacket)
    if (it.terminal) return 'haven';                                // the terminal whitetail parka
    const insulated = it.ins === 'syn' || it.ins === 'down';
    if (it.wp === 2 && !insulated) return it.overInsul ? 'shell_hd' : 'shell';   // HD Flex (sized over a puffy) / Kutana (plain)
    if (insulated && it.fit === 'outer') return 'insul_outer';      // Proximity, Super Down PRO
    if (insulated && it.fit === 'mid') return 'insul_mid';          // Kenai / Super Down LT class (none owned today)
    if (it.fit === 'outer') return 'softshell';                     // Rubicon, Guide DCS, Axis Hybrid
    if (it.fit === 'mid') return 'fleece';                          // Peloton 200
    return it.relaxed ? 'base_relaxed' : 'base';                    // knit bases / relaxed woven shirts
  }
  function legsClass(it) {
    if (!it) return null;
    if (it.slot === 'wader') return 'wader';
    if (it.slot !== 'legs') return null;
    if (it.pos.indexOf('base') >= 0) return 'base';
    if (it.combo) return 'pant_combo';                              // Gale Force pant: outer insulated bib over a base ONLY
    if (it.pos.indexOf('overpant') >= 0 && it.wp === 2 && it.ins === 'none') return 'overpant';
    if (it.clo <= 0.16) return 'pant_light';                        // Tiburon
    if (it.ins === 'fleece' || it.quiet >= 9) return 'pant_soft';   // Encounter (bonded softshell, suspenders, leg zips)
    return 'pant';                                                  // Attack, Pro Brush
  }
  const YES = { ok: 'YES' };
  // SNUG carries a weight (fraction of cost.snug) and whether it is worth a flag: two athletic 200-weights is a note at most,
  // a rain shell squeezing a puffy is a real size-up warning
  function SNUG(why, w, quiet) { return { ok: 'SNUG', why: why, w: w == null ? 1 : w, quiet: !!quiet }; }
  function NO(why) { return { ok: 'NO', why: why }; }
  // outer `o` going on over the ordered stack `under` (skin -> out) of {it} entries
  function canOver(o, under) {
    const oc = torsoClass(o), cls = under.map(function (s) { return torsoClass(s.it); });
    const has = function (c) { return cls.indexOf(c) >= 0; };
    const base = under[0] ? under[0].it : null;
    const onlyBaseFleece = cls.every(function (c) { return c === 'base' || c === 'base_relaxed' || c === 'fleece'; });
    if (!cls.length) return (oc === 'base' || oc === 'base_relaxed') ? YES : NO('needs a base under it');
    if (has('shell') || has('shell_hd') || has('combo')) return NO('nothing goes over a rain shell or the Gale Force');
    if (has('haven')) return NO('nothing goes over the Haven');
    switch (oc) {
      case 'fleece':
        if (cls.length !== 1 || (cls[0] !== 'base' && cls[0] !== 'base_relaxed')) return NO('a fleece mid goes over the base only');
        if (cls[0] === 'base_relaxed') return SNUG('relaxed shirt under an athletic zip-T', 0.5, true);
        if (base.clo >= 0.2) return SNUG('athletic 200-weight over a 200-weight / insulated base', 0.25, true);
        return YES;
      case 'insul_mid':
        if (onlyBaseFleece) return YES;
        return NO('a mid-fit insulated piece never goes over a soft shell or an outer jacket');
      case 'softshell':
        if (has('softshell')) return NO('soft shell over soft shell');
        if (has('insul_outer')) return NO('a close-fit soft shell never goes over an outer-fit insulated jacket');
        if (has('insul_mid')) return SNUG('upsize the soft shell over an insulated mid');
        if (has('fleece') && cls[0] === 'base' && base.clo >= 0.2) return SNUG('upsize one: a 200-weight base plus fleece under a soft shell', 0.25, true);   // round 7: YES-with-cost, no flag (KUIU's own Cold build)
        return YES;
      case 'insul_outer':
        if (has('insul_outer')) return NO('two insulated outer-fit jackets');
        if (has('softshell')) return o.ins === 'down' ? SNUG('puffy one size up over the soft shell; tether out the collar') : NO('two outer-fit pieces — it is not sized over a soft shell');
        return YES;                                                 // base, fleece, mid-fit insulated
      case 'haven':
        if (onlyBaseFleece && cls.length <= 2) return YES;
        return NO('the Haven is sized over a base and a fleece — nothing more');
      case 'shell':
        if (has('insul_outer')) { const io = under.filter(function (s) { return torsoClass(s.it) === 'insul_outer'; })[0].it; return io.ins === 'down' ? SNUG('rain shell one size up over the puffy') : NO('a same-size rain shell does not go over the ' + io.name); }
        return YES;
      case 'shell_hd':
        if (has('insul_outer')) return SNUG('HD Flex one size up over the puffy, hood zipped off');
        return YES;
      case 'combo':
        if (has('insul_outer')) return NO('the Gale Force is the insulation — an outer-fit puffy never goes under it');
        return YES;                                                 // base, fleece, soft shell, mid-fit insulated (KUIU's own Frigid build)
      default:
        return NO('a base layer goes next to skin, not over anything');
    }
  }
  function canOverLegs(o, under) {
    const oc = legsClass(o), cls = under.map(function (s) { return legsClass(s.it); });
    const has = function (c) { return cls.indexOf(c) >= 0; };
    const baseIt = under[0] && cls[0] === 'base' ? under[0].it : null;
    const pantIt = (under.filter(function (s) { return legsClass(s.it) !== 'base'; })[0] || {}).it || null;
    if (has('pant_combo') || has('overpant') || has('wader')) return NO('nothing goes over the Gale Force pant, a rain pant or the waders');
    switch (oc) {
      case 'base': return cls.length ? NO('a base bottom goes next to skin') : YES;
      case 'pant_light': return cls.length ? NO('no base bottom under the Tiburon — the windows never overlap') : YES;
      case 'pant': return pantIt ? NO('pant over pant') : (baseIt && baseIt.clo >= 0.25 ? SNUG('pants run small over an insulated base bottom') : YES);
      case 'pant_soft': return pantIt ? NO('pant over pant') : YES;
      case 'pant_combo': return pantIt ? NO('the Gale Force pant is sized over a base bottom only — never over a pant') : YES;
      case 'overpant':
        if (!pantIt) return SNUG('rain pant as the only pant', 0.5);
        if (legsClass(pantIt) === 'pant_soft') return SNUG('size up; suspenders under a rain pant, and the quiet pant goes loud');
        if (pantIt.id === 'probrush_pant') return SNUG('size up over the brush pant (suspenders, reinforced panels)');
        return YES;
      case 'wader':
        if (!pantIt) return YES;
        if (legsClass(pantIt) === 'pant_soft') return NO('leg zips and cuff snaps inside a bootfoot');
        if (pantIt.id === 'probrush_pant') return SNUG('boot hook / gaiter hem inside the bootfoot');
        return YES;
      default: return NO('unknown');
    }
  }
  // the public table (harness / UI): every owned piece over every other piece as a 1-deep stack, torso and legs
  function CAN_OVER(gear) {
    const g = (gear || CATALOG);
    const t = g.filter(function (it) { return it.slot === 'torso'; }), l = g.filter(function (it) { return it.slot === 'legs' || it.slot === 'wader'; });
    const torso = {}, legs = {};
    t.forEach(function (o) { torso[o.id] = {}; t.forEach(function (u) { if (u.id !== o.id) torso[o.id][u.id] = canOver(o, [{ it: u }]).ok; }); });
    l.forEach(function (o) { legs[o.id] = {}; l.forEach(function (u) { if (u.id !== o.id) legs[o.id][u.id] = canOverLegs(o, [{ it: u }]).ok; }); });
    return { torso: torso, legs: legs };
  }

  // ---------- eligibility windows ----------
  function wetWidenOf(it) { return it.wetWiden != null ? it.wetWiden : TUNE.comboWetWiden; }
  function tmaxOf(it, ctx) { return (it.tmax == null ? 199 : it.tmax) + (it.combo && ctx && ctx.wet ? wetWidenOf(it) : 0); }
  function tminOf(it) { return it.tmin == null ? -99 : it.tmin; }
  function eligible(it, dressF, widen) {
    const w = widen || 0;
    return dressF >= tminOf(it) - w && dressF <= (it.tmax == null ? 199 : it.tmax) + w;
  }
  // uninsulated rain shells are judged on the air temperature — rain is rain, however hard you are walking
  function judgeF(it, ctx) { return (it.wp === 2 && it.ins === 'none') ? ctx.tempF : ctx.dressF; }
  function distCtx(it, ctx) { const f = judgeF(it, ctx), lo = tminOf(it), hi = tmaxOf(it, ctx); return f < lo ? lo - f : f > hi ? f - hi : 0; }
  function elig(it, ctx, widen) { const f = judgeF(it, ctx), w = widen || 0; return f >= tminOf(it) - w && f <= tmaxOf(it, ctx) + w; }
  function insulOuterClass(it) { const c = torsoClass(it); return c === 'insul_outer' || c === 'haven' || c === 'combo'; }
  // soft admission for the enumeration (spec 3.4 + audit finding 2): inside the window, or outside at a per-degree
  // cost — but never a warm-weather piece pulled into a cold stack, nothing absurdly far out, and (addendum B) an
  // insulated outer-fit piece never more than insulCapOver above its window on a sit. open=true = anything (trip mode).
  function admit(it, ctx, open) {
    if (open) return true;
    const f = judgeF(it, ctx), tmin = tminOf(it), tmax = tmaxOf(it, ctx);
    // a warm-weather piece is never pulled into a cold stack — judged on bases and pants (a soft shell or fleece over a
    // warm stack is never 'too warm-weather', whatever its standalone window says)
    if (tmin > f + TUNE.oobWarmIn && (it.fit === 'skin' || it.slot === 'legs')) return false;
    if (tmax < f - TUNE.oobColdIn) return false;
    // sits: never more than insulCapOver above its window, and never above insulSitMaxF at all (the Proximity's 46 + 2
    // is 48: a puffy on a 47-degree stand is wrong even when the arithmetic allows it)
    if (!ctx.moving && it.slot === 'torso' && insulOuterClass(it) && f > Math.min(tmax + TUNE.insulCapOver, TUNE.insulSitMaxF + (it.combo && ctx.wet ? wetWidenOf(it) : 0))) return false;
    // the insulated waterproof bib (legs combo) is a frigid piece too: never worn more than insulCapOver above its window
    if (it.slot === 'legs' && it.combo && f > tmax + TUNE.insulCapOver) return false;
    return true;
  }

  // ---------- phase context ----------
  function makeCtx(input, phaseKey) {
    const wx = input.wx, mode = input.mode;
    const wet = (wx.pprob || 0) >= TUNE.wetProb || (wx.precipIn || 0) >= TUNE.wetIn;
    const windy = (wx.gustMph || 0) >= TUNE.windyGust || (wx.windMph || 0) >= TUNE.windyWind;
    let met, K = 0, wb, seated = false, moving = false, offset = 0;
    if (phaseKey === 'sit') { met = mode === 'waterfowl' ? TUNE.met.wf_sit : TUNE.met.deer_sit; seated = true; }
    else if (phaseKey === 'walk') { met = TUNE.met.deer_walk; K = TUNE.K.walk; moving = true; offset = TUNE.dressOffset.walk; }
    else if (phaseKey === 'move') { met = TUNE.met.deer_still; K = TUNE.K.still; moving = true; offset = TUNE.dressOffset.still; }
    else if (phaseKey === 'stop') { met = TUNE.met.deer_stop; K = TUNE.K.stop; }
    else if (phaseKey === 'upland') { met = TUNE.met.upland; K = TUNE.K.upland; moving = true; offset = TUNE.dressOffset.upland; }
    if (mode === 'upland') wb = TUNE.windAtBody.upland;
    else if (mode === 'waterfowl') wb = input.wfEnv === 'dry' ? TUNE.windAtBody.wf_dry : TUNE.windAtBody.wf_marsh;
    else wb = (input.act === 'high') ? TUNE.windAtBody.deer_still : TUNE.windAtBody.deer;
    const windBody = (wx.windMph || 0) * wb;
    const tempF = wx.tempF;
    return {
      key: phaseKey, mode: mode, act: input.act || 'light', met: met, K: K, seated: seated, moving: moving,
      tempF: tempF, windBody: windBody, windy: windy, wet: wet && tempF < TUNE.wetTooWarmF, rain: wet,
      sunC: TUNE.sunC[wx.sun == null ? 0 : wx.sun] || 0, dressF: tempF + offset,
      wct: windChill(tempF, windBody), sitHours: input.sitHours || 3, blaze: input.blaze !== false,
      packed: !!input.packed, targetCache: {}, input: input, depth: 0
    };
  }
  // the phase target for a given outer-layer wind rating: {target, neutral (the all-day line on sits), neu (ISO object)}
  function targetFor(ctx, wind) {
    const perm = TUNE.perm[wind] || 8;
    if (!ctx.targetCache[perm]) {
      if (ctx.key === 'sit') {
        const sn = sitNeutral({ tempF: ctx.tempF, windMph: ctx.windBody, met: ctx.met, perm: perm, sunC: ctx.sunC });
        ctx.targetCache[perm] = { target: sitTarget(sn.neutral, ctx.sitHours), neutral: sn.neutral, neu: sn.neu };
      } else {
        const t = targetClo({ tempF: ctx.tempF, windMph: ctx.windBody, met: ctx.met, perm: perm, sunC: ctx.sunC, K: ctx.K, factor: ctx.key === 'stop' ? TUNE.stopFactor : 1 });
        ctx.targetCache[perm] = { target: t.target, neutral: t.target, neu: t.neu };
      }
    }
    return ctx.targetCache[perm];
  }
  // comfort hours of a supplied warmth for this phase (sits: against the all-day line; other phases: against their target)
  function phaseHours(ctx, S, wind) { const tg = targetFor(ctx, wind); return hoursRaw(S, tg.neutral, ctx.key === 'sit' ? TUNE.hoursCap : ctx.sitHours); }
  // piecewise-linear lookup for the base priors
  function lerpTable(tab, x) {
    if (x >= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) if (x >= tab[i][0]) { const f = (x - tab[i][0]) / (tab[i - 1][0] - tab[i][0]); return tab[i][1] + f * (tab[i - 1][1] - tab[i][1]); }
    return tab[tab.length - 1][1];
  }

  // ---------- extremities (ladders by wind chill) ----------
  function warmestEligible(list, t, prefer) {
    let el = list.filter(function (it) { return eligible(it, t, 0); });
    if (prefer) { const p = el.filter(prefer); if (p.length) el = p; }
    if (!el.length) {
      if (!list.length) return null;
      // nearest window edge
      return list.slice().sort(function (a, b) { return dist(a, t) - dist(b, t); })[0];
    }
    // equal warmth: keep waterproofing (Yukon over Kenai), then the colder-rated piece (its window reaches further down, so
    // it is the one still worn 1 degF colder — no lateral swaps as it cools), then quieter
    return el.sort(function (a, b) { return b.clo - a.clo || b.wp - a.wp || tminOf(a) - tminOf(b) || b.quiet - a.quiet; })[0];
  }
  function dist(it, t) { return t < it.tmin ? it.tmin - t : t > it.tmax ? t - it.tmax : 0; }

  // moving phases: the LIGHTEST glove that is in its window (dexterity over warmth — a shooting glove at 46, not a
  // waterproof insulated one); ties go to the window centred nearest the wind chill. Sits take the warmest.
  function nearestEligible(list, t) {
    const el = list.filter(function (it) { return eligible(it, t, 0); });
    if (!el.length) return null;
    const mid = function (it) { return ((it.tmin == null ? -40 : it.tmin) + (it.tmax == null ? 120 : it.tmax)) / 2; };
    return el.sort(function (a, b) { return a.clo - b.clo || Math.abs(mid(a) - t) - Math.abs(mid(b) - t); })[0];
  }
  // "why" text derived from the piece actually chosen (trip mode may hand us a different piece than the ladder expected)
  function whyHead(h, t) { if (h.pattern === 'Blaze') return 'blaze cap — visibility'; if (h.clo <= 0.02) return 'sun & brim'; return h.wind === 2 ? 'windproof, insulated' : (t >= 48 ? 'the warm hat you packed' : 'insulated beanie'); }
  function whyFeet(f, ctx) {
    const onFoot = (ctx.moving && ctx.key !== 'walk') || ctx.mode === 'upland';
    if (f.wp === 2) return onFoot ? (f.clo >= 0.2 ? 'warmest boot you own — the lace-up is too cold here' : 'waterproof rubber — short walks only') : (f.clo >= 0.2 ? 'taller, warmer — long sit' : (ctx.mode === 'deer' ? 'rubber = scent control at the stand' : 'waterproof — wet ground'));
    return onFoot ? 'built for miles' : (ctx.packed ? 'lace-up boot — the one you packed' : 'lace-up boot — dry ground');
  }

  function extremities(ctx, pool, input) {
    const by = function (slot) { return pool.filter(function (it) { return it.slot === slot; }); };
    const moving = ctx.moving;
    const t = ctx.wct + (moving ? TUNE.extremityMoveOffset : 0);          // walking warms hands and head
    const out = { head: [], neck: [], hands: [], feet: [], vest: [], sock: [] };
    // head
    const heads = by('head');
    let head = null;
    if (ctx.mode === 'deer' && ctx.blaze && t >= 42) head = heads.find(function (h) { return h.pattern === 'Blaze'; }) || null;
    if (!head) head = warmestEligible(heads.filter(function (h) { return !(ctx.mode !== 'deer' && h.pattern === 'Blaze'); }), t, ctx.windy ? function (h) { return h.wind >= 1; } : null);
    if (head) out.head.push(pick(head, 'head', whyHead(head, t)));
    // neck
    if (t < 45 || (ctx.windy && t < 55)) { const g = warmestEligible(by('neck'), t); if (g) out.neck.push(pick(g, 'neck', ctx.windy ? 'wind off your neck and face' : 'seals the collar')); }
    // hands
    if (t >= (ctx.moving ? 72 : TUNE.bareHandsSitF) || (ctx.mode === 'upland' && t >= 60)) out.hands.push(label('bare hands', 'too warm for gloves'));
    else {
      const hands = by('hands');
      const wpOnly = ctx.rain ? function (g) { return g.wp === 2; } : null;
      let h = null;
      const tooWarmForAll = hands.length && !ctx.rain && hands.every(function (g) { return t > g.tmax; });   // every glove you own is a cold-weather glove
      if (tooWarmForAll) out.hands.push(label('bare hands', 'too warm for the gloves you own'));
      else {
        if (moving) { const cand = wpOnly ? hands.filter(wpOnly) : hands; h = nearestEligible(cand.length ? cand : hands, t); }
        if (!h) h = warmestEligible(hands, t, wpOnly);
        // sits: the bulky frigid glove only when no lighter waterproof glove is in its window (dexterity on the shot)
        if (h && !moving && h.clo >= 0.1) { const lighter = hands.filter(function (g) { return g.id !== h.id && g.clo < h.clo && g.wp === 2 && eligible(g, t, 0); }).sort(function (a, b) { return b.clo - a.clo; })[0]; if (lighter) h = lighter; }
        if (h) {
          let why = h.wp === 2 ? (ctx.rain ? 'waterproof' : 'waterproof, warm') : (h.clo <= 0.03 ? 'trigger dexterity' : 'warm, still dexterous');
          if (h.clo >= 0.1 && ctx.mode !== 'waterfowl') why += ' — bulky: pull it to shoot, or run a liner';
          out.hands.push(pick(h, 'hands', why));
        }
        else out.hands.push(label('bare hands', 'nothing packed'));
      }
    }
    // feet
    const feet = by('feet');
    if (ctx.mode === 'waterfowl' && input.wfEnv !== 'dry') out.feet.push(label('Waders cover it', 'boot-foot'));
    else if ((moving && ctx.key !== 'walk') || ctx.mode === 'upland') {     // the walk-in wears the boots you will sit in
      // on foot the lace-up walking boot is the boot, whatever the window says (a slip-on neoprene boot is not a hiking boot)
      const f = feet.find(function (b) { return b.id === 'danner' || (/lace|hik/i.test(b.name) && b.wp < 2); }) || warmestEligible(feet, t);
      if (f) out.feet.push(pick(f, 'feet', whyFeet(f, ctx)));
      const alt = feet.find(function (b) { return f && b.id !== f.id && b.wp === 2 && eligible(b, t, 6); });
      if (alt && out.feet[0]) out.feet[0].alt.push({ id: alt.id, name: alt.name, why: 'swap in for wet ground' });
    } else {
      // sits: the tall neoprene boot in the cold, the ankle boot otherwise (both waterproof); lace-ups only if that is all there is
      const heavy = t < TUNE.sitBootHeavyBelowF;
      const f = warmestEligible(feet, t, function (b) { return b.wp === 2 && (heavy ? b.clo >= 0.2 : b.clo < 0.2); }) || warmestEligible(feet, t, function (b) { return b.wp === 2; }) || warmestEligible(feet, t);
      if (f) out.feet.push(pick(f, 'feet', whyFeet(f, ctx)));
    }
    const s = by('sock')[0]; if (s) out.feet.push(pick(s, 'sock', 'base sock'));   // sock rides in the feet list (contract 3.7)
    // vest
    const vests = by('vest');
    if (ctx.mode === 'upland') { const v = vests.find(function (x) { return x.pattern !== 'Blaze'; }) || vests[0]; if (v) out.vest.push(pick(v, 'vest', 'game bag, shells, water')); }
    else if (ctx.mode === 'deer' && ctx.blaze) { const v = vests.find(function (x) { return x.pattern === 'Blaze'; }); if (v) out.vest.push(pick(v, 'vest', 'over everything — gun-season visibility')); }
    delete out.sock;
    out.clo = ['head', 'neck', 'hands', 'feet', 'vest'].reduce(function (a, k) { return a + out[k].reduce(function (b, p) { const it = p.id && pool.find(function (x) { return x.id === p.id; }); return b + (it ? it.clo : 0); }, 0); }, 0);
    return out;
  }

  // ---------- torso / legs enumeration ----------
  function torsoCombos(ctx, pool, open, forced) {
    const tor = pool.filter(function (it) { return it.slot === 'torso' && admit(it, ctx, open); });
    const has = function (it, p) { return it.pos.indexOf(p) >= 0; };
    let bases = tor.filter(function (it) { return has(it, 'base') && it.fit === 'skin'; });
    let mids = [null].concat(tor.filter(function (it) { return has(it, 'mid'); }));
    const insuls = [null].concat(tor.filter(function (it) { return has(it, 'insul'); }));
    let outers = [null].concat(tor.filter(function (it) { return has(it, 'outer'); }));
    // walk-in (addendum C): the sit's base and fleece mid are WORN in (zips open); only the outer is chosen here
    if (forced && forced.walkBase) { bases = [forced.walkBase]; mids = forced.walkMid ? [null, forced.walkMid] : mids; }
    // wet below the too-warm line: the outer MUST be a membrane shell when you own one that fits the window
    if (ctx.wet && outers.some(function (o) { return o && o.wp === 2; })) outers = outers.filter(function (o) { return o && o.wp === 2; });
    // moving phases on a DRY day in little wind: a plain rain shell is not the outer while a soft shell is admitted (a crinkly
    // membrane in calm 10-degree air when a soft shell fits is hunter-wrong; its perm=1 target bonus is not a reason)
    if (!open && !ctx.wet && ctx.moving && ctx.windBody < TUNE.moveShellWindMin && outers.some(function (o) { return o && torsoClass(o) === 'softshell' && o.active; })) outers = outers.filter(function (o) { return !o || torsoClass(o) !== 'shell'; });
    // still-hunting: the insulated outer (combo) stays in the pack for the stops whenever a plain outer and a stop
    // layer exist — move in the plain shell / soft shell, pull the insulation on when you stop
    if (ctx.key === 'move' && outers.some(function (o) { return o && !o.combo && o.fit === 'outer' && (!ctx.wet || o.wp === 2); })
        && pool.some(function (it) { return it.slot === 'torso' && it.fit === 'outer' && (it.ins === 'syn' || it.ins === 'down') && (!ctx.wet || it.wp === 2); })) outers = outers.filter(function (o) { return !o || !o.combo; });
    // moving (still-hunt / upland): below moveOuterBelowF wind chill an outer is required, not optional, when one fits
    if (ctx.moving && ctx.key !== 'walk' && ctx.wct < TUNE.moveOuterBelowF && outers.some(function (o) { return o && o.fit === 'outer' && o.active; })) outers = outers.filter(function (o) { return o && o.fit === 'outer'; });
    const out = [];
    bases.forEach(function (b) { mids.forEach(function (m) { insuls.forEach(function (i) { outers.forEach(function (o) {
      // a piece listed as insul AND outer is enumerated once as the outer (i with no o would be the identical stack)
      if (i && !o && i.pos.indexOf('outer') >= 0) return;
      // ...and a mid that is also listed as an outer (Peloton 200) is enumerated as the outer when it is outermost
      if (m && !i && !o && m.pos.indexOf('outer') >= 0) return;
      const st = [b, m, i, o].filter(Boolean);
      const ids = st.map(function (x) { return x.id; });
      if (new Set(ids).size !== ids.length) return;
      const v = validTorso(ctx, b, m, i, o, open, forced); if (!v) return;
      out.push(v);
    }); }); }); });
    return out;
  }
  // returns {stack:[{it,role,fit}], mult, flags, snugWhy} or null. Every piece is checked against the stack under it
  // with the garment matrix (canOver): NO = not a stack, SNUG = allowed with a size-up flag and a compression penalty.
  function validTorso(ctx, b, m, i, o, open, forced) {
    const stack = [{ it: b, role: 'base', fit: 'skin' }];
    if (m) stack.push({ it: m, role: 'mid', fit: 'mid' });
    if (i) stack.push({ it: i, role: o ? 'insul' : 'outer', fit: i.fit });
    if (o) stack.push({ it: o, role: 'outer', fit: o.fit });
    const flags = [], mult = {}; let snugWhy = null, snugW = 0;
    // ---- the matrix: each piece over everything under it ----
    for (let k = 1; k < stack.length; k++) {
      const v = canOver(stack[k].it, stack.slice(0, k));
      if (v.ok === 'NO') return null;
      if (v.ok === 'SNUG') {
        flags.push('snug'); snugW += v.w; if (!v.quiet) snugWhy = snugWhy || v.why;
        // a shell squeezing an outer-fit puffy under it, or a puffy squeezed over a soft shell: that puffy loses a little loft
        const kc = torsoClass(stack[k].it);
        stack.slice(0, k).forEach(function (s) { if (torsoClass(s.it) === 'insul_outer') mult[s.it.id] = (mult[s.it.id] || 1) * (TUNE.compress[s.it.ins] || 1); });
        if (kc === 'insul_outer') mult[stack[k].it.id] = (mult[stack[k].it.id] || 1) * (TUNE.compress[stack[k].it.ins] || 1);
      }
    }
    const outerIt = stack[stack.length - 1].it, oc = torsoClass(outerIt);
    const anyInsul = stack.some(function (s) { const c = torsoClass(s.it); return c === 'insul_outer' || c === 'insul_mid' || c === 'haven' || c === 'combo'; });
    // the HD Flex is the waterfowl shell sized over an insulated jacket: on a DRY day it is worn only over one (the Kutana is
    // the plain shell); in rain with nothing insulated under it, it is merely the wrong shell (cost — trip mode may leave it as the only one)
    if (oc === 'shell_hd' && !anyInsul) { if (!open) return null; flags.push('shellNoInsul'); }   // round 7: wet or dry — the Kutana is the plain rain shell
    // the insulated rain shell (combo) is the wet / frigid outer: on a DRY day it is worn only at or below comboDryMaxF
    if (!open && !ctx.wet && oc === 'combo' && ctx.tempF > TUNE.comboDryMaxF) return null;
    // a dry day at/above noOuterAboveF: no outer at all; between softshellWindAboveF and there, a soft shell only in real wind
    if (!open && !ctx.wet && ctx.tempF >= TUNE.noOuterAboveF && stack.length > 1 && oc !== 'fleece') return null;
    if (!open && !ctx.wet && ctx.tempF >= TUNE.softshellWindAboveF && ctx.tempF < TUNE.noOuterAboveF && stack.length > 1 && oc !== 'fleece' && (oc !== 'softshell' || ctx.windBody < TUNE.softshellWindMin)) return null;
    // a dry sit above sitSoftshellOptAboveF: a soft shell is WORN only in real wind — otherwise it is the optional row (round 7)
    if (!open && !ctx.wet && !ctx.moving && oc === 'softshell' && ctx.tempF > TUNE.sitSoftshellOptAboveF && ctx.windBody < TUNE.sitSoftshellOptWind) return null;
    // moving: only pieces that breathe on the move — except the base on a walk-in (you cannot change your base at the stand)
    if (ctx.moving) { for (let k = 0; k < stack.length; k++) if (!stack[k].it.active && !(ctx.key === 'walk' && (k === 0 || (forced && forced.walkMid && stack[k].it.id === forced.walkMid.id)))) return null; }
    // walk-in: the sit's fleece mid is worn in (as the mid, or as the outer on a calm day); never a bare base below
    // walkBareBaseBelowF (dressed)
    if (ctx.key === 'walk' && forced && forced.walkMid && !stack.some(function (s) { return s.it.id === forced.walkMid.id; })) return null;
    if (ctx.key === 'walk' && stack.length === 1 && ctx.dressF < TUNE.walkBareBaseBelowF) return null;
    // exactly one next-to-skin piece (spec rule 7)
    if (m && m.fit === 'skin') return null;
    // fit non-decreasing outward (the matrix already forbids the real cases; this keeps the effective-fit field honest)
    for (let k = 1; k < stack.length; k++) if (FIT[stack[k].fit] < FIT[stack[k - 1].fit]) return null;
    // a fleece (knit, wind 0, mid-fit) as the OUTERMOST piece only when calm & dry
    if (stack.length > 1 && oc === 'fleece' && outerIt.wind === 0) { if (ctx.windBody >= (ctx.moving ? TUNE.fleeceOuterWindMove : TUNE.fleeceOuterWindSit) || ctx.wet) return null; }
    // down under a rain shell in rain / sleet: works, but the synthetic or the Gale Force is preferred (cost)
    if (ctx.wet && outerIt.wp === 2 && stack.some(function (s) { return s.role !== 'outer' && s.it.ins === 'down'; })) flags.push('downWet');
    // wet with no membrane outer: exposed insulation soaks
    if (ctx.wet && outerIt.wp !== 2) {
      stack.forEach(function (s) { if (s.it.ins !== 'none') mult[s.it.id] = (mult[s.it.id] || 1) * (TUNE.wetNoShell[s.it.ins] || 1); });
      flags.push('soaked');
    }
    return { stack: stack, mult: mult, flags: flags, snugWhy: snugWhy, snugW: snugW, outerWind: outerIt.wind, outer: outerIt };
  }
  function legsCombos(ctx, pool, open, forced) {
    const legs = pool.filter(function (it) { return it.slot === 'legs' && admit(it, ctx, open); });
    const has = function (it, p) { return it.pos.indexOf(p) >= 0; };
    let bases = [null].concat(legs.filter(function (it) { return has(it, 'base'); }));
    let pants = legs.filter(function (it) { return has(it, 'pant'); });
    let overs = [null].concat(legs.filter(function (it) { return has(it, 'overpant'); }));
    if (forced && forced.legsBase) {
      // walk-in: you wear the sit's base + pant on the walk (you do not change pants at the stand — the Gale Force pant
      // included: side zips open on the way in); only a plain overpant may be added or kept
      const fb = forced.legsBase.find(function (s) { return s.role === 'base'; }), fp = forced.legsBase.find(function (s) { return s.role === 'pant'; });
      bases = [fb ? fb.it : null];
      pants = fp ? [fp.it] : legs.filter(function (it) { return has(it, 'pant'); });
      overs = [null].concat(pool.filter(function (it) { return it.slot === 'legs' && has(it, 'overpant') && !it.combo; }));
      if (!pants.length) return [];
    }
    if (forced && forced.wader) pants = pool.some(function (it) { return it.slot === 'legs' && has(it, 'base'); }) ? [null] : [null].concat(pants);   // waders over a base bottom (a compatible pant only when no base bottom is packed at all)
    else if (forced && forced.pant) { const fp = pool.find(function (p) { return p.id === forced.pant; }); if (fp) pants = [fp]; }
    // wet: legs need a waterproof outer too — an overpant, or a waterproof pant, when you own one that fits
    if (ctx.wet && !(forced && forced.wader)) {
      const wpPant = pants.some(function (p) { return p && p.wp === 2; }), wpOver = overs.some(function (o) { return o && o.wp === 2; });
      if (wpPant || wpOver) {
        if (!wpOver) pants = pants.filter(function (p) { return p && p.wp === 2; });
        overs = overs.filter(function (o) { return o === null || o.wp === 2; });
      }
    }
    const out = [];
    ctx.legsNeedWp = ctx.wet && !(forced && forced.wader) && (pants.some(function (p) { return p && p.wp === 2; }) || overs.some(function (o) { return o && o.wp === 2; }));
    bases.forEach(function (b) { pants.forEach(function (p) { overs.forEach(function (o) {
      const v = validLegs(ctx, b, p, o, forced); if (v) out.push(v);
    }); }); });
    return out;
  }
  function validLegs(ctx, b, p, o, forced) {
    const stack = [];
    if (b) stack.push({ it: b, role: 'base' });
    if (p) stack.push({ it: p, role: 'pant' });
    if (forced && forced.wader) stack.push({ it: forced.wader, role: 'wader' });
    if (o) stack.push({ it: o, role: 'overpant' });
    if (!p && !(forced && forced.wader)) return null;
    const flags = [], mult = {}; let snugWhy = null, snugW = 0;
    // ---- the legs matrix ----
    for (let k = 1; k < stack.length; k++) {
      const v = canOverLegs(stack[k].it, stack.slice(0, k));
      if (v.ok === 'NO') return null;
      if (v.ok === 'SNUG') { flags.push('snug'); snugW += v.w; if (!v.quiet) snugWhy = snugWhy || v.why; }
    }
    // moving: pieces that breathe — except the base bottom and pant on a walk-in (you cannot change them at the stand)
    if (ctx.moving) { for (let k = 0; k < stack.length; k++) if (stack[k].it.active === false && !(ctx.key === 'walk' && (stack[k].role === 'base' || stack[k].role === 'pant'))) return null; }
    if (o) {
      if (forced && forced.wader) return null;
      if (p && o.id === p.id) return null;
      const needWind = ctx.windBody >= 15 && p && p.wind === 0 && ctx.tempF < TUNE.softshellWindAboveF;   // a wind block over the legs: never on a hot day
      // a plain overpant (Kutana Storm Shell pant) is for rain or wind only
      if (!(ctx.wet || needWind)) return null;
    }
    const outerIt = stack[stack.length - 1].it;
    if (ctx.wet && outerIt.wp !== 2) {
      if (ctx.legsNeedWp) return null;
      stack.forEach(function (s) { if (s.it.ins !== 'none') mult[s.it.id] = TUNE.wetNoShell[s.it.ins] || 1; }); flags.push('soaked');
    }
    return { stack: stack, mult: mult, flags: flags, snugWhy: snugWhy, snugW: snugW, forcedPant: !!(forced && (forced.pant || forced.wader)) };
  }
  function sumStack(c) { return c.stack.reduce(function (a, s) { return a + s.it.clo * (c.mult[s.it.id] || 1); }, 0); }
  function loudness(c) { return c.stack.reduce(function (a, s) { return a + (10 - s.it.quiet); }, 0); }
  function weight(c) { return c.stack.reduce(function (a, s) { return a + (s.it.w || 0); }, 0); }
  function specialists(c, mode) { return c.stack.reduce(function (a, s) { return a + ((s.it.disc && s.it.disc.length === 1 && s.it.disc[0] === mode) ? 1 : 0); }, 0); }
  // out-of-band cost of a stack: per degree, steeper when a piece is worn colder than its window. A piece's window is
  // its STANDALONE comfort band, so the cold side applies only to the outermost piece — a pant under a bib or a shirt
  // under a puffy is never "too cold"; the warm side (a piece hotter than the day) applies to every piece.
  function outOfBand(c, ctx) {
    return c.stack.reduce(function (a, s, k) {
      const f = judgeF(s.it, ctx), d = distCtx(s.it, ctx), cold = d && f < tminOf(s.it);
      if (cold && k < c.stack.length - 1) return a;
      // cold side: linear only (the deficit term already says the stack is too cold; a soft shell worn colder than its
      // standalone band over a warm stack is normal). Warm side: linear + square (a frigid piece on a mild day is wrong).
      if (cold) return a + d * TUNE.cost.outOfBandCold;
      return a + d * TUNE.cost.outOfBand + TUNE.cost.outOfBandSq * d * d;
    }, 0);
  }

  // base-layer priors: how far the chosen base / base bottom sits from the warmth expected at this dressed temp
  function basePriorCost(tc, lc, ctx) {
    const b = tc.stack[0].it;
    let c = TUNE.cost.basePrior * Math.abs(b.clo - lerpTable(TUNE.basePrior, ctx.dressF)) / 0.1;
    const lb = lc.stack.find(function (s) { return s.role === 'base'; });
    // moving phases (upland, still-hunt, walk-in): legs run warmer on foot, so the base-bottom expectation sits
    // TUNE.legsBaseMoveShift degF colder than on a sit (upland at 30 degF air walks in the brush pant alone)
    const legsF = ctx.moving ? ctx.dressF + TUNE.legsBaseMoveShift : ctx.dressF;
    const exp = lerpTable(TUNE.legsBasePrior, legsF);
    c += TUNE.cost.legsBasePrior * Math.abs((lb ? lb.it.clo : 0) - exp) / 0.1;
    const lp = lc.stack.find(function (s) { return s.role === 'pant'; });
    // the pant prior reads a wet day as colder (sleet / wet snow: the insulated waterproof bib earlier)
    if (lp && !lc.forcedPant) c += TUNE.cost.legsBasePrior * Math.abs(lp.it.clo - lerpTable(TUNE.pantPrior, ctx.dressF - (ctx.wet ? TUNE.pantPriorWetShift : 0))) / 0.1;
    return c;
  }
  // coherence with the stack worn 1 degF warmer (ctx.ref): dropping one of its pieces, or swapping a role for a lighter
  // piece, costs — adding pieces or swapping warmer is free. The two "stay put" terms together are CAPPED
  // (TUNE.cost.stabilityCap) so a real cost gap can still change the family (addendum E); the monotonic-warmth term is not.
  function stabilityCost(tc, lc, ctx, S) {
    const ref = ctx.ref; if (!ref) return 0;
    const cur = {};
    tc.stack.forEach(function (s) { cur['t:' + s.role] = s.it; });
    lc.stack.forEach(function (s) { cur['l:' + s.role] = s.it; });
    let drop = 0, lighter = 0;
    // a lighter piece in a (non-base) role is free only when a role was ADDED and the outfit did not get colder (a real
    // re-shuffle: fleece added, soft shell swapped lighter); otherwise it is a lateral flip and costs. The base never
    // gets lighter going colder for free.
    const addedRole = Object.keys(cur).some(function (k) { return !ref.pieces.some(function (x) { return x.key === k; }); });
    ref.pieces.forEach(function (r) {
      const m = cur[r.key];
      if (!m) drop += TUNE.cost.stability;
      else if (m.id !== r.id && m.clo < r.clo - 0.02 && !(r.key !== 't:base' && addedRole && S >= ref.S - 0.02)) lighter += TUNE.cost.lighterSwap;
    });
    // the "stay put" term is CAPPED so a real cost gap can still change the family (addendum E); dropping a piece and
    // dressing colder than the pick 1 degF warmer are priced in full
    return Math.min(lighter, TUNE.cost.stabilityCap) + drop + TUNE.cost.dropBelowRef * Math.max(0, ref.S - S - 0.05);
  }
  // score a torso+legs pair; returns {S, R, cost, tg}
  function score(ctx, tc, lc, extClo, noLegShare) {
    const tSum = sumStack(tc), lSum = sumStack(lc);
    if (!noLegShare && lSum < TUNE.legShare * (tSum + lSum)) return null;
    // ...and the torso is never the cold half: once the legs carry real insulation (a bib / over-pant stack), the torso
    // must supply at least torsoShare of the pair — whole-body clo is not fungible, an under-dressed core leaks heat
    // whatever the legs wear (walk-in: the legs are the sit's, fixed)
    if (!noLegShare && ctx.key !== 'walk' && lSum >= TUNE.torsoShareMinLegs && tSum < TUNE.torsoShare * (tSum + lSum)) return null;
    const raw = TUNE.sumA * (tSum + lSum + extClo) + TUNE.sumB;
    const S = raw * (ctx.seated ? TUNE.seated : 1);
    const tg = targetFor(ctx, tc.outerWind);
    const R = tg.target;
    let loudW = TUNE.loudWeight[ctx.mode] == null ? 1 : TUNE.loudWeight[ctx.mode];
    if (ctx.mode === 'deer' && ctx.key === 'sit') loudW *= TUNE.loudSit;     // bow range: noise costs most on the stand
    const outerIt = tc.outer;
    // a still-hunt / upland walk below moveOuterBelowF wind chill wants a real outer (the walk-in is exempt: it wears a
    // sub-stack of the sit and the shell goes on at the stand)
    const noOuter = !(outerIt.fit === 'outer') && ctx.moving && ctx.key !== 'walk' && ctx.wct < TUNE.moveOuterBelowF;
    // deficit is priced from zero; overshoot is cheap in the cold and 2.5x on mild days (a puffy over a shirt at 52 is sweat, not safety)
    const overW = ctx.tempF >= TUNE.cost.overshootMildF ? TUNE.cost.overshootMild : TUNE.cost.overshoot;
    const snugs = (tc.snugW || 0) + (lc.snugW || 0);
    const cost = TUNE.cost.deficit * Math.max(0, R - S) + overW * Math.max(0, S - R)
      + TUNE.cost.layer * (tc.stack.length + lc.stack.length)
      + TUNE.cost.loud * loudW * (loudness(tc) + loudness(lc))
      + TUNE.cost.weight * (weight(tc) + weight(lc))
      + outOfBand(tc, ctx) + outOfBand(lc, ctx)
      + TUNE.cost.snug * snugs
      + (tc.flags.indexOf('shellNoInsul') >= 0 ? TUNE.cost.shellNoInsul : 0)
      + (tc.flags.indexOf('downWet') >= 0 ? TUNE.cost.downWetUnderShell : 0)
      + (noOuter ? TUNE.cost.noOuterCold : 0)
      + basePriorCost(tc, lc, ctx)
      + stabilityCost(tc, lc, ctx, S)
      - TUNE.cost.specialist * (specialists(tc, ctx.mode) + specialists(lc, ctx.mode));
    return { S: S, R: R, cost: cost, tg: tg };
  }

  // ================================================================================================
  // COHERENCE: the CANONICAL LADDER (round 7)
  // Every hunt type (phase x mode x activity x wet x forced pieces x closet) has ONE ladder of outfits, built once as a
  // chain from the warm anchor (CHAIN_TOP) down in 1-degF steps at CALM wind, no sun, a 3-hour sit — each step coherent
  // with the step above it (add a piece / swap warmer, never drop). The actual hunt (its temperature, wind at the body,
  // sun, planned hours) then simply WALKS the ladder from the warm end and takes the first rung whose comfort hours
  // (computed for the real weather, with that rung's own outer) reach the planned sit (moving phases: the first rung
  // that meets its target). A colder, windier, longer or shadier hunt can only step further down the SAME ladder, so
  // the pick is monotone along every axis at once — temperature, wind, sun and sit-hours — with no family reversals
  // (rounds 3-6 chained per wind value, and a 2-mph forecast change could flip Gale Force <-> Proximity + HD Flex).
  // Nothing on the ladder reaches the planned sit => the rung with the most hours, and the warmest legal off-ladder
  // outfit is NAMED (budget.warmer), never worn — wearing it would re-create the wind flips.
  // ================================================================================================
  const CHAIN_TOP = 95, LADDER_BOTTOM = -10, LADDER_SHORTCUT = 6, ladderCache = new Map();
  function ladderSig(ctx, pool, forced) {
    return [ctx.key, ctx.mode, ctx.act, ctx.input.wfEnv || '', ctx.rain ? 1 : 0, ctx.blaze ? 1 : 0,
      forced && forced.wader ? 'W' : '', forced && forced.pant ? forced.pant : '',
      pool.map(function (it) { return it.id + ':' + it.clo + ':' + it.tmin + ':' + it.tmax + ':' + it.fit + ':' + it.pos.join(''); }).join('|')].join('#');
  }
  // the canonical conditions a ladder is built under: this hunt's own rain / mode / closet, but calm, no sun, 3 h
  function canonicalInput(input, tempF) {
    return Object.assign({}, input, { wx: Object.assign({}, input.wx, { tempF: tempF, windMph: 0, gustMph: 0, sun: 0 }), sitHours: 3 });
  }
  function refOf(b) {
    const pieces = [];
    b.tc.stack.forEach(function (s) { pieces.push({ key: 't:' + s.role, id: s.it.id, clo: s.it.clo }); });
    b.lc.stack.forEach(function (s) { pieces.push({ key: 'l:' + s.role, id: s.it.id, clo: s.it.clo }); });
    return { pieces: pieces, S: b.S };
  }
  function ladderOf(ctx, pool, forced) {
    if (ctx.ladder) return ctx.ladder;                       // computed once per recommend() call
    const sig = ladderSig(ctx, pool, forced);
    let ladder = ladderCache.get(sig);
    if (!ladder) { if (ladderCache.size > 24) ladderCache.clear(); ladder = { rungs: {}, stop: {}, lattice: {} }; ladderCache.set(sig, ladder); }
    ctx.ladder = ladder;
    return ladder;
  }
  // the ladder entry (outfit chosen at calm/3 h) for canonical temperature t, building the chain down to it on demand
  function ladderEntry(ctx, pool, forced, t) {
    const ladder = ladderOf(ctx, pool, forced), rungs = ladder.rungs;
    if (rungs[t] !== undefined) return rungs[t];
    let start = CHAIN_TOP; while (start > t && rungs[start] !== undefined) start--;
    for (let tt = start; tt >= t; tt--) {
      if (rungs[tt] !== undefined) continue;
      const inp = canonicalInput(ctx.input, tt);
      const c2 = makeCtx(inp, ctx.key); c2.depth = 1; c2.ladder = ladder;
      c2.ref = (tt + 1 <= CHAIN_TOP && rungs[tt + 1]) ? rungs[tt + 1].ref : null;
      const e2 = extremities(c2, pool, inp);
      const b2 = buildCheapest(c2, pool, e2, forced, false);
      rungs[tt] = b2 ? { ref: refOf(b2), tc: b2.tc, lc: b2.lc, t: tt } : null;
    }
    return rungs[t];
  }

  // the cheapest outfit for a phase under its OWN cost (chain steps, walk-in, trip-mode last resort).
  // One enumeration over every admitted piece (out-of-band pieces pay per degree); the CHEAPEST outfit wins — the cost
  // prices a shortfall at 12/clo, so there is no met-the-target gate. SITS (addendum D): the target is the warmth that
  // gives the planned hours; a not-short outfit within cost.shortSwitch of the cheapest is taken instead.
  function buildCheapest(ctx, pool, ext, forced, open) {
    const tcs = torsoCombos(ctx, pool, !!open, forced), lcs = legsCombos(ctx, pool, !!open, forced);
    let b = null, bOk = null, bMax = null, maxS = 0, maxEff = 0;
    tcs.forEach(function (tc) { lcs.forEach(function (lc) {
      const sc = score(ctx, tc, lc, ext.clo); if (!sc) return;
      if (sc.S > maxS) maxS = sc.S;
      const cand = { tc: tc, lc: lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg };
      if (!b || sc.cost < b.cost - 1e-9) b = cand;
      const ok = phaseHours(ctx, sc.S, tc.outerWind) >= ctx.sitHours - 1e-9;   // unrounded: no half-hour rounding deciding "full sit"
      if (ok && (!bOk || sc.cost < bOk.cost - 1e-9)) bOk = cand;
      const eff = sc.S * sc.tg.neu.CF;
      if (eff > maxEff + 1e-9) { maxEff = eff; bMax = cand; }
    }); });
    if (!b) return null;
    let best = b, warmer = null;
    const bHours = hoursOfComfort(b.S, targetFor(ctx, b.tc.outerWind).neutral, ctx.key === 'sit' ? TUNE.hoursCap : ctx.sitHours);
    if (bHours < ctx.sitHours) {
      if (bOk && bOk !== b) { if (TUNE.cost.shortSwitch > 0 && bOk.cost <= b.cost + TUNE.cost.shortSwitch) best = bOk; else warmer = bOk; }
      else if (bMax && bMax !== b && maxEff > b.S * b.tg.neu.CF + 0.08 && bMax.S >= b.S + TUNE.warmerMinGain) warmer = bMax;
    }
    best.maxS = maxS; best.maxEff = maxEff; best.open = !!open; best.warmer = warmer; best.bMax = bMax;
    best.altT = altsFor(ctx, best, tcs, true, ext.clo);
    best.altL = altsFor(ctx, best, lcs, false, ext.clo);
    return best;
  }
  // a candidate outfit is COHERENT with a reference when every reference piece is still worn (in any role) or its role
  // holds a warmer piece — i.e. the candidate only adds pieces or swaps warmer.
  // A combo piece (Gale Force jacket / pant = insulation + shell in one) stands in for BOTH roles it replaces, so
  // "puffy + rain shell" -> "Gale Force jacket" and "pant + rain pant" -> "Gale Force pant" are coherent steps.
  function coherentWith(tc, lc, ref) {
    if (!ref) return true;
    const ids = {}, byRole = {};
    tc.stack.forEach(function (s) { ids[s.it.id] = 1; byRole['t:' + s.role] = s.it; if (s.it.combo) { byRole['t:insul'] = byRole['t:insul'] || s.it; byRole['t:outer'] = byRole['t:outer'] || s.it; } });
    // a warmer insulated OUTER (Haven over a Proximity + HD Flex) stands in for the puffy it replaces under the shell
    const oT = tc.stack.length ? tc.stack[tc.stack.length - 1].it : null;
    if (oT && !byRole['t:insul'] && insulOuterClass(oT)) byRole['t:insul'] = oT;
    lc.stack.forEach(function (s) { ids[s.it.id] = 1; byRole['l:' + s.role] = s.it; if (s.it.combo) { byRole['l:overpant'] = byRole['l:overpant'] || s.it; } });
    return ref.pieces.every(function (r) { if (ids[r.id]) return true; const m = byRole[r.key]; return !!m && m.clo >= r.clo + 0.02; });
  }
  function piecesOf(tc, lc) { return refOf({ tc: tc, lc: lc, S: 0 }).pieces; }

  // ---- cheap legality of a ladder rung on a REAL day (the same rules torsoCombos / legsCombos apply, without enumerating) ----
  function rungLegal(ctx, e, pool, forced) {
    const roleOf = function (c, role) { const s = c.stack.find(function (x) { return x.role === role; }); return s ? s.it : null; };
    const tor = pool.filter(function (it) { return it.slot === 'torso' && admit(it, ctx, false); });
    const b = roleOf(e.tc, 'base'), m = roleOf(e.tc, 'mid'), i = roleOf(e.tc, 'insul'), o = roleOf(e.tc, 'outer');
    for (const x of [b, m, i, o]) if (x && !admit(x, ctx, false)) return null;
    const outerIt = e.tc.outer;
    if (ctx.wet && outerIt.wp !== 2 && tor.some(function (it) { return it.pos.indexOf('outer') >= 0 && it.wp === 2; })) return null;
    if (!ctx.wet && ctx.moving && ctx.windBody < TUNE.moveShellWindMin && torsoClass(outerIt) === 'shell' && tor.some(function (it) { return it.pos.indexOf('outer') >= 0 && torsoClass(it) === 'softshell' && it.active; })) return null;
    if (ctx.key === 'move' && outerIt.combo && tor.some(function (x) { return x.pos.indexOf('outer') >= 0 && !x.combo && x.fit === 'outer' && (!ctx.wet || x.wp === 2); })
        && pool.some(function (it) { return it.slot === 'torso' && it.fit === 'outer' && (it.ins === 'syn' || it.ins === 'down') && (!ctx.wet || it.wp === 2); })) return null;
    if (ctx.moving && ctx.key !== 'walk' && ctx.wct < TUNE.moveOuterBelowF && outerIt.fit !== 'outer' && tor.some(function (x) { return x.pos.indexOf('outer') >= 0 && x.fit === 'outer' && x.active; })) return null;
    const tc = validTorso(ctx, b, m, i, o, false, forced); if (!tc) return null;
    const lb = roleOf(e.lc, 'base'), lp = roleOf(e.lc, 'pant'), lo = roleOf(e.lc, 'overpant');
    for (const x of [lb, lp, lo]) if (x && !admit(x, ctx, false)) return null;
    if (!(forced && forced.wader)) {
      const legs = pool.filter(function (it) { return it.slot === 'legs' && admit(it, ctx, false); });
      ctx.legsNeedWp = ctx.wet && (legs.some(function (p) { return p.pos.indexOf('pant') >= 0 && p.wp === 2; }) || legs.some(function (p) { return p.pos.indexOf('overpant') >= 0 && p.wp === 2; }));
    } else ctx.legsNeedWp = false;
    const lc = validLegs(ctx, lb, lp, lo, forced); if (!lc) return null;
    return { tc: tc, lc: lc };
  }
  // ---- one cell of the temperature x wind lattice (see pickCell) ----
  function ctxAt(ctx, t, w) {
    const wx = ctx.input.wx;
    const inp = Object.assign({}, ctx.input, { wx: Object.assign({}, wx, { tempF: t, windMph: w, gustMph: Math.min(wx.gustMph || 0, w + 6) }) });
    const c = makeCtx(inp, ctx.key); c.depth = 1; c.ref = null; c.inp = inp; c.ladder = ctx.ladder;
    return c;
  }
  function evalAt(cW, eW, tc, lc, rungT) {
    const sc = score(cW, tc, lc, eW.clo); if (!sc) return null;
    const h = phaseHours(cW, sc.S, tc.outerWind);
    // the ISO wind term over-asks on a mild day (a tee at 77 is a tee at 77, however it blows): above neverShortAboveF a
    // sit is never short, so the calm pick for the temperature stands; the same for a walk above noOuterAboveF
    const mild = cW.key === 'sit' ? cW.tempF >= TUNE.neverShortAboveF : cW.tempF >= TUNE.noOuterAboveF;
    const metMove = cW.key !== 'sit' && met(sc.S, sc.R);
    return { tc: tc, lc: lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, rungT: rungT, hoursRaw: h, mild: mild, metMove: metMove, pieces: piecesOf(tc, lc) };
  }
  const HOURS_LEVELS = [1, 2, 3, 4, 5, 6];
  function meetsAt(c, cW, h) { return c.mild || (cW.key === 'sit' ? c.hoursRaw >= h - 1e-9 : c.metMove); }
  // THE LATTICE (round 7). A cell is one (temperature, forecast wind) of this hunt (its mode / rain / sun / closet) and
  // holds the pick for EVERY planned sit length 1..6 h. pick(t, w, h) is:
  //   (1) the first rung of the canonical ladder, walking DOWN from today's air temperature (a few degrees only), that is
  //       legal today, reaches h hours with its own outer in today's wind, and is coherent with pick(t+1, w, h),
  //       pick(t, w-2, h) and pick(t, w, h-1) (adds or swaps warmer only — a ladder rung is coherent with every rung
  //       above it, so these checks only bite next to a warmed-up cell);
  //   (2) failing that (the calm ladder has no legal rung that reaches the hours — typically the mild-but-windy band,
  //       where it jumps from "shirt + soft shell" to puffies that are not allowed at 50 degrees): the cheapest legal
  //       outfit today that reaches the hours AND is coherent with all three neighbours; else the warmest coherent one;
  //       else (a legality cliff, nothing coherent is legal) the cheapest legal one.
  // Every cell is memoised and neighbours are only computed when needed, so a hunt costs the cells on its own
  // temperature column plus the warmed-up band. Coherent with (t+1, w), (t, w-2) and (h-1) at every cell => the pick is
  // monotone in temperature, wind and sit length at once, with no family reversals.
  function pickCell(ctx, pool, forced, t, w, depthGuard) {
    const lat = ladderOf(ctx, pool, forced).lattice;
    const lk = (ctx.input.wx.sun || 0) + '#' + t + '#' + w;
    if (lat[lk] !== undefined) return lat[lk];
    if ((depthGuard || 0) > 400) return null;
    const cW = ctxAt(ctx, t, w), eW = extremities(cW, pool, cW.inp);
    const cellT = t < CHAIN_TOP ? pickCell(ctx, pool, forced, t + 1, w, (depthGuard || 0) + 1) : null;
    const wPrev = w <= 0 ? null : (w % 2 === 0 ? w - 2 : w - 1);
    const cellW = wPrev == null ? null : pickCell(ctx, pool, forced, t, wPrev, (depthGuard || 0) + 1);
    // rungs of the ladder for today's temperature and just below it, evaluated once for this cell
    const rungEvals = [];
    for (let tt = Math.min(CHAIN_TOP, t); tt >= Math.max(LADDER_BOTTOM, t - LADDER_SHORTCUT); tt--) {
      const e = ladderEntry(ctx, pool, forced, tt); if (!e) continue;
      const v = rungLegal(cW, e, pool, forced); if (!v) continue;
      const c = evalAt(cW, eW, v.tc, v.lc, tt); if (c) rungEvals.push(c);
    }
    let tcs = null, lcs = null; const evalCache = {};   // the full enumeration, only when a warm-up is needed; pairs scored once per cell
    const better = function (a, b) { return !b || a.hoursRaw > b.hoursRaw + 1e-9 || (Math.abs(a.hoursRaw - b.hoursRaw) < 1e-9 && a.S > b.S); };
    const byH = {};
    HOURS_LEVELS.forEach(function (h) {
      const prevT = cellT ? cellT.byH[h] : null, prevW = cellW ? cellW.byH[h] : null, prevH = h > 1 ? byH[h - 1] : null;
      const refsT = [prevT, prevW, prevH].filter(Boolean).map(function (r) { return { pieces: r.pieces.filter(function (x) { return x.key[0] === 't'; }) }; });
      const refsL = [prevT, prevW, prevH].filter(Boolean).map(function (r) { return { pieces: r.pieces.filter(function (x) { return x.key[0] === 'l'; }) }; });
      const ok = function (c) { return coherentWith(c.tc, c.lc, prevT) && coherentWith(c.tc, c.lc, prevW) && coherentWith(c.tc, c.lc, prevH); };
      let chosen = null, most = null;
      for (let k = 0; k < rungEvals.length; k++) {
        const c = rungEvals[k]; if (!ok(c)) continue;
        if (meetsAt(c, cW, h)) { chosen = c; break; }
        if (better(c, most)) most = c;
      }
      let cell = chosen;
      if (!cell) {
        if (!tcs) { tcs = torsoCombos(cW, pool, false, forced); lcs = legsCombos(cW, pool, false, forced); }
        // coherence is cheap and prunes hard: filter the torso and legs stacks against the references first, score after
        const empty = { stack: [] };
        const tcsOK = tcs.filter(function (tc) { return refsT.every(function (r) { return coherentWith(tc, empty, r); }); });
        const lcsOK = lcs.filter(function (lc) { return refsL.every(function (r) { return coherentWith(empty, lc, r); }); });
        let bestMeet = null, bestWarm = null;
        tcsOK.forEach(function (tc, i) { lcsOK.forEach(function (lc, j) {
          const key = stackKey(tc) + '|' + stackKey(lc);
          let c = evalCache[key]; if (c === undefined) { c = evalAt(cW, eW, tc, lc, t); evalCache[key] = c; }
          if (!c) return;
          if (meetsAt(c, cW, h) && (!bestMeet || c.cost < bestMeet.cost - 1e-9)) bestMeet = c;
          if (better(c, bestWarm)) bestWarm = c;
        }); });
        cell = bestMeet || (most && (!bestWarm || better(most, bestWarm)) ? most : bestWarm) || most || null;
        if (!cell) {
          // a legality cliff: nothing legal today is coherent with the neighbours — the cheapest legal outfit that
          // reaches the hours (a legal pick beats a coherent but illegal one)
          let bm = null, bw = null;
          tcs.forEach(function (tc) { lcs.forEach(function (lc) { const key = stackKey(tc) + '|' + stackKey(lc); let c = evalCache[key]; if (c === undefined) { c = evalAt(cW, eW, tc, lc, t); evalCache[key] = c; } if (!c) return; if (meetsAt(c, cW, h) && (!bm || c.cost < bm.cost - 1e-9)) bm = c; if (better(c, bw)) bw = c; }); });
          cell = bm || bw || null;
        }
        if (cell) cell = Object.assign({}, cell, { warmedUp: true });
      }
      if (cell) cell.rungT = cell.rungT == null ? t : cell.rungT;
      byH[h] = cell;
    });
    lat[lk] = { byH: byH };
    return lat[lk];
  }
  // the outfit for the actual hunt: its lattice cell, re-scored in this call's context (alternates, budget, the named
  // warmer option)
  function buildFromLadder(ctx, pool, ext, forced) {
    ctx.ref = null;
    const t = Math.max(LADDER_BOTTOM, Math.min(CHAIN_TOP, Math.round(ctx.tempF))), w = Math.max(0, Math.round(ctx.input.wx.windMph || 0));
    const h = Math.max(1, Math.min(6, Math.round(ctx.sitHours || 3)));
    const cellAll = pickCell(ctx, pool, forced, t, w, 0);
    const cell = cellAll ? cellAll.byH[h] : null;
    if (!cell) return null;
    const tcs = torsoCombos(ctx, pool, false, forced), lcs = legsCombos(ctx, pool, false, forced);
    const sc = score(ctx, cell.tc, cell.lc, ext.clo);
    const best = sc ? { tc: cell.tc, lc: cell.lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, rungT: cell.rungT } : Object.assign({}, cell);
    best.hoursRaw = phaseHours(ctx, best.S, best.tc.outerWind);
    best.meets = ctx.key === 'sit' ? best.hoursRaw >= ctx.sitHours - 1e-9 : met(best.S, best.R);
    // the warmest legal outfit for the REAL weather (honest readout / the named warmer option); never worn
    let bMax = null, maxS = 0, maxEff = 0;
    tcs.forEach(function (tc) { lcs.forEach(function (lc) {
      const s2 = score(ctx, tc, lc, ext.clo); if (!s2) return;
      if (s2.S > maxS) maxS = s2.S;
      const eff = s2.S * s2.tg.neu.CF;
      if (eff > maxEff + 1e-9) { maxEff = eff; bMax = { tc: tc, lc: lc, S: s2.S, R: s2.R, cost: s2.cost, tg: s2.tg }; }
    }); });
    best.maxS = maxS; best.maxEff = maxEff; best.open = false; best.bMax = bMax; best.warmer = null;
    if (!best.meets && bMax && maxEff >= best.S * best.tg.neu.CF + TUNE.warmerMinGain && phaseHours(ctx, bMax.S, bMax.tc.outerWind) > best.hoursRaw + 0.4) best.warmer = bMax;
    best.altT = altsFor(ctx, best, tcs, true, ext.clo);
    best.altL = altsFor(ctx, best, lcs, false, ext.clo);
    return best;
  }
  // choose the outfit for a phase; returns {tc, lc, S, R, maxS, maxEff, warmer, altT, altL, rungT?}
  function buildOutfit(ctx, pool, ext, forced, open) {
    if (open || ctx.depth > 0 || ctx.key === 'walk' || (forced && forced.legsBase) || !TUNE.cost.stability) return buildCheapest(ctx, pool, ext, forced, open);
    return buildFromLadder(ctx, pool, ext, forced);
  }
  function stackKey(c) { return c.stack.map(function (s) { return s.role + ':' + s.it.id; }).join('|'); }
  function altsFor(ctx, best, combos, torso, extClo) {
    const ref = torso ? best.tc : best.lc, refRoles = ref.stack.map(function (s) { return s.role; });
    const alts = {};
    combos.forEach(function (c) {
      // must differ from the chosen stack in exactly one role (swap) or by dropping one optional role
      const roles = c.stack.map(function (s) { return s.role; });
      let diff = 0, role = null, dropped = false;
      refRoles.forEach(function (r, k) {
        const mine = c.stack.find(function (s) { return s.role === r; });
        if (!mine) { diff++; role = r; dropped = true; }
        else if (mine.it.id !== ref.stack[k].it.id) { diff++; role = r; }
      });
      const added = roles.filter(function (r) { return refRoles.indexOf(r) < 0; });
      added.forEach(function (r) { diff++; role = r; });
      // two-piece alternate: a different OUTER with an INSUL added under it (e.g. HD Flex over the Proximity instead of the Gale Force)
      if (torso && diff === 2 && added.length === 1 && added[0] === 'insul' && refRoles.indexOf('outer') >= 0) {
        const oMine = c.stack.find(function (s) { return s.role === 'outer'; }), oRef = ref.stack.find(function (s) { return s.role === 'outer'; });
        const iMine = c.stack.find(function (s) { return s.role === 'insul'; });
        if (oMine && oRef && oMine.it.id !== oRef.it.id && iMine) {
          const sc2 = score(ctx, c, best.lc, extClo);
          if (sc2 && sc2.cost <= best.cost + TUNE.altMargin + 1.0) {
            alts.outer = alts.outer || [];
            const quieter = loudness(c) < loudness(ref);
            alts.outer.push({ id: oMine.it.id, name: oMine.it.name + ' over the ' + iMine.it.name, cost: sc2.cost + 0.001, why: (quieter ? 'quieter two-piece option' : 'two-piece option') + (c.flags.indexOf('snug') >= 0 ? ' (snug — size up the shell)' : '') });
          }
        }
        return;
      }
      if (diff !== 1 || !role) return;
      const sc = torso ? score(ctx, c, best.lc, extClo) : score(ctx, best.tc, c, extClo);
      if (!sc || sc.cost > best.cost + TUNE.altMargin) return;
      const mine = c.stack.find(function (s) { return s.role === role; });
      alts[role] = alts[role] || [];
      alts[role].push({ id: dropped ? null : mine.it.id, name: dropped ? 'skip it' : mine.it.name, cost: sc.cost, why: dropped ? 'optional — leave it off if you run warm' : (sc.S < best.S - 0.03 ? 'lighter option' : sc.S > best.S + 0.03 ? 'warmer option' : 'about the same') });
    });
    Object.keys(alts).forEach(function (r) {
      const seen = {};
      alts[r] = alts[r].sort(function (a, b) { return a.cost - b.cost; }).filter(function (a) { const k = (a.id || '_skip') + '|' + a.name; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 2).map(function (a) { return { id: a.id, name: a.name, why: a.why }; });
    });
    return alts;
  }

  // ---------- plain-language "why" per role ----------
  function whyTorso(s, c, ctx, idx, n) {
    const it = s.it;
    if (s.role === 'base') return idx === n - 1 ? 'alone — nothing over it' : 'next to skin';
    if (s.role === 'mid') return it.ins === 'merino' ? 'merino mid over the base' : 'fleece over the base';
    if (s.role === 'insul') return c.flags.indexOf('snug') >= 0 ? 'your warmth — under the rain shell (snug; size up the shell)' : 'your warmth — under the shell';
    if (s.role === 'shell') return 'stays on under the ' + (s.under || 'stop layer');
    // outer
    if (it.combo) return ctx.wet ? 'insulated & waterproof — it is the whole outer' : 'insulated, windproof outer';
    if (it.wp === 2) return ctx.wet ? 'rain shell over everything' : (ctx.windy ? 'windproof shell on top' : 'shell on top');
    if (it.ins === 'down' || (it.ins === 'syn' && it.fit === 'outer')) return ctx.windy ? 'worn as your outer — windproof face' : 'worn as your outer';
    if (it.fit === 'outer') return ctx.windy ? 'soft shell — blocks the wind' : 'soft-shell outer';
    return 'light outer for a calm day';
  }
  function whyLegs(s, c, ctx) {
    const it = s.it;
    if (s.role === 'base') return it.clo >= 0.25 ? 'insulated base under your pants' : 'fleece base under your pants';
    if (s.role === 'wader') return 'your waterproofing — everything layers under it';
    if (s.role === 'overpant') return (ctx.wet ? 'waterproof over the top' : 'wind block over the top') + (c.flags.indexOf('snug') >= 0 ? ' (size up)' : '');
    if (it.combo) return ctx.key === 'walk' ? 'insulated & waterproof — side zips open on the walk in' : 'insulated & waterproof — over a base only';
    if (it.quiet >= 9) return 'quiet soft-shell pant';
    if (it.clo <= 0.16) return 'lightweight & vented';
    return it.id === 'probrush_pant' ? 'brush protection' : 'all-rounder';
  }
  function renderOutfit(ctx, b) {
    const torso = b.tc.stack.map(function (s, k) { const ex = { fit: s.fit || s.it.fit, alt: ((b.altT && b.altT[s.role]) || []).slice() }; if (s.tag) ex.tag = s.tag; if (s.snug) ex.snug = true; return pick(s.it, s.role, whyTorso(s, b.tc, ctx, k, b.tc.stack.length), ex); });
    const legs = b.lc.stack.map(function (s) { return pick(s.it, s.role, whyLegs(s, b.lc, ctx), { alt: ((b.altL && b.altL[s.role]) || []).slice() }); });
    // alternates that ADD a role the stack does not have ("or add a fleece") hang off the nearest row
    const addTo = function (rows, role, alts, host, phrase) {
      if (!alts || !alts.length) return;
      const row = rows.find(function (p) { return p.role === host; }) || rows[rows.length - 1];
      if (!row) return;
      alts.forEach(function (a) { if (a.id && !row.alt.some(function (x) { return x.id === a.id; })) row.alt.push({ id: a.id, name: a.name, why: phrase }); });
    };
    if (b.altT) { addTo(torso, 'mid', b.altT.mid && !torso.some(function (p) { return p.role === 'mid'; }) ? b.altT.mid : null, 'base', 'or add it over the base'); addTo(torso, 'insul', b.altT.insul && !torso.some(function (p) { return p.role === 'insul'; }) ? b.altT.insul : null, 'outer', 'or add it under the shell'); addTo(torso, 'outer', b.altT.outer && !torso.some(function (p) { return p.role === 'outer'; }) ? b.altT.outer : null, 'base', 'or add it on top'); }
    if (b.altL) { addTo(legs, 'base', b.altL.base && !legs.some(function (p) { return p.role === 'base'; }) ? b.altL.base : null, 'pant', 'or add it under the pant'); addTo(legs, 'overpant', b.altL.overpant && !legs.some(function (p) { return p.role === 'overpant'; }) ? b.altL.overpant : null, 'pant', 'or add it over the top'); }
    torso.forEach(function (p) { p.alt = p.alt.slice(0, 3); }); legs.forEach(function (p) { p.alt = p.alt.slice(0, 3); });
    return { torso: torso, legs: legs };
  }

  // ---------- walk-in outfit (deer medium; addendum C) ----------
  // You walk in wearing the sit's base and its fleece mid (zips open) and the sit's legs; the enumeration adds a soft
  // shell / plain shell only if the walk target needs it. The insulated outer (and the shell over it) is carried.
  // In RAIN the whole sit stack goes on at the truck, vents open — no layer changes in the rain — and nothing is carried.
  function buildWalk(ctxWalk, sit, pool, ext) {
    const sitStack = sit.tc.stack;
    if (ctxWalk.wet) {
      // RAIN (round 7 addendum): everything on from the truck — with ONE allowed swap: an insulated piece that the sit wears
      // UNDER the shell (Proximity / Super Down PRO under HD Flex or Kutana) is carried, not walked in; at the stand it is
      // shell off, puffy on, shell back on (a 30-second swap under cover). Never for a fleece — that is walked in.
      const ins = sitStack.find(function (s) { return s.role === 'insul'; });
      const outer = sitStack.find(function (s) { return s.role === 'outer'; });
      if (ins && outer && outer.it.wp === 2 && ins.it.clo >= TUNE.rainSwapMinClo) {
        const b0 = sitStack[0].it, m0 = (sitStack.find(function (s) { return s.role === 'mid'; }) || {}).it || null;
        // the walk stack is the sit's own (already matrix-valid) stack minus the puffy: validate it open (the HD Flex with
        // nothing under it is tolerated for the walk only) and as non-moving (the shell is the sit's, worn in with vents open)
        const tc = validTorso(Object.assign({}, ctxWalk, { moving: false, key: 'sit' }), b0, m0, null, outer.it, true, null);
        const sc = tc ? score(ctxWalk, tc, sit.lc, ext.clo, true) : null;
        if (tc && sc) return Object.assign({}, sit, { tc: tc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, altT: {}, altL: {}, rainWalk: true, rainSwap: ins.it });
      }
      return Object.assign({}, sit, { altT: {}, altL: {}, rainWalk: true });
    }
    const base = sitStack[0].it;
    const mid = (sitStack.find(function (s) { return s.role === 'mid'; }) || {}).it || null;
    const sitIds = new Set(sitStack.map(function (s) { return s.it.id; }));
    const forced = { legsBase: sit.lc.stack.slice(), walkBase: base, walkMid: mid };
    // stage 1 (round 7): the sit's base and fleece mid — or the Peloton 200 added over the base when the sit has no mid
    // (it is then worn on stand too, under the insulation) — never a soft shell that would ride out in the pack
    const poolFleece = pool.filter(function (it) { return it.slot !== 'torso' || it.id === base.id || (mid && it.id === mid.id) || torsoClass(it) === 'fleece'; });
    let w = buildOutfit(ctxWalk, poolFleece, ext, forced);
    if (w && met(w.S, w.R)) { w.sitIds = sitIds; return w; }
    // stage 2: a soft shell may be added on the walk (dry); a plain rain shell only in real wind; nothing insulated is walked in
    const walkPool = pool.filter(function (it) {
      if (it.slot !== 'torso') return true;
      if (it.id === base.id || (mid && it.id === mid.id)) return true;
      const c = torsoClass(it);
      if (c === 'fleece' || c === 'softshell') return true;
      if (c === 'shell' && ctxWalk.windBody >= TUNE.moveShellWindMin) return true;
      return false;
    });
    w = buildOutfit(ctxWalk, walkPool, ext, forced);
    if (!w) w = buildOutfit(ctxWalk, walkPool, ext, forced, true);
    if (w) w.sitIds = sitIds;
    return w;
  }
  // the walk-in put the Peloton 200 over the sit's base: the sit wears it too (under the insulation) when the matrix allows
  function augmentSitWithMid(ctxSit, sit, midIt, ext) {
    const st = sit.tc.stack;
    if (st.some(function (s) { return s.it.id === midIt.id; })) return sit;
    const b = st[0].it, i = (st.find(function (s) { return s.role === 'insul'; }) || {}).it || null, o = (st.find(function (s) { return s.role === 'outer'; }) || {}).it || null;
    if (st.some(function (s) { return s.role === 'mid'; })) return sit;
    const tc = validTorso(ctxSit, b, midIt, i, o, false, null); if (!tc) return sit;
    const sc = score(ctxSit, tc, sit.lc, ext.clo); if (!sc) return sit;
    return Object.assign({}, sit, { tc: tc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, augmented: true });
  }
  // ---------- optional outer: a phase that ends without an outer may offer one for wind / breaks ----------
  function optionalOuter(ctx, b, pool, ext) {
    if (ctx.wet) return null;
    if (ctx.tempF >= TUNE.noSoftshellAboveF) return null;                    // warm: nothing to add
    const st = b.tc.stack;
    if (st[st.length - 1].role === 'outer') return null;
    const base = st[0].it, mid = st.length > 1 ? st[1].it : null;
    const lim = TUNE.optOvershoot[ctx.mode] != null ? TUNE.optOvershoot[ctx.mode] : TUNE.optOvershoot.default;
    let best = null;
    pool.filter(function (it) { return it.slot === 'torso' && it.pos.indexOf('outer') >= 0 && it.fit === 'outer' && (!ctx.moving || it.active) && !st.some(function (s) { return s.it.id === it.id; }) && elig(it, ctx, TUNE.optWiden)
        && !(it.wp === 2 && it.ins === 'none' && ctx.windBody < 10); })   // a plain rain shell is only a sensible dry-day option in real wind
      .forEach(function (o) {
        const v = validTorso(ctx, base, mid, null, o); if (!v) return;
        const sc = score(ctx, v, b.lc, ext.clo, true); if (!sc) return;
        if (sc.S - sc.R > lim) return;
        if (!best || sc.cost < best.cost) best = { it: o, cost: sc.cost };
      });
    return best ? best.it : null;
  }
  // ---------- still-hunt stop layer (addendum C) ----------
  // The stop piece goes ON OVER the moving stack when the matrix allows it (over base / fleece: YES; a down puffy over a
  // soft shell: SNUG), otherwise it REPLACES the moving outer (soft shell or plain shell to the pack). In rain there are
  // no layer changes at stops: the moving kit is re-scored and, if it runs short, the stops are kept short.
  // STOP-PIECE COHERENCE (round 7): the carried piece has its own canonical chain — built at calm / no sun / 3 h along
  // the temperature, each step referenced to the step above — and the actual hunt reads the chain at the canonical
  // temperature of the moving rung it is wearing (move.rungT). The rung is monotone in temperature and wind, so the
  // reference is too; the real stop still re-scores at the real weather, and leaves the reference piece only when it
  // runs short there (which is itself monotone in wind) — one change, never a flip back.
  function stopRef(ctxStop, move, pool, forced) {
    if (ctxStop.depth > 0 || !TUNE.cost.stopStability || move.rungT == null) return null;
    const want = move.rungT;
    const cMoveSig = makeCtx(canonicalInput(ctxStop.input, want), 'move');
    const ladder = ladderOf(cMoveSig, pool, forced), chain = ladder.stop;
    if (chain[want] !== undefined) return chain[want];
    let start = CHAIN_TOP; while (start > want && chain[start] !== undefined) start--;
    for (let t = start; t >= want; t--) {
      if (chain[t] !== undefined) continue;
      const inp = canonicalInput(ctxStop.input, t);
      const cMove = makeCtx(inp, 'move');
      const mv = ladderEntry(cMove, pool, forced, t);
      let piece = null;
      if (mv) {
        const cS = makeCtx(inp, 'stop'); cS.depth = 1; cS.stopRef = (t + 1 <= CHAIN_TOP) ? chain[t + 1] : null;
        const eS = extremities(cS, pool, inp);
        const st = buildStop(cS, { tc: mv.tc, lc: mv.lc }, pool, eS, forced);
        piece = st && st.piece ? st.piece.id : null;
      }
      chain[t] = piece;
    }
    return chain[want];
  }
  function buildStop(ctxStop, move, pool, ext, forced) {
    const moveOuter = move.tc.outer;
    const notWorn = function (it) { return !move.tc.stack.some(function (s) { return s.it.id === it.id; }); };
    if (ctxStop.depth === 0) ctxStop.stopRef = stopRef(ctxStop, move, pool, forced);
    const refId = ctxStop.stopRef || null;
    const stopShort = function (S, R) { return ctxStop.tempF < TUNE.stopNeverShortF && hoursOfComfort(S, R, ctxStop.sitHours) < TUNE.stopMinHours; };
    const rescore = function (enough) {
      const sc = score(ctxStop, move.tc, move.lc, ext.clo, true);
      if (!sc) return null;
      return { tc: move.tc, lc: move.lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, piece: null, flags: [], maxS: sc.S, short: enough ? false : stopShort(sc.S, sc.R), enough: !!enough };
    };
    // the moving kit already holds the stop target (+ tolerance) standing still: nothing to carry
    const moveSc = score(ctxStop, move.tc, move.lc, ext.clo, true);
    if (moveSc && moveSc.S >= moveSc.R + TUNE.deficitTol) return rescore(true);
    // rain: no layer changes at stops (nothing you own goes on over or under a wet shell without a strip-down)
    if (ctxStop.wet) return rescore(false);
    let cands = pool.filter(function (it) { return it.slot === 'torso' && it.fit === 'outer' && (it.ins === 'syn' || it.ins === 'down') && elig(it, ctxStop, TUNE.insulCapOver) && notWorn(it); });
    // the insulated rain shell is a frigid piece — not the thing to pull on at a 40-degree dry stop when a quieter puffy fits
    if (ctxStop.tempF > TUNE.comboDryMaxF && cands.some(function (c) { return !c.combo; })) cands = cands.filter(function (c) { return !c.combo; });
    // nothing insulated fits (mild day): a soft shell goes on at stops instead; never a plain rain shell on a dry day
    if (!cands.length) {
      cands = pool.filter(function (it) { return it.slot === 'torso' && torsoClass(it) === 'softshell' && elig(it, ctxStop, TUNE.optWiden) && notWorn(it); });
      if (ctxStop.tempF >= TUNE.noOuterAboveF) cands = [];
    }
    if (moveOuter.combo || moveOuter.terminal) cands = [];
    if (!cands.length) return rescore(false);
    let best = null, maxS = 0; const scored = [];
    const outerIdx = move.tc.stack.length - 1, movingOuterRole = move.tc.stack[outerIdx].role;
    cands.forEach(function (c) {
      // (a) over everything; (b) replacing the moving outer (when it is an outer-role piece)
      const options = [];
      const over = canOver(c, move.tc.stack);
      if (over.ok !== 'NO') options.push({ under: move.tc.stack.slice(), replaced: null, snug: over.ok === 'SNUG' ? over.why : null });
      if (movingOuterRole === 'outer' && outerIdx >= 1) {
        const under = move.tc.stack.slice(0, outerIdx);
        const rep = canOver(c, under);
        if (rep.ok !== 'NO') options.push({ under: under, replaced: move.tc.stack[outerIdx].it, snug: rep.ok === 'SNUG' ? rep.why : null });
      }
      options.forEach(function (op) {
        const mult = {}, flags = [];
        if (op.snug) { flags.push('snug'); mult[c.id] = TUNE.compress[c.ins] || 1; }
        const snugW = op.snug ? 1 : 0;
        const stack = op.under.map(function (s) {
          if (s.role !== 'outer') return { it: s.it, role: s.role, fit: s.fit };
          // the former outer now sits under the stop piece: role 'shell', tagged SHELL (rain shell) or MID (soft shell / fleece)
          return { it: s.it, role: 'shell', fit: s.fit, under: c.name, tag: (s.it.wp === 2 && s.it.ins === 'none') ? 'SHELL' : 'MID' };
        });
        stack.push({ it: c, role: 'outer', fit: c.fit, snug: !!op.snug });
        const tc = { stack: stack, mult: mult, flags: flags, snugWhy: op.snug, snugW: snugW, outerWind: c.wind, outer: c, replaced: op.replaced };
        const sc = score(ctxStop, tc, move.lc, ext.clo, true);
        if (!sc) return;
        sc.cost += (TUNE.cost.carryWeight - TUNE.cost.weight) * (c.w || 0);   // it rides in the pack all day
        if (op.replaced) sc.cost += TUNE.cost.layer * 0.5;                     // a swap is one more thing to do at every stop
        scored.push({ c: c, sc: sc, tc: tc, flags: flags, replaced: op.replaced });
      });
    });
    // hysteresis: stay with the piece carried 1 degF warmer unless it now runs short by more than deficitTol
    const refCand = refId ? scored.find(function (x) { return x.c.id === refId; }) : null;
    const refShort = refCand ? (refCand.sc.R - refCand.sc.S > TUNE.deficitTol) : true;
    scored.forEach(function (x) {
      const sc = x.sc;
      if (refCand && !refShort && x.c.id !== refId) sc.cost += TUNE.cost.stopStability;
      if (sc.S > maxS) maxS = sc.S;
      if (!best || sc.cost < best.cost) best = { tc: x.tc, lc: move.lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, piece: x.c, flags: x.flags, replaced: x.replaced, snugWhy: x.tc.snugWhy };
    });
    if (!best) return rescore(false);
    best.maxS = maxS; best.short = stopShort(best.S, best.R);
    return best;
  }

  // ---------- main ----------
  function recommend(input) {
    const mode = input.mode || 'deer', act = input.act || 'light', wfEnv = input.wfEnv || 'marsh';
    const gearAll = (input.gear || CATALOG).filter(function (it) { return it && it.slot; });
    let pool = gearAll.filter(function (it) { return !it.disc || it.disc.indexOf(mode) >= 0; });
    if (input.packed) pool = pool.filter(function (it) { return input.packed.has(it.id); });
    const flags = [], notes = [], gaps = [], phases = [];
    const wx = input.wx;
    const fmtW = function (c) { return Math.round(c.windBody); };

    // carry = pieces (torso, legs, head/neck/hands) worn in `ph` that were not worn in `prev`
    function carryDiff(ph, prev, why) {
      const prevIds = new Set([].concat(prev.torso, prev.legs, prev.head, prev.neck, prev.hands).map(function (p) { return p.id; }));
      const out = [];
      [].concat(ph.torso, ph.legs, ph.head, ph.neck, ph.hands).forEach(function (p) { if (p.id && !p.opt && !prevIds.has(p.id)) out.push({ id: p.id, name: p.name, why: why }); });
      return out;
    }
    function phaseResult(ctx, b, ext, keyLabel, prev) {
      const ro = renderOutfit(ctx, b);
      const opt = optionalOuter(ctx, b, pool, ext);
      if (opt) ro.torso.push(pick(opt, 'outer', mode === 'upland' ? 'optional — for wind or glassing breaks' : (ctx.moving ? 'optional — if it is breezy' : 'optional — a light outer if it is breezy'), { opt: true }));
      const tg = targetFor(ctx, b.tc.outerWind), CF = tg.neu.CF;
      const cap = ctx.key === 'sit' ? TUNE.hoursCap : ctx.sitHours;
      const hours = (ctx.tempF >= TUNE.neverShortAboveF && ctx.key !== 'stop') ? cap : hoursOfComfort(b.S, tg.neutral, cap);
      const ph = { key: ctx.key, label: keyLabel, torso: ro.torso, legs: ro.legs,
        head: ext.head, neck: ext.neck, hands: ext.hands, feet: ext.feet, vest: ext.vest, carry: [],
        budget: { need: round2(b.R), have: round2(b.S), neutral: round2(tg.neutral), eff: round2(b.S * CF), needEff: round2(b.R * CF), maxEff: round2(b.maxEff != null ? b.maxEff : b.S * CF),
          short: ctx.key === 'stop' ? !!b.short : hours < ctx.sitHours, hours: hours, sitHours: ctx.sitHours, wct: ctx.wct, dressF: ctx.dressF, windBody: round2(ctx.windBody), met: ctx.met, outerWind: b.tc.outerWind, moving: !!ctx.moving,
          snug: b.tc.snugWhy || b.lc.snugWhy || null, rungT: b.rungT == null ? null : b.rungT } };
      if (b.warmer) ph.budget.warmer = { torso: b.warmer.tc.stack.map(function (s) { return s.it.name; }), legs: b.warmer.lc.stack.map(function (s) { return s.it.name; }) };
      if (prev) ph.carry = carryDiff(ph, prev, 'goes on when you stop');
      return ph;
    }

    // ----- forced pieces per mode -----
    const forced = {};
    if (mode === 'waterfowl' && wfEnv !== 'dry') { forced.wader = pool.find(function (it) { return it.slot === 'wader'; }) || null; if (!forced.wader) gaps.push('No waders in your kit for the marsh — running the dry-ground loadout instead.'); }
    if (mode === 'upland') { const pb = pool.find(function (it) { return it.id === 'probrush_pant'; }); if (pb) forced.pant = pb.id; }

    const mainKey = mode === 'upland' ? 'upland' : (mode === 'deer' && act === 'high') ? 'move' : 'sit';
    const ctxMain = makeCtx(input, mainKey);
    const extMain = extremities(ctxMain, pool, input);
    let main = buildOutfit(ctxMain, pool, extMain, forced);
    if (!main) main = buildOutfit(ctxMain, pool, extMain, forced, true);   // nothing admitted: open every window (trip mode)
    if (!main) {
      // essential gap
      const hasTop = pool.some(function (it) { return it.slot === 'torso' && it.pos.indexOf('base') >= 0; });
      const hasLegs = pool.some(function (it) { return (it.slot === 'legs' && it.pos.indexOf('pant') >= 0) || it.slot === 'wader'; });
      if (!hasTop) gaps.push('Nothing packed for your torso — you need a top.');
      if (!hasLegs) gaps.push('Nothing packed for your legs — you need pants or waders.');
      return { version: VERSION, phases: [], flags: flags, notes: notes, gaps: gaps.length ? gaps : ['Nothing packed fits this hunt.'] };
    }
    const labelMain = mainKey === 'sit' ? (mode === 'waterfowl' ? 'In the blind' : 'On stand') : mainKey === 'move' ? 'Moving' : 'Walking';
    let phMain = phaseResult(ctxMain, main, extMain, labelMain, null);
    phases.push(phMain);

    // ----- second phase -----
    if (mode === 'deer' && act === 'medium') {
      const ctxWalk = makeCtx(input, 'walk');
      const extWalk = extremities(ctxWalk, pool, input);
      extWalk.feet = extMain.feet;                 // you walk in the boots you will sit in
      const walk = buildWalk(ctxWalk, main, pool, extWalk);
      if (walk) {
        // a fleece mid worn in that the sit did not wear: the sit wears it too (it goes on under the insulation)
        if (!walk.rainWalk) {
          const wMid = walk.tc.stack.find(function (s) { return torsoClass(s.it) === 'fleece'; });   // worn as the mid, or as the outer on a calm walk
          if (wMid && !main.tc.stack.some(function (s) { return s.it.id === wMid.it.id; })) {
            const aug = augmentSitWithMid(ctxMain, main, wMid.it, extMain);
            if (aug.augmented) { main = aug; const ph2 = phaseResult(ctxMain, main, extMain, labelMain, null); phases[phases.indexOf(phMain)] = ph2; phMain = ph2; }
          }
        }
        const phWalk = phaseResult(ctxWalk, walk, extWalk, 'Walk in', null);
        phWalk.torso = phWalk.torso.filter(function (p) { return !p.opt; });          // no optional outers on the walk — the sit outer is what gets carried
        if (walk.rainWalk) {
          phWalk.torso.forEach(function (p) { if (p.role === 'outer') p.why = 'on from the truck — vents open on the walk'; });
          phWalk.budget.hours = ctxWalk.sitHours; phWalk.budget.short = false;
          if (walk.rainSwap) {
            // the one allowed rain swap: the under-shell puffy is carried in, not walked in
            phMain.carry = [{ id: walk.rainSwap.id, name: walk.rainSwap.name, why: 'carried in — goes on under the shell once you are settled' }];
            notes.push('At the stand: shell off, ' + walk.rainSwap.name + ' on, shell back on — a 30-second swap once you are settled.');
          } else {
            phMain.carry = [];
            notes.push('Rain: everything on from the truck with the vents open — no layer changes in the rain.');
          }
        } else {
          phMain.carry = carryDiff(phMain, phWalk, 'carried in — goes on once you are settled');
          // pieces worn on the walk that the sit does not wear (a soft shell added for the hike) come off at the stand
          const sitIds = new Set(phMain.torso.map(function (p) { return p.id; }));
          phWalk.torso.forEach(function (p) { if (p.id && !sitIds.has(p.id)) { p.why = 'for the walk — comes off at the stand'; notes.push('The ' + p.name + ' is for the walk in; it comes off when the carried layers go on.'); } });
          const wMid = phWalk.torso.find(function (p) { return p.role === 'mid'; });
          if (wMid) { wMid.why = 'worn in, zips open'; }
        }
        // the pant is worn in, never carried; the Gale Force pant walks in with its side zips open
        const gfPant = phWalk.legs.find(function (p) { const it = pool.find(function (x) { return x.id === p.id; }); return it && it.combo && p.role === 'pant'; });
        if (gfPant) notes.push('Gale Force pant on for the walk in — open the side zips until you\'re on stand.');
        const wFeet = phWalk.feet[0];
        if (wFeet && wFeet.id === 'hd_mud') { wFeet.why = 'the sit boot — lace-ups if the walk is long'; }
        phases.unshift(phWalk);
      }
    } else if (mode === 'deer' && act === 'high') {
      const ctxStop = makeCtx(input, 'stop');
      const extStop = extremities(ctxStop, pool, input);                      // standing still: the sit ladder (beanie, warmer glove)
      extStop.feet = extMain.feet;
      const stop = buildStop(ctxStop, main, pool, extStop, forced);
      if (stop && stop.piece) {
        const phStop = phaseResult(ctxStop, stop, extStop, 'At stops', phMain);
        phStop.torso.forEach(function (p) { if (p.id === stop.piece.id) p.why = stop.replaced ? ('pull on instead of the ' + stop.replaced.name + ' when you stop' + (stop.snugWhy ? ' (snug)' : '')) : (stop.snugWhy ? 'pull on over the soft shell when you stop (snug — size up)' : 'pull on over everything when you stop'); });
        phStop.carry = [{ id: stop.piece.id, name: stop.piece.name, why: 'rides in the pack — on at stops, off before you walk' }].concat(phStop.carry.filter(function (c) { return c.id !== stop.piece.id; }));
        phases.push(phStop);
        if (stop.snugWhy) flags.push({ kind: 'info', ic: '📏', txt: '<b>Snug combo.</b> ' + stop.snugWhy.charAt(0).toUpperCase() + stop.snugWhy.slice(1) + ' — it works, but it fits tight.' });
        if (stop.replaced) notes.push('At stops the ' + stop.piece.name + ' goes on instead of the ' + stop.replaced.name + ' — the ' + stop.replaced.name + ' rides in the pack while you sit.');
        if (stop.short) gaps.push('At stops this is the warmest you can throw on over the moving kit — keep the stops short.');
      } else if (stop && stop.short) {
        const phStop = phaseResult(ctxStop, stop, extStop, 'At stops', phMain);
        phStop.carry = phStop.carry.filter(function (c) { return ['head', 'neck', 'hands'].some(function (k) { return phStop[k].some(function (p) { return p.id === c.id; }); }); });
        phases.push(phStop);
        gaps.push(ctxStop.wet ? 'Rain: no layer changes at stops — the moving kit runs cold standing still, so keep the stops short.' : 'Nothing in your kit goes on over the ' + main.tc.outer.name + ' at stops — keep the stops short.');
      } else {
        notes.push(ctxStop.wet ? 'Rain: no layer changes at stops — the moving kit holds its warmth standing still at this temperature.' : 'Nothing extra needed at stops — the moving kit holds its warmth standing still at this temperature.');
      }
    }

    // ----- flags & notes (plain language) -----
    const ctx = ctxMain;
    const tempR = Math.round(wx.tempF), wb = fmtW(ctx);
    const mainOuter = main.tc.outer, mainLegsOuter = main.lc.stack[main.lc.stack.length - 1].it;
    const wetTorsoGap = ctx.wet && mainOuter.wp !== 2, wetLegsGap = ctx.wet && mainLegsOuter.wp !== 2;
    const hasOuter = mainOuter.fit === 'outer' || mainOuter.wind >= 1;
    if (ctx.windy) flags.push({ kind: 'warn', ic: '🌬️', txt: '<b>Gusts to ' + Math.round(wx.gustMph || wx.windMph || 0) + ' mph.</b> About ' + wb + ' mph reaches you ' + (mode === 'deer' ? 'in the timber' : 'in the open') + (hasOuter ? ' — your outer layer is the wind block.' : ' — warm enough that no wind layer is needed.') });
    if (ctx.rain) {
      if (!ctx.wet) flags.push({ kind: 'warn', ic: '🌧️', txt: '<b>Wet but warm.</b> Too warm to layer up — you will just take the rain.' });
      else if (wetTorsoGap || wetLegsGap) flags.push({ kind: 'warn', ic: '🌧️', txt: '<b>Wet window (' + Math.round(wx.pprob || 0) + '%).</b> Nothing you packed is waterproof for your ' + (wetTorsoGap && wetLegsGap ? 'torso or legs' : wetTorsoGap ? 'torso' : 'legs') + ' — you will wet through.' });
      else flags.push({ kind: 'warn', ic: '🌧️', txt: '<b>Wet window (' + Math.round(wx.pprob || 0) + '%).</b> Your waterproof layer goes on last — the warmth sits underneath it.' });
      if (wetTorsoGap) gaps.push('Nothing you own (or packed) is waterproof for the torso — the ' + mainOuter.name + ' will wet through; plan a short sit or stay under cover.');
      if (wetLegsGap) gaps.push('Nothing you own (or packed) is waterproof for the legs — the ' + mainLegsOuter.name + ' will wet through.');
    }
    const snugMain = main.tc.snugWhy || main.lc.snugWhy;
    if (snugMain) flags.push({ kind: 'info', ic: '📏', txt: '<b>Snug combo.</b> ' + snugMain.charAt(0).toUpperCase() + snugMain.slice(1) + ' — it works, but it fits tight.' });
    const mainShort = phMain.budget.short;
    if (mainShort) {
      const h = fmtHours(phMain.budget.hours);
      if (ctx.moving) {
        flags.push({ kind: 'warn', ic: '🧊', txt: '<b>Runs cold.</b> Even the warmest moving kit you own runs cold at ' + tempR + '° — keep moving, and keep the stops short.' });
        gaps.push('This is the warmest you own that still breathes on the move at ' + tempR + '°' + (ctx.windy ? ' with this wind' : '') + ' — keep moving.');
      } else if (phMain.budget.warmer) {
        const w = phMain.budget.warmer;
        const sameTorso = w.torso.join('|') === phMain.torso.filter(function (p) { return !p.opt; }).map(function (p) { return p.name; }).join('|');
        flags.push({ kind: 'warn', ic: '🧊', txt: '<b>Runs a little short.</b> This stack is good for ' + h + ' at ' + tempR + '°; ' + (sameTorso ? w.legs.join(' + ') + ' on the legs' : w.torso.join(' > ')) + ' would get you the full sit.' });
        gaps.push('This pick runs ' + h + ' at ' + tempR + '°' + (ctx.windy ? ' with this wind' : '') + '; the warmer option is ' + w.torso.join(' > ') + ' // ' + w.legs.join(' + ') + '.');
      } else {
        flags.push({ kind: 'warn', ic: '🧊', txt: '<b>Warmest you own.</b> Nothing in the closet gets a ' + ctx.sitHours + '-hour sit at ' + tempR + '° — figure on ' + h + ', or add heat packs.' });
        gaps.push('This is the warmest stack you own for ' + tempR + '°' + (ctx.windy ? ' with this wind' : '') + ' — plan on ' + h + '.');
      }
    }
    if (mode === 'deer' && ctx.blaze && mainKey === 'sit') flags.push({ kind: 'info', ic: '🟧', txt: 'Blaze shown (gun season) — Settings to turn off.' });
    if (mode === 'upland') flags.push({ kind: 'info', ic: '🔥', txt: '<b>Dressed to walk.</b> You make your own heat — this runs lighter than the ' + tempR + '° air. Start a touch cold.' });
    if (mode === 'deer' && act === 'high') flags.push({ kind: 'info', ic: '🚶', txt: '<b>Still-hunt.</b> Dressed to move; the insulation rides in the pack and goes on when you stop.' });
    if (mode === 'deer' && act === 'medium' && phMain.carry.length) flags.push({ kind: 'info', ic: '🚶', txt: '<b>Long walk in.</b> Hike in the Walk-in kit, then add the carried pieces once you are on stand.' });

    const worn = phMain.torso.filter(function (p) { return !p.opt; });
    const outerMain = worn[worn.length - 1];
    // a Walk-in card (deer medium) already says what goes on at the stand; the generic "walk in with X off" line would repeat it
    const hasWalkCard = phases.length > 1 && phases[0].key === 'walk';
    const rainShellOuter = ctx.wet && mainOuter.wp === 2;      // in rain the shell stays ON for the walk — never "walk in with the rain shell off"
    if (mainKey === 'sit') {
      if (hasWalkCard) { /* walk-in card + notes carry the instruction */ }
      else if (rainShellOuter) notes.push('Rain: everything on from the truck with the vents open — no layer changes in the rain.');
      else if (worn.length >= 3) notes.push('Dress for the sit. Walk in with the ' + outerMain.name + ' off and put it on once you are settled and cooling.');
      else if (ctx.tempF >= 45 && ctx.tempF < 60 && !mainShort && worn.length === 2 && !mainOuter.combo && mainOuter.ins !== 'down') notes.push('Light sit — ' + outerMain.name + ' over your base is all you need.');
      else if (ctx.tempF >= 60) notes.push('Warm sit — go light, hydrate, and watch for ticks.');
      else if (worn.length === 2) notes.push('Dress for the sit. Walk in with the ' + outerMain.name + ' off and put it on once you are settled.');
      if (ctx.wet && !wetTorsoGap && !rainShellOuter) notes.push('Rain shell goes on last; everything warm stays underneath it.');
      if (mode === 'waterfowl' && wfEnv !== 'dry') notes.push('The waders are your waterproofing — everything below the chest layers under them.');
      if (mode === 'waterfowl' && wfEnv === 'dry') notes.push('Dry-ground setup — boots and pants, no waders; stay out of standing water.');
    } else if (mainKey === 'move') {
      notes.push('Still-hunt loadout — dressed to move without soaking out. Strip a layer before you stop so the base dries.');
    } else if (mode === 'upland') {
      notes.push('You warm up in the first hundred yards — if you are comfortable at the truck, you are overdressed.');
      notes.push(phMain.torso.some(function (p) { return p.opt; }) ? 'Brush pants earn their keep busting cover; the soft shell is for wind and glassing breaks only.' : 'Brush pants earn their keep busting cover.');
    }
    if (ctx.wct <= 20) notes.push('Wind chill near ' + ctx.wct + '° on exposed skin — ' + (phMain.neck.length ? 'gaiter up and ' : '') + 'keep the gloves on.');
    // garment-reality notes (addendum A): the Encounter pant's leg zips and cuff snaps ride OVER a tall boot, never tucked;
    // only the Proximity and the Haven have a harness port — any other jacket added on stand goes on over the harness
    if (mainKey === 'sit' && phMain.legs.some(function (p) { return p.id === 'encounter_pant'; }) && phMain.feet.some(function (p) { return p.id === 'hd_mud'; })) notes.push('Encounter pant goes over the HD Mud Boot, not tucked in.');
    if (mode === 'deer' && mainKey === 'sit') {
      const noPort = phMain.carry.filter(function (c) { const it = pool.find(function (x) { return x.id === c.id; }); return it && it.slot === 'torso' && it.fit === 'outer' && !HARNESS_PORT[it.id]; });
      if (noPort.length) notes.push('The ' + noPort[0].name + ' has no harness port — it goes on over the harness.');
    }
    // camo note is the app's job (needs location); engine stays location-free

    return { version: VERSION, phases: phases, flags: flags, notes: dedupeNotes(notes, pool).slice(0, 5), gaps: gaps };
  }
  // drop a note when an earlier note already gives the same kind of instruction about the same piece
  // (e.g. "Swap to the X at the stand…" followed by "Dress for the sit. Walk in with the X off…")
  function dedupeNotes(notes, pool) {
    const names = pool.map(function (it) { return it.name; }).sort(function (a, b) { return b.length - a.length; });
    const seen = [], out = [];
    notes.forEach(function (n) {
      if (out.indexOf(n) >= 0) return;
      const named = names.filter(function (nm) { return n.indexOf(nm) >= 0; });
      let tpl = n; named.forEach(function (nm) { tpl = tpl.split(nm).join('#'); });
      const kind = /walk in|swap to|at the stand|goes on/i.test(tpl) ? 'stand' : tpl;
      const dup = seen.some(function (s) { return s.kind === kind && named.some(function (nm) { return s.named.indexOf(nm) >= 0; }); });
      if (dup) return;
      seen.push({ kind: kind, named: named }); out.push(n);
    });
    return out;
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  // debugging aid (harness/auditor): the n cheapest torso+legs outfits for the main phase, with their cost terms
  function debugCombos(input, n) {
    const mode = input.mode || 'deer', act = input.act || 'light';
    let pool = (input.gear || CATALOG).filter(function (it) { return it && it.slot && (!it.disc || it.disc.indexOf(mode) >= 0); });
    if (input.packed) pool = pool.filter(function (it) { return input.packed.has(it.id); });
    const key = mode === 'upland' ? 'upland' : (mode === 'deer' && act === 'high') ? 'move' : 'sit';
    const ctx = makeCtx(input, key), ext = extremities(ctx, pool, input);
    const forced = {};
    if (mode === 'waterfowl' && (input.wfEnv || 'marsh') !== 'dry') forced.wader = pool.find(function (it) { return it.slot === 'wader'; }) || null;
    if (mode === 'upland') { const pb = pool.find(function (it) { return it.id === 'probrush_pant'; }); if (pb) forced.pant = pb.id; }
    const rows = [];
    torsoCombos(ctx, pool, false, null).forEach(function (tc) { legsCombos(ctx, pool, false, forced).forEach(function (lc) {
      const sc = score(ctx, tc, lc, ext.clo); if (!sc) return;
      rows.push({ torso: tc.stack.map(function (x) { return x.it.name; }).join(' > '), legs: lc.stack.map(function (x) { return x.it.name; }).join(' + '), S: round2(sc.S), R: round2(sc.R), cost: round2(sc.cost), layers: tc.stack.length + lc.stack.length, loud: loudness(tc) + loudness(lc), kg: round2(weight(tc) + weight(lc)) });
    }); });
    return rows.sort(function (a, b) { return a.cost - b.cost; }).slice(0, n || 10);
  }

  return {
    VERSION: VERSION, TUNE: TUNE, CATALOG: CATALOG, ROLE_LABEL: ROLE_LABEL, ROLE_ORDER: ROLE_ORDER,
    requiredClo: requiredClo, targetClo: targetClo, sitNeutral: sitNeutral, sitTarget: sitTarget, hoursOfComfort: hoursOfComfort, fmtHours: fmtHours, windChill: windChill,
    canOver: canOver, canOverLegs: canOverLegs, CAN_OVER: CAN_OVER, torsoClass: torsoClass, legsClass: legsClass,
    estimateClo: estimateClo, normalizeCustom: normalizeCustom, applyOverrides: applyOverrides, recommend: recommend, debugCombos: debugCombos
  };
});
