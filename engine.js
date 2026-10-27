/* KUIU Field Kit — engine.js  v2.00
 * Pure JS warmth-budget stack builder. No DOM. Runs in the browser (window.FK) and in Node (module.exports).
 * Spec: docs/SPEC-v2.00.md.  Science: ISO 11079 IREQ (required insulation), ISO 9920 (garment clo, ensemble sum,
 * wind/permeability correction).  Calibration notes: docs/TUNING-NOTES.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2.00';

  /* ================================================================================================
   * 1. TUNABLES — every calibration constant lives here
   * ============================================================================================== */
  const TUNE = {
    // metabolic rate (MET) per hunt phase
    met: { deer_sit: 1.2, deer_walk: 2.5, deer_still: 2.0, deer_stop: 1.2, upland: 3.0, wf_sit: 1.3 },
    // target position between ISO "minimal" (acceptable cooling) and "neutral" (no cooling): 0 = start cold, 1 = neutral
    K: { sit: 0.75, walk: 0.4, still: 0.5, stop: 0.0, upland: 0.75 },   // K.sit is the 3-hour value; sits use Ksit below
    Ksit: [[1, 0.45], [2, 0.60], [3, 0.75], [4, 0.82], [6, 0.90]],      // sit length (h) -> K, interpolated: a longer sit is dressed closer to ISO neutral
    sitFactor: 0.04,                                         // ...and the target itself scales by (1 + sitFactor x (hours - 3)): a 6-hour sit +12%, a 1-hour sit -8%
    stopFactor: 0.88,                                        // a 20-30 min stop is dressed lighter than a 3-hour sit (fraction of the stop target)
    // hunter calibration of the ISO static requirement (ISO neutral is a lab no-cooling criterion; see TUNING-NOTES)
    cal: 0.61,
    // fraction of the forecast 10 m wind that reaches the body
    windAtBody: { deer: 0.5, deer_still: 0.5, upland: 0.9, wf_marsh: 0.7, wf_dry: 0.9 },   // marsh blinds/brush give some shelter; dry field / pass shooting is open
    // outer-layer wind rating -> air permeability (l/m2s) for the ISO 9920 correction
    perm: { 0: 1000, 1: 8, 2: 1 },
    seated: 0.90,                                            // ISO 9920 seated compression of the ensemble
    compress: { down: 0.90, syn: 0.95, fleece: 1.0, merino: 1.0, none: 1.0 },  // puffy under a (snug) shell
    outerOverOuter: 0.85,                                    // same-size outer-fit piece thrown over an outer-fit piece
    wetNoShell: { down: 0.3, syn: 0.55, fleece: 0.6, merino: 0.7, none: 1 },  // soaked, no membrane over it
    wetTooWarmF: 75,                                         // above this, rain is just taken — no shell forced
    wetProb: 40, wetIn: 0.02,                                // what counts as "wet" (precip prob % / inches)
    windyGust: 20, windyWind: 15,                            // what counts as "windy" (forecast mph)
    legShare: 0.18,                                          // legs clo >= legShare x (torso + legs) clo (a floor only — the leg priors do the real balancing)
    torsoShare: 0.5, torsoShareMinLegs: 0.7,                // legs stack >= 0.7 clo (bib / over-pant) => torso must be >= 50% of torso+legs (no 'heating the legs to cover the core')
    sumA: 0.835, sumB: 0.161,                                // ISO 9920 ensemble: Icl = A * sum(Iclu) + B
    sunC: { 0: 0, 1: 4, 2: 8 },                              // sky -> degC added to the radiant temperature
    dressOffset: { sit: 0, walk: 12, still: 10, upland: 14 },// eligibility-window shift by activity (deg F)
    optWiden: 6,                                             // eligibility widening for alternates (deg F)
    altMargin: 1.0,                                          // cost margin for an alternate to be shown
    peelSlack: 0.3,                                          // walk-in sub-stack may exceed its target by this much
    // eligibility is soft: a piece outside its tmin-tmax window pays cost.outOfBand per degF of distance (so a piece 4 deg
    // out beats one 8 deg out), with two hard limits: a warm-weather piece (tmin more than oobWarmIn above the dressed
    // temp) is never pulled into a cold stack, and a piece more than oobColdIn below its tmax is left out of the enumeration.
    // A last-resort pass with every window open runs only when nothing legal exists at all (trip mode).
    oobWarmIn: 20, oobColdIn: 25,
    // SMOOTH cost (round 3): there is no "must meet the target" gate any more — a shortfall above deficitTol is simply
    // expensive (12/clo), overshoot is cheap (1/clo), so a quiet stack a hair short beats a loud one a hair over, and
    // neighbouring temperatures choose neighbouring stacks instead of flipping on 0.05-clo differences.
    cost: { deficit: 12, overshoot: 1.0, layer: 0.35, loud: 0.2, weight: 0.2, carryWeight: 0.6, specialist: 0.25, outOfBand: 0.12, outOfBandCold: 0.08, outOfBandSq: 0.02, snug: 0.6,
      basePrior: 4.0,        // per 0.1 clo the base layer deviates from the expected base warmth for the dressed temp (see basePrior below)
      legsBasePrior: 2.0,    // same for the base bottom and the pant (legsBasePrior / pantPrior tables)
      stability: 2.0,        // per piece worn 2 degF warmer that this stack DROPS (coherence: colder = add or swap warmer, never drop)
      dropBelowRef: 12,      // per clo this stack is COLDER than the pick 2 degF warmer (monotonic warmth)
      lighterSwap: 1.0,      // per role swapped for a LIGHTER piece than the 2-degF-warmer stack wore
      shellNoInsul: 3.0,     // HD Flex (sized over a puffy) worn, wet or dry, with nothing insulated under it (the Kutana is the plain rain shell)
      noOuterCold: 2.0,      // moving phase with wind chill below moveOuterBelowF and no outer at all
      stopStability: 1.5,    // still-hunt: changing the carried stop piece from the one chosen 1 degF warmer (hysteresis; waived when that piece now runs short)
      shortSwitch: 0 },      // (disabled) switching to a not-short stack when the cheapest runs short re-creates a cliff at the
                             // temperature where that stack turns short too; the honest readout + `warmer` alternative is used instead
    // expected base-layer warmth by dressed degF (piecewise linear): a tee in the heat, a 200-weight through the 40s-50s,
    // the insulated Vital PRO below the high 30s. Keeps the base from flip-flopping as other layers do the work.
    basePrior: [[60, 0.12], [55, 0.16], [50, 0.22], [47, 0.22], [43, 0.25], [36, 0.32]],   // tee -> light LS -> stand shirt / 200 merino -> insulated base
    legsBasePrior: [[52, 0], [48, 0.17], [38, 0.17], [34, 0.28]],
    legsBaseMoveShift: 10,   // degF: on moving phases the base-bottom prior is read this much warmer (fleece btm < 38 dressF, Vital btm < 24)
    pantPrior: [[70, 0.15], [62, 0.24], [46, 0.24], [40, 0.32]],                             // Tiburon -> Attack -> Encounter (a forced pant, e.g. Pro Brush, is exempt)
    noOuterAboveF: 66,                                       // a DRY sit this warm wears no rain shell / insulated outer, however it blows (the ISO wind term over-asks at 70F)
    noSoftshellAboveF: 70,                                   // ...and no soft shell above this
    comboDryMaxF: 32,                                        // the Gale Force jacket is worn on a DRY sit only at/below this (it is the wet/frigid outer)
    bibDryMaxF: 34,                                          // ...and the Gale Force bib goes over a pant on a dry sit only at/below this (or in real wind)
    moveOuterBelowF: 30,                                     // moving phases: below this wind chill an outer is required, not optional
    walkComboBelowF: 20,                                     // the long walk-in wears the insulated rain shell only when it is this cold (else: plain shell, carry it)
    stopMinHours: 1, stopNeverShortF: 50,                    // a stop is 20-30 min: only "short" when under an hour, never at 50F+
    warmerMinGain: 0.10,                                     // a "would get you the full sit" alternative must supply at least this much more clo (no rounding artefacts)
    neverShortAboveF: 62,                                    // a sit this warm is never "short" (the ISO wind term over-asks in a mild breeze); the cost still adds a layer when it helps
    loudWeight: { deer: 1, waterfowl: 1, upland: 0.1 },      // fabric noise matters at bow range, not to a flushing bird
    loudSit: 1.5,                                            // ...and most of all on a deer stand (cost.loud x 1.5 = 0.30 on deer sit phases)
    shortTol: 0.03,                                          // within 3% of target counts as met
    deficitTol: 0.15,                                        // a shortfall this small (clo) is noise — never "short" for it
    hoursK: 0.9,                                             // comfort hours = hoursK / deficit (0.3 clo short ~ 3 h, 0.6 ~ 1.5 h, 1.0 ~ 1 h), measured against the 3-hour target
    refSitHours: 3,                                          // comfort hours are ABSOLUTE: always measured against the 3-hour sit target, then compared with the planned sit
    optOvershoot: { default: 0.4, upland: 0.55 },            // an optional outer is offered if it keeps the overshoot under this (clo)
    extremityMoveOffset: 6,                                  // walking warms hands/head: wind-chill ladder shifts this much (deg F) on moving phases
    wctBlendF: 55                                            // NWS wind chill applies at/below 50F; between 50 and this it is blended toward the air temp (no cliff)
  };

  /* ================================================================================================
   * 2. CATALOG — the owned closet, single source of truth (spec section 2)
   *    clo = whole-body contribution (ISO 9920 Iclu style).  tmin/tmax = eligibility window in dressed degF.
   * ============================================================================================== */
  const ALL = ['deer', 'upland', 'waterfowl'];
  const T = (o) => Object.assign({ slot: 'torso', fit: 'skin', wind: 0, wp: 0, quiet: 7, ins: 'none', active: true,
    combo: false, terminal: false, overInsul: false, disc: ALL, pattern: 'Valo', w: 0 }, o);
  const CATALOG = [
    // ---- torso ----
    T({ id: 'merino120_ss', name: '120 Merino SS', cat: 'base', pos: ['base'], clo: 0.09, quiet: 9, ins: 'merino', tmin: 58, tmax: 110, pattern: 'Universal', w: 0.13 }),
    T({ id: 'merino120_ls', name: '120 Merino LS', cat: 'base', pos: ['base'], clo: 0.16, quiet: 9, ins: 'merino', tmin: 45, tmax: 90, pattern: 'Universal', w: 0.16 }),
    T({ id: 'peloton118', name: 'Peloton 118', cat: 'base', pos: ['base'], clo: 0.14, quiet: 8, ins: 'syn', tmin: 48, tmax: 85, pattern: 'Universal', w: 0.18 }),
    T({ id: 'tiburon_snap', name: 'Tiburon Snap Shirt', cat: 'shirt', pos: ['base'], clo: 0.07, quiet: 6, ins: 'syn', tmin: 62, tmax: 110, w: 0.20 }),
    T({ id: 'encounter_lt', name: 'Encounter LT shirt', cat: 'shirt', pos: ['base'], clo: 0.22, quiet: 10, ins: 'syn', active: false, tmin: 44, tmax: 70, disc: ['deer', 'upland'], w: 0.45 }),
    T({ id: 'upland_shirt', name: 'Upland shirt', cat: 'shirt', pos: ['base'], clo: 0.12, wind: 0, wp: 1, quiet: 5, ins: 'syn', tmin: 50, tmax: 90, disc: ['upland'], w: 0.32 }),   // KUIU 'Mild': a thin woven shirt, not a cold-walk base
    T({ id: 'promerino200', name: 'Pro Merino 200 Zip-T', cat: 'base', pos: ['base'], clo: 0.24, wind: 1, quiet: 8, ins: 'merino', tmin: -10, tmax: 66, pattern: 'Universal', w: 0.30 }),
    T({ id: 'vitalpro_top', name: 'Vital PRO top', cat: 'base', pos: ['base'], clo: 0.32, quiet: 8, ins: 'syn', active: false, tmin: -20, tmax: 36, pattern: 'Universal', w: 0.37 }),
    T({ id: 'peloton200', name: 'Peloton 200 Zip-T', cat: 'mid', pos: ['mid', 'outer'], fit: 'mid', clo: 0.30, quiet: 9, ins: 'fleece', tmin: -10, tmax: 62, w: 0.29 }),
    T({ id: 'rubicon', name: 'Rubicon jacket', cat: 'softshell', pos: ['outer'], fit: 'outer', clo: 0.35, wind: 1, wp: 1, quiet: 7, ins: 'fleece', tmin: 34, tmax: 66, w: 0.52 }),
    T({ id: 'guide_dcs', name: 'Guide DCS jacket', cat: 'softshell', pos: ['outer'], fit: 'outer', clo: 0.42, wind: 1, wp: 1, quiet: 5, ins: 'fleece', tmin: 28, tmax: 62, w: 0.68 }),
    T({ id: 'axis_hybrid', name: 'Axis Hybrid Hooded jacket', cat: 'softshell', pos: ['outer'], fit: 'outer', clo: 0.45, wind: 1, wp: 1, quiet: 6, ins: 'fleece', tmin: 22, tmax: 58, w: 0.69 }),
    T({ id: 'proximity_jacket', name: 'Proximity jacket', cat: 'insulation', pos: ['insul', 'outer'], fit: 'outer', clo: 0.60, wind: 2, wp: 1, quiet: 10, ins: 'syn', active: false, tmin: -5, tmax: 46, w: 0.91 }),
    T({ id: 'superdown_pro', name: 'Super Down PRO jacket', cat: 'insulation', pos: ['insul', 'outer'], fit: 'outer', clo: 0.70, wind: 1, wp: 1, quiet: 6, ins: 'down', active: false, tmin: -15, tmax: 40, disc: ['deer', 'waterfowl'], w: 0.42 }),
    T({ id: 'haven', name: 'Super Down Haven jacket', cat: 'insulation', pos: ['outer'], fit: 'outer', clo: 1.05, wind: 2, wp: 1, quiet: 10, ins: 'down', active: false, terminal: true, tmin: -25, tmax: 40, disc: ['deer', 'waterfowl'], w: 1.13 }),   // tmax 40: honest closet band — the loadout wears it from ~40 in wind (base prior keeps the Proximity ahead at 41-46)
    T({ id: 'kutana_jacket', name: 'Kutana Storm Shell jacket', cat: 'shell', pos: ['outer'], fit: 'outer', clo: 0.22, wind: 2, wp: 2, quiet: 4, ins: 'none', tmin: -20, tmax: 75, w: 0.57 }),
    T({ id: 'hdflex_jacket', name: 'HD Flex Storm Shell', cat: 'shell', pos: ['outer'], fit: 'outer', clo: 0.28, wind: 2, wp: 2, quiet: 3, ins: 'none', active: false, overInsul: true, tmin: -20, tmax: 58, w: 1.06 }),
    T({ id: 'galeforce_jacket', name: 'Kutana Gale Force jacket', cat: 'shell', pos: ['outer'], fit: 'outer', clo: 0.85, wind: 2, wp: 2, quiet: 4, ins: 'syn', combo: true, tmin: -25, tmax: 42, disc: ['deer', 'waterfowl'], w: 1.24 }),
    // ---- legs ----
    T({ id: 'tiburon_pant', name: 'Tiburon pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.15, quiet: 6, ins: 'syn', tmin: 58, tmax: 110, w: 0.35 }),
    T({ id: 'attack_pant', name: 'Attack pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.24, wind: 1, wp: 1, quiet: 5, ins: 'syn', tmin: 38, tmax: 76, w: 0.52 }),
    T({ id: 'probrush_pant', name: 'Pro Brush pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.27, wind: 1, wp: 1, quiet: 4, ins: 'syn', tmin: 30, tmax: 74, disc: ['upland'], w: 0.56 }),
    T({ id: 'encounter_pant', name: 'Encounter pant', cat: 'pant', slot: 'legs', pos: ['pant'], clo: 0.32, wind: 1, wp: 1, quiet: 10, ins: 'fleece', tmin: 10, tmax: 58, disc: ['deer', 'waterfowl'], w: 0.74 }),
    T({ id: 'galeforce_pant', name: 'Kutana Gale Force pant', cat: 'pant', slot: 'legs', pos: ['pant', 'overpant'], clo: 0.55, wind: 2, wp: 2, quiet: 4, ins: 'syn', combo: true, active: false, tmin: -25, tmax: 40, disc: ['deer', 'waterfowl'], w: 1.0 }),
    T({ id: 'kutana_pant', name: 'Kutana Storm Shell pant', cat: 'pant', slot: 'legs', pos: ['overpant'], clo: 0.17, wind: 2, wp: 2, quiet: 4, ins: 'none', tmin: -20, tmax: 72, w: 0.49 }),
    T({ id: 'encounter_fleece_btm', name: 'Encounter 200 Fleece Bottom', cat: 'base', slot: 'legs', pos: ['base'], clo: 0.17, quiet: 9, ins: 'fleece', tmin: -10, tmax: 48, pattern: 'Universal', w: 0.21 }),
    T({ id: 'vitalpro_btm', name: 'Vital PRO bottoms', cat: 'base', slot: 'legs', pos: ['base'], clo: 0.28, quiet: 8, ins: 'syn', active: false, tmin: -25, tmax: 36, pattern: 'Universal', w: 0.33 }),
    T({ id: 'wader_hdflex', name: 'PRO HD Flex Zip Wader', cat: 'wader', slot: 'wader', pos: ['wader'], clo: 0.65, wind: 2, wp: 2, quiet: 3, ins: 'none', tmin: -20, tmax: 75, disc: ['waterfowl'], w: 3.3 }),   // 0.45 breathable wader + 0.20 insulated boot-foot: it covers legs AND feet
    // ---- head / neck / hands / feet / sock / vest ----
    T({ id: 'prohat_valo', name: 'Pro Hat - Valo', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.02, quiet: 8, tmin: 48, tmax: 120 }),
    T({ id: 'prohat_orange', name: 'Pro Hat - Orange', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.02, quiet: 8, tmin: 48, tmax: 120, disc: ['deer'], pattern: 'Blaze' }),
    T({ id: 'kenai_beanie', name: 'Kenai beanie', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.05, wind: 1, wp: 1, quiet: 9, ins: 'syn', tmin: 25, tmax: 50 }),
    T({ id: 'proximity_beanie', name: 'Proximity beanie', cat: 'headwear', slot: 'head', pos: ['head'], clo: 0.05, wind: 2, wp: 1, quiet: 10, ins: 'syn', tmin: -25, tmax: 42 }),
    T({ id: 'proximity_gaiter', name: 'Proximity neck gaiter', cat: 'accessory', slot: 'neck', pos: ['neck'], clo: 0.03, wind: 2, wp: 1, quiet: 10, ins: 'fleece', tmin: -25, tmax: 50 }),
    T({ id: 'precision_glove', name: 'Precision glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.03, wind: 1, quiet: 7, tmin: 44, tmax: 75, disc: ['deer', 'upland'] }),
    T({ id: 'yukon_glove', name: 'Yukon glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.06, wind: 2, wp: 2, quiet: 6, ins: 'syn', tmin: 28, tmax: 48 }),
    T({ id: 'kenai_glove', name: 'Kenai glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.06, wind: 2, wp: 1, quiet: 7, ins: 'syn', tmin: 24, tmax: 45 }),
    T({ id: 'northstar_glove', name: 'Northstar glove', cat: 'gloves', slot: 'hands', pos: ['hands'], clo: 0.10, wind: 2, wp: 2, quiet: 6, ins: 'syn', tmin: -25, tmax: 30 }),
    T({ id: 'merino_sock', name: 'ULTRA Merino Crew Sock', cat: 'boots', slot: 'sock', pos: ['sock'], clo: 0.03, quiet: 9, ins: 'merino', tmin: -40, tmax: 120, pattern: 'Universal' }),
    T({ id: 'ankle_mud', name: 'Ankle Mud Boot', cat: 'boots', slot: 'feet', pos: ['feet'], clo: 0.14, wind: 2, wp: 2, quiet: 6, tmin: 42, tmax: 78 }),
    T({ id: 'danner', name: 'Danner lace-up boots', cat: 'boots', slot: 'feet', pos: ['feet'], clo: 0.12, wind: 1, wp: 1, quiet: 6, tmin: 20, tmax: 85, pattern: 'Solid' }),
    T({ id: 'hd_mud', name: 'HD Mud Boot', cat: 'boots', slot: 'feet', pos: ['feet'], clo: 0.25, wind: 2, wp: 2, quiet: 6, ins: 'syn', active: false, tmin: -25, tmax: 44, disc: ['deer', 'waterfowl'] }),
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
  // calibrated target for a phase, in the static domain, for a given outer-layer permeability
  function targetClo(p) {
    const neu = requiredClo({ tempF: p.tempF, windMph: p.windMph, met: p.met, perm: p.perm, sunC: p.sunC });
    const min = requiredClo({ tempF: p.tempF, windMph: p.windMph, met: p.met, perm: p.perm, sunC: p.sunC, variant: 'minimal' });
    const raw = min.iclStaticClo + p.K * (neu.iclStaticClo - min.iclStaticClo);
    return { target: raw * TUNE.cal * (p.factor || 1), raw: raw, neu: neu, min: min };
  }
  // sit-length -> K (interpolated from TUNE.Ksit): a 1-hour sit is dressed near ISO "minimal", a 6-hour sit near "neutral"
  function ksit(hours) {
    const t = TUNE.Ksit, h = Math.max(t[0][0], Math.min(t[t.length - 1][0], hours || 3));
    for (let i = 1; i < t.length; i++) if (h <= t[i][0]) { const f = (h - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1] + f * (t[i][1] - t[i - 1][1]); }
    return t[t.length - 1][1];
  }
  // comfortable hours when the stack is short of the REFERENCE (3-hour) target: an ABSOLUTE time from the deficit
  // (DLE-like: a fixed heat debt divided by the rate you are losing it). The same kit in the same weather always reads
  // the same hours; the planned sit only decides whether that is "short". hoursK 0.9: 0.3 clo short ~ 3 h, 0.6 ~ 1.5 h,
  // 1.0 ~ 1 h. Capped at `cap` (the planned sit) for display. (ISO's own DLE is not used: the calibration already spends
  // the ISO "acceptable cooling" allowance — see TUNING-NOTES.)
  function hoursOfComfort(supplied, refTarget, cap) {
    const h = hoursRaw(supplied, refTarget, cap);
    return Math.max(0.5, Math.round(h * 2) / 2);
  }
  // unrounded hours (decisions compare these; the half-hour rounding is for display only)
  function hoursRaw(supplied, refTarget, cap) {
    const c = cap || 3, deficit = refTarget - supplied;
    if (met(supplied, refTarget)) return c;
    return Math.min(c, TUNE.hoursK / deficit);
  }
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
      id: raw.id || slug(name), name: name, cat: cat, slot: slot, pos: pos, fit: fit,
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

  function pick(it, role, why, extra) { return Object.assign({ id: it.id, name: it.name, role: role, fit: it.fit, why: why || '', alt: [] }, extra || {}); }
  function label(txt, why) { return { id: null, name: txt, role: 'label', why: why || '', alt: [], label: true }; }

  function eligible(it, dressF, widen) {
    const w = widen || 0;
    return dressF >= (it.tmin == null ? -99 : it.tmin) - w && dressF <= (it.tmax == null ? 199 : it.tmax) + w;
  }
  // uninsulated rain shells are judged on the air temperature — rain is rain, however hard you are walking
  function judgeF(it, ctx) { return (it.wp === 2 && it.ins === 'none') ? ctx.tempF : ctx.dressF; }
  function elig(it, ctx, widen) { return eligible(it, judgeF(it, ctx), widen); }
  // out-of-band distance (deg F) of a piece from its window at this phase's temperature
  function oob(it, ctx) { return dist(it, judgeF(it, ctx)); }
  // soft admission for the enumeration (spec 3.4 + audit finding 2): inside the window, or outside at a per-degree
  // cost — but never a warm-weather piece pulled into a cold stack, and nothing absurdly far out. open=true = anything.
  function admit(it, ctx, open) {
    if (open) return true;
    const f = judgeF(it, ctx), tmin = it.tmin == null ? -99 : it.tmin, tmax = it.tmax == null ? 199 : it.tmax;
    if (tmin > f + TUNE.oobWarmIn) return false;
    if (tmax < f - TUNE.oobColdIn) return false;
    return true;
  }

  // ---------- phase context ----------
  function makeCtx(input, phaseKey) {
    const wx = input.wx, mode = input.mode;
    const wet = (wx.pprob || 0) >= TUNE.wetProb || (wx.precipIn || 0) >= TUNE.wetIn;
    const windy = (wx.gustMph || 0) >= TUNE.windyGust || (wx.windMph || 0) >= TUNE.windyWind;
    let met, K, wb, seated = false, moving = false, offset = 0;
    let factor = 1;
    if (phaseKey === 'sit') { met = mode === 'waterfowl' ? TUNE.met.wf_sit : TUNE.met.deer_sit; K = ksit(input.sitHours || 3); seated = true; factor = 1 + TUNE.sitFactor * ((input.sitHours || 3) - 3); }
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
      packed: !!input.packed, factor: factor, targetCache: {}, refCache: {}, input: input, depth: 0
    };
  }
  function targetFor(ctx, wind) {
    const perm = TUNE.perm[wind] || 8;
    if (!ctx.targetCache[perm]) ctx.targetCache[perm] = targetClo({ tempF: ctx.tempF, windMph: ctx.windBody, met: ctx.met, perm: perm, sunC: ctx.sunC, K: ctx.K, factor: ctx.key === 'stop' ? TUNE.stopFactor : (ctx.factor || 1) });
    return ctx.targetCache[perm];
  }
  // the hours-independent reference target (a 3-hour sit): comfort hours are always measured against this
  function refTargetFor(ctx, wind) {
    if (ctx.key !== 'sit') return targetFor(ctx, wind).target;
    const perm = TUNE.perm[wind] || 8;
    if (!ctx.refCache[perm]) ctx.refCache[perm] = targetClo({ tempF: ctx.tempF, windMph: ctx.windBody, met: ctx.met, perm: perm, sunC: ctx.sunC, K: ksit(TUNE.refSitHours), factor: 1 }).target;
    return ctx.refCache[perm];
  }
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
    return el.sort(function (a, b) { return b.clo - a.clo || b.wp - a.wp || (a.tmin == null ? -99 : a.tmin) - (b.tmin == null ? -99 : b.tmin) || b.quiet - a.quiet; })[0];
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
    if (f.wp === 2) return onFoot ? (f.clo >= 0.2 ? 'warmest boot you own — the lace-up is too cold here' : 'waterproof rubber — short walks only') : (f.clo >= 0.2 ? 'taller, warmer — long sit' : 'rubber = scent control at the stand');
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
    if (ctx.mode === 'deer' && ctx.blaze && t >= 48) head = heads.find(function (h) { return h.pattern === 'Blaze'; }) || null;
    if (!head) head = warmestEligible(heads.filter(function (h) { return !(ctx.mode !== 'deer' && h.pattern === 'Blaze'); }), t, ctx.windy ? function (h) { return h.wind >= 1; } : null);
    if (head) out.head.push(pick(head, 'head', whyHead(head, t)));
    // neck
    if (t < 45 || (ctx.windy && t < 55)) { const g = warmestEligible(by('neck'), t); if (g) out.neck.push(pick(g, 'neck', ctx.windy ? 'wind off your neck and face' : 'seals the collar')); }
    // hands
    if (t >= 72 || (ctx.mode === 'upland' && t >= 60)) out.hands.push(label('bare hands', 'too warm for gloves'));
    else {
      const hands = by('hands');
      const wpOnly = ctx.rain ? function (g) { return g.wp === 2; } : null;
      let h = null;
      const tooWarmForAll = hands.length && !ctx.rain && hands.every(function (g) { return t > g.tmax; });   // every glove you own is a cold-weather glove
      if (tooWarmForAll) out.hands.push(label('bare hands', 'too warm for the gloves you own'));
      else {
        if (moving) { const cand = wpOnly ? hands.filter(wpOnly) : hands; h = nearestEligible(cand.length ? cand : hands, t); }
        if (!h) h = warmestEligible(hands, t, wpOnly);
        if (h) out.hands.push(pick(h, 'hands', h.wp === 2 ? (ctx.rain ? 'waterproof' : 'waterproof, warm') : (h.clo <= 0.03 ? 'trigger dexterity' : 'warm, still dexterous')));
        else out.hands.push(label('bare hands', 'nothing packed'));
      }
    }
    // feet
    const feet = by('feet');
    if (ctx.mode === 'waterfowl' && input.wfEnv !== 'dry') out.feet.push(label('Waders cover it', 'boot-foot'));
    else if ((moving && ctx.key !== 'walk') || ctx.mode === 'upland') {     // the walk-in wears the boots you will sit in
      const f = warmestEligible(feet, t, function (b) { return b.id === 'danner' || /lace|hik|boot/i.test(b.name) && b.wp < 2; }) || warmestEligible(feet, t);
      if (f) out.feet.push(pick(f, 'feet', whyFeet(f, ctx)));
      const alt = feet.find(function (b) { return f && b.id !== f.id && b.wp === 2 && eligible(b, t, 6); });
      if (alt && out.feet[0]) out.feet[0].alt.push({ id: alt.id, name: alt.name, why: 'swap in for wet ground' });
    } else {
      const f = warmestEligible(feet, t, function (b) { return b.wp === 2; }) || warmestEligible(feet, t);
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
  function torsoCombos(ctx, pool, open) {
    const tor = pool.filter(function (it) { return it.slot === 'torso' && admit(it, ctx, open); });
    const has = function (it, p) { return it.pos.indexOf(p) >= 0; };
    const bases = tor.filter(function (it) { return has(it, 'base') && it.fit === 'skin'; });
    const mids = [null].concat(tor.filter(function (it) { return has(it, 'mid'); }));
    const insuls = [null].concat(tor.filter(function (it) { return has(it, 'insul'); }));
    let outers = [null].concat(tor.filter(function (it) { return has(it, 'outer'); }));
    // wet below the too-warm line: the outer MUST be a membrane shell when you own one that fits the window
    if (ctx.wet && outers.some(function (o) { return o && o.wp === 2; })) outers = outers.filter(function (o) { return o && o.wp === 2; });
    // still-hunting: the insulated outer (combo) stays in the pack for the stops whenever a plain outer and a stop
    // layer exist — move in the plain shell / soft shell, pull the insulation on when you stop
    if (ctx.key === 'move' && outers.some(function (o) { return o && !o.combo && o.fit === 'outer' && (!ctx.wet || o.wp === 2); })
        && pool.some(function (it) { return it.slot === 'torso' && it.fit === 'outer' && (it.ins === 'syn' || it.ins === 'down') && (!ctx.wet || it.wp === 2); })) outers = outers.filter(function (o) { return !o || !o.combo; });
    const out = [];
    bases.forEach(function (b) { mids.forEach(function (m) { insuls.forEach(function (i) { outers.forEach(function (o) {
      // a piece listed as insul AND outer is enumerated once as the outer (i with no o would be the identical stack)
      if (i && !o && i.pos.indexOf('outer') >= 0) return;
      // ...and a mid that is also listed as an outer (Peloton 200) is enumerated as the outer when it is outermost
      if (m && !i && !o && m.pos.indexOf('outer') >= 0) return;
      const st = [b, m, i, o].filter(Boolean);
      const ids = st.map(function (x) { return x.id; });
      if (new Set(ids).size !== ids.length) return;
      const v = validTorso(ctx, b, m, i, o, open); if (!v) return;
      out.push(v);
    }); }); }); });
    return out;
  }
  // returns {stack:[{it,role,fit}], penalties, flags} or null.  stack[].fit is the EFFECTIVE fit in this role
  // (Pro Merino 200 is skin-fit as a base and mid-fit when worn as the mid over a knit tee).
  function validTorso(ctx, b, m, i, o, open) {
    const stack = [{ it: b, role: 'base', fit: 'skin' }];
    if (m) stack.push({ it: m, role: 'mid', fit: 'mid' });
    if (i) stack.push({ it: i, role: o ? 'insul' : 'outer', fit: i.fit });
    if (o) stack.push({ it: o, role: 'outer', fit: o.fit });
    const flags = [];
    // the insulated rain shell (combo) is the wet / frigid outer: on a DRY day it is worn only at or below comboDryMaxF
    // (trip mode with nothing else packed: `open` lets it through)
    if (!open && !ctx.wet && o && o.combo && ctx.tempF > TUNE.comboDryMaxF) return null;
    // a dry day at/above noOuterAboveF: no outer-fit piece at all (a shirt is the answer, not a rain jacket in a warm breeze)
    const soft = function (x) { return x && x.fit === 'outer' && x.wp < 2 && x.ins === 'fleece'; };
    if (!open && !ctx.wet && ctx.tempF >= TUNE.noOuterAboveF && ((o && o.fit === 'outer' && !soft(o)) || (i && i.fit === 'outer'))) return null;
    if (!open && !ctx.wet && ctx.tempF >= TUNE.noSoftshellAboveF && o && soft(o)) return null;
    // moving: only pieces that breathe on the move — except the base on a walk-in (you cannot change your base at the stand)
    if (ctx.moving) { for (let k = 0; k < stack.length; k++) if (!stack[k].it.active && !(ctx.key === 'walk' && k === 0)) return null; }
    // exactly one next-to-skin piece (spec rule 7). A skin-fit piece may serve as the MID only over a thin knit base
    // (Pro Merino 200 over a merino tee) — never over a woven shirt, never over another real base layer.
    if (m && m.fit === 'skin' && !(b.clo < 0.2 && b.ins === 'merino' && b.wind === 0 && b.quiet >= 8)) return null;
    // fit non-decreasing outward
    for (let k = 1; k < stack.length; k++) if (FIT[stack[k].fit] < FIT[stack[k - 1].fit]) return null;
    // combo piece occupies insul + outer
    if (o && o.combo && i) return null;
    if (i && i.combo) return null;
    // terminal: nothing over it
    for (let k = 0; k < stack.length - 1; k++) if (stack[k].it.terminal) return null;
    // a fleece (knit, wind 0, mid-fit) as the OUTERMOST piece — whichever role it took — only when calm & dry
    const outerIt = stack[stack.length - 1].it;
    if (stack.length > 1 && outerIt.fit === 'mid' && outerIt.wind === 0) {
      if (ctx.windBody >= 8 || ctx.wet) return null;
    }
    // outer-fit over outer-fit
    let mult = {};
    if (i && o && i.fit === 'outer' && o.fit === 'outer') {
      if (o.overInsul) { /* sized for it */ }
      else if (ctx.wet && o.wp === 2) { mult[i.id] = TUNE.compress[i.ins] || 1; flags.push('snug'); }
      else return null;
    }
    // a shell sized to go over a puffy (HD Flex), worn with nothing insulated under it, is the wrong shell wet OR dry —
    // the plain Kutana is the rain shell (cost, not a ban: trip mode may leave it as the only waterproof piece)
    if (o && o.overInsul && !i) flags.push('shellNoInsul');
    // wet with no membrane outer: exposed insulation soaks
    if (ctx.wet && outerIt.wp !== 2) {
      stack.forEach(function (s) { if (s.it.ins !== 'none') mult[s.it.id] = (mult[s.it.id] || 1) * (TUNE.wetNoShell[s.it.ins] || 1); });
      flags.push('soaked');
    }
    return { stack: stack, mult: mult, flags: flags, outerWind: outerIt.wind, outer: outerIt };
  }
  function legsCombos(ctx, pool, open, forced) {
    const legs = pool.filter(function (it) { return it.slot === 'legs' && admit(it, ctx, open); });
    const has = function (it, p) { return it.pos.indexOf(p) >= 0; };
    let bases = [null].concat(legs.filter(function (it) { return has(it, 'base'); }));
    let pants = legs.filter(function (it) { return has(it, 'pant'); });
    let overs = [null].concat(legs.filter(function (it) { return has(it, 'overpant'); }));
    if (forced && forced.legsBase) {
      // walk-in: the sit's base + pant (a carried bib already removed); only a plain overpant may be added or kept
      const fb = forced.legsBase.find(function (s) { return s.role === 'base'; }), fp = forced.legsBase.find(function (s) { return s.role === 'pant'; });
      bases = [fb ? fb.it : null];
      // a bib worn AS the pant on the sit goes on at the stand too: walk in any admitted plain pant and carry it
      pants = (fp && !fp.it.combo) ? [fp.it] : legs.filter(function (it) { return has(it, 'pant') && !it.combo; });
      overs = [null].concat(pool.filter(function (it) { return it.slot === 'legs' && has(it, 'overpant') && !it.combo; }));
      if (!pants.length) return [];
    }
    if (forced && forced.wader) pants = [null];
    else if (forced && forced.pant) { const fp = pool.find(function (p) { return p.id === forced.pant; }); if (fp) pants = [fp]; }
    // long walk-in: you walk in your pants and put the bib on OVER them at the stand — the bib is never the sit's only pant
    // when a plain pant is available (so the walk-in and the sit share the same pant)
    if (ctx.key === 'sit' && ctx.act === 'medium' && !open && pants.some(function (p) { return p && !p.combo; })) pants = pants.filter(function (p) { return p && !p.combo; });
    // wet: legs need a waterproof outer too — an overpant, or a waterproof pant, when you own one that fits
    if (ctx.wet && !(forced && forced.wader)) {
      const wpPant = pants.some(function (p) { return p && p.wp === 2; }), wpOver = overs.some(function (o) { return o && o.wp === 2; });
      if (wpPant || wpOver) {
        if (!wpOver) pants = pants.filter(function (p) { return p && p.wp === 2; });
        // (if only an overpant is waterproof, validLegs will reject any combo without it)
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
    const flags = [], mult = {};
    // moving: pieces that breathe — except the base bottom on a walk-in (you cannot change it at the stand)
    if (ctx.moving) { for (let k = 0; k < stack.length; k++) if (stack[k].it.active === false && !(ctx.key === 'walk' && stack[k].role === 'base')) return null; }
    if (o) {
      if (forced && forced.wader) return null;
      if (p && p.combo) return null;                       // nothing over the Gale Force pant worn as the pant
      if (p && o.id === p.id) return null;
      const needWind = ctx.windBody >= 15 && p && p.wind === 0;
      // a plain overpant is for rain or wind; an insulated bib (combo) goes over a pant in rain, in real wind, or when
      // it is cold enough (bibDryMaxF) — not on a mild dry sit where fleece bottoms are the answer
      const bibOk = o.combo && (ctx.wet || ctx.windBody >= 15 || ctx.tempF <= TUNE.bibDryMaxF);
      if (!(ctx.wet || needWind || bibOk)) return null;
    }
    const outerIt = stack[stack.length - 1].it;
    if (ctx.wet && outerIt.wp !== 2) {
      if (ctx.legsNeedWp) return null;
      stack.forEach(function (s) { if (s.it.ins !== 'none') mult[s.it.id] = TUNE.wetNoShell[s.it.ins] || 1; }); flags.push('soaked');
    }
    return { stack: stack, mult: mult, flags: flags, forcedPant: !!(forced && (forced.pant || forced.wader)) };
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
      const f = judgeF(s.it, ctx), d = dist(s.it, f), cold = d && f < s.it.tmin;
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
    if (lp && !lc.forcedPant) c += TUNE.cost.legsBasePrior * Math.abs(lp.it.clo - lerpTable(TUNE.pantPrior, ctx.dressF)) / 0.1;
    return c;
  }
  // coherence with the stack worn 2 degF warmer (ctx.ref): dropping one of its pieces, or swapping a role for a lighter
  // piece, costs — adding pieces or swapping warmer is free. Stateless: the reference is the plain (prior-only) pick.
  function stabilityCost(tc, lc, ctx, S) {
    const ref = ctx.ref; if (!ref) return 0;
    const cur = {};
    tc.stack.forEach(function (s) { cur['t:' + s.role] = s.it; });
    lc.stack.forEach(function (s) { cur['l:' + s.role] = s.it; });
    let c = 0;
    ref.pieces.forEach(function (r) {
      const m = cur[r.key];
      if (!m) c += TUNE.cost.stability;
      else if (m.id !== r.id && m.clo < r.clo - 0.02) c += TUNE.cost.lighterSwap;
    });
    // and never dress COLDER than the pick 2 degF warmer (monotonic warmth, priced like a deficit)
    c += TUNE.cost.dropBelowRef * Math.max(0, ref.S - S - 0.05);
    return c;
  }
  // score a torso+legs pair; returns {S, R, cost}
  function score(ctx, tc, lc, extClo, noLegShare) {
    const tSum = sumStack(tc), lSum = sumStack(lc);
    if (!noLegShare && lSum < TUNE.legShare * (tSum + lSum)) return null;
    // ...and the torso is never the cold half: once the legs carry real insulation (a bib / over-pant stack), the torso
    // must supply at least torsoShare of the pair — whole-body clo is not fungible, an under-dressed core leaks heat
    // whatever the legs wear (sign-off round 4: 40° wet had a plain shell up top and a Gale Force bib below)
    if (!noLegShare && ctx.key !== 'walk' && lSum >= TUNE.torsoShareMinLegs && tSum < TUNE.torsoShare * (tSum + lSum)) return null;   // (walk-in: the legs are the sit's, fixed)
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
    // deficit is priced from zero (deficitTol only decides what reads as "short"): a stack 0.1 short costs 1.2, 0.1 over costs 0.1
    const cost = TUNE.cost.deficit * Math.max(0, R - S) + TUNE.cost.overshoot * Math.max(0, S - R)
      + TUNE.cost.layer * (tc.stack.length + lc.stack.length)
      + TUNE.cost.loud * loudW * (loudness(tc) + loudness(lc))
      + TUNE.cost.weight * (weight(tc) + weight(lc))
      + outOfBand(tc, ctx) + outOfBand(lc, ctx)
      + (tc.flags.indexOf('snug') >= 0 ? TUNE.cost.snug : 0)
      + (tc.flags.indexOf('shellNoInsul') >= 0 ? TUNE.cost.shellNoInsul : 0)
      + (noOuter ? TUNE.cost.noOuterCold : 0)
      + basePriorCost(tc, lc, ctx)
      + stabilityCost(tc, lc, ctx, S)
      - TUNE.cost.specialist * (specialists(tc, ctx.mode) + specialists(lc, ctx.mode));
    return { S: S, R: R, cost: cost, tg: tg };
  }

  // COHERENCE REFERENCE: the outfit this same hunt would wear one degree warmer. Built as a chain from the warm anchor
  // (CHAIN_TOP) down to tempF+1 in 1-degF steps, each step itself coherent with the one above it — so the series a
  // hunter sees as the forecast changes is monotone by construction (add a piece / swap warmer, never drop). The chain
  // is memoised per hunt (everything but the temperature) so a sweep or a re-render costs one enumeration per degree.
  const CHAIN_TOP = 95, chainCache = new Map();
  function chainSig(ctx, pool, forced) {
    const w = ctx.input.wx || {};
    return [ctx.key, ctx.mode, ctx.act, ctx.input.wfEnv || '', w.windMph || 0, w.gustMph || 0, ctx.rain ? 1 : 0, w.sun || 0, ctx.sitHours, ctx.blaze ? 1 : 0,
      forced && forced.wader ? 'W' : '', forced && forced.pant ? forced.pant : '',
      pool.map(function (it) { return it.id + ':' + it.clo + ':' + it.tmin + ':' + it.tmax + ':' + it.fit + ':' + it.pos.join(''); }).join('|')].join('#');
  }
  function refOf(b) {
    const pieces = [];
    b.tc.stack.forEach(function (s) { pieces.push({ key: 't:' + s.role, id: s.it.id, clo: s.it.clo }); });
    b.lc.stack.forEach(function (s) { pieces.push({ key: 'l:' + s.role, id: s.it.id, clo: s.it.clo }); });
    return { pieces: pieces, S: b.S };
  }
  function referenceStack(ctx, pool, forced, open) {
    if (ctx.depth > 0 || open || !TUNE.cost.stability || ctx.key === 'walk' || (forced && forced.legsBase)) return null;
    const want = Math.round(ctx.tempF) + 1;
    if (want > CHAIN_TOP) return null;
    const sig = chainSig(ctx, pool, forced);
    let chain = chainCache.get(sig);
    if (!chain) { if (chainCache.size > 48) chainCache.clear(); chain = {}; chainCache.set(sig, chain); }
    if (chain[want] !== undefined) return chain[want];
    // fill from the highest missing temperature down to `want`
    let start = CHAIN_TOP; while (start > want && chain[start] !== undefined) start--;
    for (let t = start; t >= want; t--) {
      if (chain[t] !== undefined) continue;
      const inp = Object.assign({}, ctx.input, { wx: Object.assign({}, ctx.input.wx, { tempF: t }) });
      const c2 = makeCtx(inp, ctx.key); c2.depth = 1;
      c2.ref = (t + 1 <= CHAIN_TOP) ? chain[t + 1] : null;
      const e2 = extremities(c2, pool, inp);
      const b2 = buildOutfit(c2, pool, e2, forced, false);
      chain[t] = b2 ? refOf(b2) : null;
    }
    return chain[want];
  }

  // choose the best outfit for a phase; returns {tc, lc, S, R, maxS, maxEff, ...}
  // One enumeration over every admitted piece (out-of-band pieces pay per degree); the CHEAPEST outfit wins — the cost
  // already prices a shortfall at 12/clo, so there is no met-the-target gate (round 3: that gate made picks flip on
  // 0.05-clo differences). If the winner would run short and a not-short outfit exists within cost.shortSwitch, that
  // one is taken instead; otherwise the honest short pick stands and `warmer` records the not-short alternative.
  // open=true (last resort, trip mode): every window open, nothing excluded.
  function buildOutfit(ctx, pool, ext, forced, open) {
    const tcs = torsoCombos(ctx, pool, !!open), lcs = legsCombos(ctx, pool, !!open, forced);
    if (ctx.depth === 0) ctx.ref = referenceStack(ctx, pool, forced, open);   // chain steps arrive with their ref set
    let b = null, bOk = null, bMax = null, maxS = 0, maxEff = 0;
    tcs.forEach(function (tc) { lcs.forEach(function (lc) {
      const sc = score(ctx, tc, lc, ext.clo); if (!sc) return;
      if (sc.S > maxS) maxS = sc.S;
      const cand = { tc: tc, lc: lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg };
      if (!b || sc.cost < b.cost - 1e-9) b = cand;
      const ok = hoursRaw(sc.S, refTargetFor(ctx, tc.outerWind), ctx.sitHours) >= ctx.sitHours - 1e-9;   // unrounded: no half-hour rounding deciding "full sit"
      if (ok && (!bOk || sc.cost < bOk.cost - 1e-9)) bOk = cand;
      const eff = sc.S * sc.tg.neu.CF;
      if (eff > maxEff + 1e-9) { maxEff = eff; bMax = cand; }
    }); });
    if (!b) return null;
    let best = b, warmer = null;
    const bShort = hoursOfComfort(b.S, refTargetFor(ctx, b.tc.outerWind), ctx.sitHours) < ctx.sitHours;
    if (bShort) {
      // the cheapest stack runs short: name the stack that would not (or, if none would, the warmest legal one when it
      // is meaningfully warmer) — the pick itself stays (switching re-creates a cliff; see TUNE.cost.shortSwitch).
      // A "warmer" alternative must be MEANINGFULLY warmer (TUNE.warmerMinGain clo), not a rounding artefact.
      if (bOk && bOk !== b && bOk.S >= b.S + TUNE.warmerMinGain) { if (TUNE.cost.shortSwitch > 0 && bOk.cost <= b.cost + TUNE.cost.shortSwitch) best = bOk; else warmer = bOk; }
      else if (bMax && bMax !== b && maxEff > b.S * b.tg.neu.CF + 0.08 && bMax.S >= b.S + TUNE.warmerMinGain) warmer = bMax;
    }
    best.maxS = maxS; best.maxEff = maxEff; best.open = !!open; best.warmer = warmer;
    // alternates: single-piece swaps within the cost margin
    best.altT = altsFor(ctx, best, tcs, true, ext.clo);
    best.altL = altsFor(ctx, best, lcs, false, ext.clo);
    return best;
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
            alts.outer.push({ id: oMine.it.id, name: oMine.it.name + ' over the ' + iMine.it.name, cost: sc2.cost + 0.001, why: quieter ? 'quieter two-piece option' : 'two-piece option' });
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
    if (s.role === 'insul') return c.flags.indexOf('snug') >= 0 ? 'your warmth — under the rain shell (snug; size up this combo)' : 'your warmth — under the shell';
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
    if (s.role === 'overpant') return ctx.wet ? 'waterproof over the top' : 'wind block over the top';
    if (it.combo) return 'insulated & waterproof — bib goes on at the stand';
    if (it.quiet >= 9) return 'quiet soft-shell pant';
    if (it.clo <= 0.16) return 'lightweight & vented';
    return it.id === 'probrush_pant' ? 'brush protection' : 'all-rounder';
  }
  function renderOutfit(ctx, b, forcedWader) {
    const torso = b.tc.stack.map(function (s, k) { const ex = { fit: s.fit || s.it.fit, alt: (b.altT && b.altT[s.role]) || [] }; if (s.tag) ex.tag = s.tag; return pick(s.it, s.role, whyTorso(s, b.tc, ctx, k, b.tc.stack.length), ex); });
    const legs = b.lc.stack.map(function (s) { return pick(s.it, s.role, whyLegs(s, b.lc, ctx), { alt: (b.altL && b.altL[s.role]) || [] }); });
    return { torso: torso, legs: legs };
  }

  // ---------- walk-in outfit (deer medium) ----------
  // An independent enumeration over the sit pieces plus the uninsulated membrane shells / overpants (so in rain you
  // can walk in the plain rain shell and carry the insulated one). An insulated bib worn OVER a pant on the sit is
  // carried, not walked in. In dry weather this collapses to a subset of the sit stack. Carry = sit - walk.
  function buildWalk(ctxWalk, sit, pool, ext) {
    const sitIds = new Set(sit.tc.stack.map(function (s) { return s.it.id; }));
    const bib = sit.lc.stack.find(function (s) { return s.it.combo; });            // Gale Force bib, worn as pant or over one
    const plainShell = function (it) { return it.wp === 2 && it.ins === 'none' && it.pos.indexOf('outer') >= 0; };
    const hasPlain = pool.some(function (it) { return it.slot === 'torso' && plainShell(it); });
    const walkPool = pool.filter(function (it) {
      if (it.slot === 'legs') return !(bib && it.id === bib.it.id);               // the bib goes on at the stand
      if (it.slot !== 'torso') return true;
      // the insulated rain shell is carried, not walked in, when a plain shell exists and it is not frigid
      if (it.combo && hasPlain && ctxWalk.tempF > TUNE.walkComboBelowF) return false;
      if (sitIds.has(it.id)) return true;
      // plain rain shells may join the walk in rain or real wind (never as a dry-day add-on)
      return plainShell(it) && (ctxWalk.wet || ctxWalk.windBody >= 10);
    });
    // legs: the sit legs minus the carried bib; a plain overpant may be added in rain/wind (validLegs decides)
    const forced = { legsBase: sit.lc.stack.filter(function (s) { return !(bib && s.it.id === bib.it.id); }) };
    let w = buildOutfit(ctxWalk, walkPool, ext, forced);
    if (!w) w = buildOutfit(ctxWalk, walkPool, ext, forced, true);
    return w;
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
  // ---------- still-hunt stop layer: move stack + one insulated outer-fit piece ----------
  // The moving outer keeps its place under the stop piece: a soft shell / fleece becomes the MID, a plain rain shell
  // stays on as the SHELL. If the stop piece is itself waterproof and the moving outer is a plain rain shell, the
  // stop piece REPLACES it (swap, not stack). A combo (insulated rain shell) is never covered; nothing covers the Haven.
  // STOP-PIECE COHERENCE: like the outfit chain, the carried piece is memoised per hunt from the warm anchor down, and
  // changing it from the piece chosen 1 degF warmer costs TUNE.cost.stopStability — unless that piece now runs short by
  // more than deficitTol (then the swap is earned). Stops a Proximity/Haven flip-flop every degree.
  const stopChain = new Map();
  function stopRef(ctxStop, pool, forced) {
    if (ctxStop.depth > 0 || !TUNE.cost.stopStability) return null;
    const want = Math.round(ctxStop.tempF) + 1;
    if (want > CHAIN_TOP) return null;
    const sig = 'stop#' + chainSig(ctxStop, pool, forced);
    let chain = stopChain.get(sig);
    if (!chain) { if (stopChain.size > 48) stopChain.clear(); chain = {}; stopChain.set(sig, chain); }
    if (chain[want] !== undefined) return chain[want];
    let start = CHAIN_TOP; while (start > want && chain[start] !== undefined) start--;
    for (let t = start; t >= want; t--) {
      if (chain[t] !== undefined) continue;
      const inp = Object.assign({}, ctxStop.input, { wx: Object.assign({}, ctxStop.input.wx, { tempF: t }) });
      const cMove = makeCtx(inp, 'move'); const eMove = extremities(cMove, pool, inp);
      const mv = buildOutfit(cMove, pool, eMove, forced);                    // outfit chain is memoised, so this is cheap
      let piece = null;
      if (mv) { const cS = makeCtx(inp, 'stop'); cS.depth = 1; cS.stopRef = (t + 1 <= CHAIN_TOP) ? chain[t + 1] : null; const st = buildStop(cS, mv, pool, eMove, forced); piece = st && st.piece ? st.piece.id : null; }
      chain[t] = piece;
    }
    return chain[want];
  }
  function buildStop(ctxStop, move, pool, ext, forced) {
    const moveOuter = move.tc.outer;
    const notWorn = function (it) { return !move.tc.stack.some(function (s) { return s.it.id === it.id; }); };
    if (ctxStop.depth === 0) ctxStop.stopRef = stopRef(ctxStop, pool, forced);
    const refId = ctxStop.stopRef || null;
    // the moving kit already holds the stop target (+ tolerance) standing still: nothing to carry
    const moveSc = score(ctxStop, move.tc, move.lc, ext.clo, true);
    if (moveSc && moveSc.S >= moveSc.R + TUNE.deficitTol) return { tc: move.tc, lc: move.lc, S: moveSc.S, R: moveSc.R, cost: moveSc.cost, tg: moveSc.tg, piece: null, flags: [], maxS: moveSc.S, short: false, enough: true };
    let cands = pool.filter(function (it) { return it.slot === 'torso' && it.fit === 'outer' && (it.ins === 'syn' || it.ins === 'down') && eligible(it, ctxStop.dressF, TUNE.optWiden) && notWorn(it); });
    // the insulated rain shell is a wet / frigid piece — not the thing to pull on at a 40-degree dry stop when a quieter puffy fits
    if (!ctxStop.wet && ctxStop.tempF > TUNE.comboDryMaxF && cands.some(function (c) { return !c.combo; })) cands = cands.filter(function (c) { return !c.combo; });
    // nothing insulated fits (mild day): a soft shell goes on at stops instead (the "optional outer" of the moving kit);
    // a plain rain shell is a dry-day stop piece only when no soft shell exists, and never at/above noOuterAboveF dry
    if (!cands.length) {
      cands = pool.filter(function (it) { return it.slot === 'torso' && it.fit === 'outer' && it.pos.indexOf('outer') >= 0 && !it.combo && eligible(it, ctxStop.dressF, TUNE.optWiden) && notWorn(it); });
      if (!ctxStop.wet) {
        if (ctxStop.tempF >= TUNE.noOuterAboveF) cands = [];
        else if (cands.some(function (c) { return !(c.wp === 2 && c.ins === 'none'); })) cands = cands.filter(function (c) { return !(c.wp === 2 && c.ins === 'none'); });
      }
    }
    const movingOuterIsShell = moveOuter.wp === 2 && moveOuter.ins === 'none' && move.tc.stack[move.tc.stack.length - 1].role === 'outer';
    // in rain: an INSULATED waterproof piece (Gale Force) goes on over / instead of the shell; otherwise, if you are
    // walking in a plain shell, the stop piece goes on under it (swapping one empty shell for another adds nothing);
    // with nothing waterproof owned at all, the piece simply gets wet (penalised)
    if (ctxStop.wet) {
      const insWp = cands.filter(function (c) { return c.wp === 2 && c.ins !== 'none'; });
      if (insWp.length) cands = insWp;
      else if (movingOuterIsShell) cands = cands.filter(function (c) { return c.wp !== 2; });
    }
    if (moveOuter.combo || moveOuter.terminal) cands = [];
    const stopShort = function (S, R) { return ctxStop.tempF < TUNE.stopNeverShortF && hoursOfComfort(S, R, ctxStop.sitHours) < TUNE.stopMinHours; };
    const rescore = function () {
      const sc = score(ctxStop, move.tc, move.lc, ext.clo, true);
      if (!sc) return null;
      return { tc: move.tc, lc: move.lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, piece: null, flags: [], maxS: sc.S, short: stopShort(sc.S, sc.R) };
    };
    if (!cands.length) return rescore();
    let best = null, maxS = 0; const scored = [];
    cands.forEach(function (c) {
      let mult = 1, flags = [];
      const swap = movingOuterIsShell && c.wp === 2;                              // waterproof stop piece replaces the plain shell
      // rain, plain shell on, stop piece not waterproof: it goes on UNDER the shell (shell off, piece on, shell back on)
      const underShell = ctxStop.wet && movingOuterIsShell && c.wp !== 2;
      const under = move.tc.stack.filter(function (s) { return !((swap || underShell) && s.it.id === moveOuter.id); });
      const last = under[under.length - 1];
      if (underShell) { if (c.fit === 'outer' && !moveOuter.overInsul) { mult *= TUNE.compress[c.ins] || 1; flags.push('snug'); } }
      else if (last && last.role === 'outer' && last.fit === 'outer' && !(last.it.wp === 2 && last.it.ins === 'none')) { mult *= TUNE.outerOverOuter; flags.push('overouter'); }
      if (ctxStop.wet && c.wp !== 2 && !underShell) { mult *= TUNE.wetNoShell[c.ins] || 1; flags.push('soaked'); }
      const stack = under.map(function (s) {
        if (s.role !== 'outer') return { it: s.it, role: s.role, fit: s.fit };
        // the former outer now sits under the stop piece: role 'shell', tagged SHELL (rain shell) or MID (soft shell / fleece)
        return { it: s.it, role: 'shell', fit: s.fit, under: c.name, tag: (s.it.wp === 2 && s.it.ins === 'none') ? 'SHELL' : 'MID' };
      });
      if (underShell) { stack.push({ it: c, role: 'insul', fit: c.fit }); stack.push({ it: moveOuter, role: 'outer', fit: moveOuter.fit }); }
      else stack.push({ it: c, role: 'outer', fit: c.fit });
      const m = {}; m[c.id] = mult;
      const tc = { stack: stack, mult: m, flags: flags, outerWind: underShell ? moveOuter.wind : c.wind, outer: underShell ? moveOuter : c, swapped: swap ? moveOuter : null, underShell: underShell };
      const sc = score(ctxStop, tc, move.lc, ext.clo, true);
      if (!sc) return;
      sc.cost += (TUNE.cost.carryWeight - TUNE.cost.weight) * (c.w || 0);   // it rides in the pack all day
      scored.push({ c: c, sc: sc, tc: tc, flags: flags, underShell: underShell });
    });
    // hysteresis: stay with the piece carried 1 degF warmer unless it now runs short by more than deficitTol
    const refCand = refId ? scored.find(function (x) { return x.c.id === refId; }) : null;
    const refShort = refCand ? (refCand.sc.R - refCand.sc.S > TUNE.deficitTol) : true;
    scored.forEach(function (x) {
      const sc = x.sc;
      if (refCand && !refShort && x.c.id !== refId) sc.cost += TUNE.cost.stopStability;
      if (sc.S > maxS) maxS = sc.S;
      if (!best || sc.cost < best.cost) best = { tc: x.tc, lc: move.lc, S: sc.S, R: sc.R, cost: sc.cost, tg: sc.tg, piece: x.c, flags: x.flags, swapped: x.tc.swapped, underShell: x.underShell };
    });
    if (!best) return rescore();
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
    const EXT = ['head', 'neck', 'hands'];

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
      const CF = targetFor(ctx, b.tc.outerWind).neu.CF;
      const ph = { key: ctx.key, label: keyLabel, torso: ro.torso, legs: ro.legs,
        head: ext.head, neck: ext.neck, hands: ext.hands, feet: ext.feet, vest: ext.vest, carry: [],
        budget: { need: round2(b.R), have: round2(b.S), eff: round2(b.S * CF), needEff: round2(b.R * CF), maxEff: round2(b.maxEff != null ? b.maxEff : b.S * CF),
          short: !!b.short, hours: null, sitHours: ctx.sitHours, wct: ctx.wct, dressF: ctx.dressF, windBody: round2(ctx.windBody), met: ctx.met, outerWind: b.tc.outerWind, moving: !!ctx.moving } };
      // hours are measured against the hours-independent reference target (F7); a stop has its own rule (buildStop)
      const refR = refTargetFor(ctx, b.tc.outerWind);
      ph.budget.refNeed = round2(refR);
      ph.budget.hours = (ctx.tempF >= TUNE.neverShortAboveF && ctx.key !== 'stop') ? ctx.sitHours : hoursOfComfort(b.S, refR, ctx.sitHours);
      ph.budget.short = ctx.key === 'stop' ? !!b.short : ph.budget.hours < ctx.sitHours;
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
    const phMain = phaseResult(ctxMain, main, extMain, labelMain, null);
    phases.push(phMain);

    // ----- second phase -----
    if (mode === 'deer' && act === 'medium') {
      const ctxWalk = makeCtx(input, 'walk');
      const extWalk = extMain;                     // you walk in wearing the hat, gloves and boots you will sit in
      const walk = buildWalk(ctxWalk, main, pool, extWalk);
      if (walk) {
        const phWalk = phaseResult(ctxWalk, walk, extWalk, 'Walk in', null);
        phWalk.torso = phWalk.torso.filter(function (p) { return !p.opt; });          // no optional outers on the walk — the sit outer is what gets carried
        phMain.carry = carryDiff(phMain, phWalk, 'carried in — goes on once you are settled');
        const bib = phMain.legs.find(function (p) { const it = pool.find(function (x) { return x.id === p.id; }); return it && it.combo; });
        if (bib) { phMain.carry.forEach(function (c) { if (c.id === bib.id) c.why = 'bib goes on over your pants at the stand'; }); }
        // walk shell differs from the sit outer (rain): say so
        const wOuter = phWalk.torso[phWalk.torso.length - 1], sOuter = phMain.torso.filter(function (p) { return !p.opt; }).slice(-1)[0];
        const sitIds = new Set(phMain.torso.map(function (p) { return p.id; }));
        if (wOuter && wOuter.role === 'outer' && !sitIds.has(wOuter.id)) {
          wOuter.why = 'walk in the plain shell — swap at the stand';
          notes.push('Swap to the ' + sOuter.name + ' at the stand; the ' + wOuter.name + ' is just for the walk in.');
        }
        const wPant = phWalk.legs.find(function (p) { return p.role === 'pant'; }), sPant = phMain.legs.find(function (p) { return p.role === 'pant'; });
        if (wPant && sPant && wPant.id !== sPant.id) notes.push('Walk in the ' + wPant.name + '; the ' + sPant.name + ' goes on at the stand.');
        phases.unshift(phWalk);
      }
    } else if (mode === 'deer' && act === 'high') {
      const ctxStop = makeCtx(input, 'stop');
      const stop = buildStop(ctxStop, main, pool, extMain, forced);
      if (stop && stop.piece) {
        const phStop = phaseResult(ctxStop, stop, extMain, 'At stops', phMain);
        phStop.torso.forEach(function (p) { if (p.id === stop.piece.id) p.why = stop.underShell ? ('shell off, this on, shell back on when you stop' + (stop.flags.indexOf('snug') >= 0 ? ' (snug)' : '')) : stop.swapped ? ('pull on instead of the ' + stop.swapped.name + ' when you stop') : (stop.flags.indexOf('overouter') >= 0 ? 'pull on over the soft shell when you stop (snug)' : 'pull on over everything when you stop'); });
        phStop.carry = [{ id: stop.piece.id, name: stop.piece.name, why: 'rides in the pack — on at stops, off before you walk' }];
        phases.push(phStop);
        if (stop.flags.indexOf('overouter') >= 0) flags.push({ kind: 'info', ic: '📏', txt: '<b>Snug combo.</b> The ' + stop.piece.name + ' over your soft shell is two outer-fit pieces — it works, but it fits tight.' });
        if (stop.swapped) notes.push('At stops the ' + stop.piece.name + ' replaces the ' + stop.swapped.name + ' — it is waterproof itself.');
        if (stop.underShell) notes.push('At stops the ' + stop.piece.name + ' goes on under the ' + main.tc.outer.name + ' — nothing you own is waterproof over it.');
        if (stop.short) gaps.push('At stops this is the warmest you can throw on over the moving kit — keep the stops under an hour.');
      } else if (stop && stop.short) {
        const phStop = phaseResult(ctxStop, stop, extMain, 'At stops', phMain);
        phStop.carry = [];
        phases.push(phStop);
        gaps.push('Nothing in your kit adds warmth over the ' + main.tc.outer.name + ' at stops — keep stops under an hour.');   // (no hours wording: stops are not sits)
      } else {
        notes.push('Nothing extra needed at stops — the moving kit holds its warmth standing still at this temperature.');
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
    if (main.tc.flags.indexOf('snug') >= 0) flags.push({ kind: 'info', ic: '📏', txt: '<b>Snug combo.</b> A rain shell over an outer-fit insulated jacket fits tight and squeezes a little loft — it is still the warmest wet-weather stack you own.' });
    const mainShort = phMain.budget.short;
    if (mainShort) {
      const h = fmtHours(phMain.budget.hours);
      if (ctx.moving) {
        flags.push({ kind: 'warn', ic: '🧊', txt: '<b>Runs cold.</b> Even the warmest moving kit you own runs cold at ' + tempR + '° — keep moving, and keep the stops short.' });
        gaps.push('This is the warmest you own that still breathes on the move at ' + tempR + '°' + (ctx.windy ? ' with this wind' : '') + ' — keep moving.');
      } else if (phMain.budget.warmer) {
        const w = phMain.budget.warmer;
        flags.push({ kind: 'warn', ic: '🧊', txt: '<b>Runs a little short.</b> This stack is good for ' + h + ' at ' + tempR + '°; ' + w.torso.join(' > ') + ' would get you the full sit.' });
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
    const insulUnderShell = rainShellOuter && main.tc.stack.some(function (s) { return s.role === 'insul' || (s.role === 'mid' && s.it.ins !== 'none'); });
    if (mainKey === 'sit') {
      if (hasWalkCard) { /* walk-in card + swap note carry the instruction */ }
      else if (rainShellOuter) {
        if (mainOuter.combo) notes.push('Walk in with the ' + mainOuter.name + ' on and the vents open — it is your shell and your insulation in one.');
        else if (insulUnderShell) notes.push('Walk in with the shell on and the vents open; the insulation goes on under it once you are settled.');
      }
      else if (worn.length >= 3) notes.push('Dress for the sit. Walk in with the ' + outerMain.name + ' off and put it on once you are settled and cooling.');
      else if (ctx.tempF >= 45 && ctx.tempF < 60 && !mainShort && worn.length === 2 && !mainOuter.combo && mainOuter.ins !== 'down') notes.push('Light sit — ' + outerMain.name + ' over your base is all you need.');
      else if (ctx.tempF >= 60) notes.push('Warm sit — go light, hydrate, and watch for ticks.');
      else if (worn.length === 2) notes.push('Dress for the sit. Walk in with the ' + outerMain.name + ' off and put it on once you are settled.');
      if (ctx.wet && !wetTorsoGap) notes.push('Rain shell goes on last; everything warm stays underneath it.');
      if (mode === 'waterfowl' && wfEnv !== 'dry') notes.push('The waders are your waterproofing — everything below the chest layers under them.');
      if (mode === 'waterfowl' && wfEnv === 'dry') notes.push('Dry-ground setup — boots and pants, no waders; stay out of standing water.');
    } else if (mainKey === 'move') {
      notes.push('Still-hunt loadout — dressed to move without soaking out. Strip a layer before you stop so the base dries.');
    } else if (mode === 'upland') {
      notes.push('You warm up in the first hundred yards — if you are comfortable at the truck, you are overdressed.');
      notes.push(phMain.torso.some(function (p) { return p.opt; }) ? 'Brush pants earn their keep busting cover; the soft shell is for wind and glassing breaks only.' : 'Brush pants earn their keep busting cover.');
    }
    if (ctx.wct <= 20) notes.push('Wind chill near ' + ctx.wct + '° on exposed skin — ' + (phMain.neck.length ? 'gaiter up and ' : '') + 'keep the gloves on.');
    // camo note is the app's job (needs location); engine stays location-free

    return { version: VERSION, phases: phases, flags: flags, notes: dedupeNotes(notes, pool).slice(0, 4), gaps: gaps };
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
    torsoCombos(ctx, pool, false).forEach(function (tc) { legsCombos(ctx, pool, false, forced).forEach(function (lc) {
      const sc = score(ctx, tc, lc, ext.clo); if (!sc) return;
      rows.push({ torso: tc.stack.map(function (x) { return x.it.name; }).join(' > '), legs: lc.stack.map(function (x) { return x.it.name; }).join(' + '), S: round2(sc.S), R: round2(sc.R), cost: round2(sc.cost), layers: tc.stack.length + lc.stack.length, loud: loudness(tc) + loudness(lc), kg: round2(weight(tc) + weight(lc)) });
    }); });
    return rows.sort(function (a, b) { return a.cost - b.cost; }).slice(0, n || 10);
  }

  return {
    VERSION: VERSION, TUNE: TUNE, CATALOG: CATALOG, ROLE_LABEL: ROLE_LABEL, ROLE_ORDER: ROLE_ORDER,
    requiredClo: requiredClo, targetClo: targetClo, hoursOfComfort: hoursOfComfort, fmtHours: fmtHours, windChill: windChill,
    estimateClo: estimateClo, normalizeCustom: normalizeCustom, applyOverrides: applyOverrides, recommend: recommend, debugCombos: debugCombos
  };
});
