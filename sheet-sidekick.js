const SS_MODULE_ID = "sheet-sidekick";
const SS_SHEET_FORM_SELECTOR = "form.ss-sheet, form.sheet-sidekick-sheet";
const SS_SHEET_DND5E_CHAR_FORM_SELECTOR = "form.ss-sheet.dnd5e2.sheet.actor.character, form.sheet-sidekick-sheet.dnd5e2.sheet.actor.character";

function getSheetSidekickModule() {
  return game.modules.get(SS_MODULE_ID) ?? null;
}

function isSheetSidekickModuleActive() {
  return !!getSheetSidekickModule()?.active;
}

function getSheetSidekickSettingsNamespace() {
  return SS_MODULE_ID;
}

function getSheetSidekickSetting(key, fallback = null) {
  const settingKey = String(key ?? "").trim();
  if (!settingKey) return fallback;
  try {
    const value = game.settings.get(getSheetSidekickSettingsNamespace(), settingKey);
    if (value !== undefined) return value;
  } catch (_err) {
    // fall through
  }
  return fallback;
}

function getSheetSidekickFormElements(root = document) {
  return Array.from(root.querySelectorAll?.(SS_SHEET_FORM_SELECTOR) ?? []);
}

function shouldForceNoCanvasForSheetSidekickUser() {
  const sheetSidekick = getSheetSidekickModule();
  if (!sheetSidekick?.active) return false;

  const playerData = getSheetSidekickSetting("playerdata", {}) ?? {};
  const userData = playerData[game.user.id];
  if (!userData?.display) return false;

  const threshold = Number(userData.screenwidth ?? 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return true;

  const screenWidth = window.screen?.width ?? window.innerWidth ?? 0;
  return screenWidth < threshold;
}

function isSheetSidekickPlayerFastPath() {
  if (!game.user || game.user.isGM) return false;
  try {
    return shouldForceNoCanvasForSheetSidekickUser();
  } catch (_err) {
    return false;
  }
}

function isSheetSidekickClientUser() {
  if (!game.user || game.user.isGM) return false;

  const sheetSidekick = getSheetSidekickModule();
  if (!sheetSidekick?.active) return false;

  try {
    if (sheetSidekick.api?.isSheetSidekick?.()) return true;
  } catch (_err) {
    // Fall through to local setting checks.
  }

  try {
    return shouldForceNoCanvasForSheetSidekickUser();
  } catch (_err) {
    return false;
  }
}

function escapeHtml(value) {
  const text = String(value ?? "");
  if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function collectItemRollHints(item, actor = null, castLevel = null, ammoItemId = null) {
  if (!item) return [];
  const seen = new Set();
  const attackHints = [];
  const saveHints = [];
  const damageHints = [];
  const healingHints = [];
  const formulaHints = [];
  const componentHints = [];
  const miscHints = [];
  const abilityMap = {
    str: "STR",
    dex: "DEX",
    con: "CON",
    int: "INT",
    wis: "WIS",
    cha: "CHA",
    strength: "STR",
    dexterity: "DEX",
    constitution: "CON",
    intelligence: "INT",
    wisdom: "WIS",
    charisma: "CHA"
  };

  const rollData = actor?.getRollData?.() ?? {};
  const spellAbilityKey = String(actor?.system?.attributes?.spellcasting ?? "").toLowerCase();
  const actorSpellMod = Number(actor?.system?.attributes?.spellmod
    ?? rollData?.abilities?.[spellAbilityKey]?.mod
    ?? 0);
  const prof = Number(actor?.system?.attributes?.prof ?? rollData?.prof ?? 0);
  const baseSpellLevel = Number(item.system?.level ?? 0);
  const selectedCastLevelRaw = Number(castLevel);
  const selectedCastLevel = Number.isFinite(selectedCastLevelRaw) ? selectedCastLevelRaw : baseSpellLevel;
  const selectedAmmoId = String(ammoItemId ?? "").trim();
  const selectedAmmo = (actor && selectedAmmoId) ? actor.items.get(selectedAmmoId) : null;
  const selectedAmmoQty = Number(selectedAmmo?.system?.quantity ?? selectedAmmo?.system?.uses?.value ?? 0);
  const ammoAttackBonus = Number(selectedAmmo?.system?.attackBonus ?? selectedAmmo?.system?.magicalBonus ?? 0);
  const ammoDamageBonusRaw = String(selectedAmmo?.system?.damage?.base?.bonus ?? selectedAmmo?.system?.damage?.bonus ?? "").trim();

  const pushUnique = (bucket, text) => {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (/<[^>]+>/.test(clean)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(clean);
  };

  const normalizeAbility = (value) => {
    let raw = value;
    if (raw instanceof Set) raw = Array.from(raw)[0];
    if (Array.isArray(raw)) raw = raw[0];
    if (raw && typeof raw === "object") raw = raw.ability ?? raw.value ?? raw.key ?? raw.id ?? "";
    if (!raw) return "";
    const key = String(raw).toLowerCase();
    return abilityMap[key] ?? String(raw).toUpperCase();
  };

  const formatAttackRoll = (rawBonus) => {
    const raw = String(rawBonus ?? "").trim();
    if (!raw) return "";
    if (/d20/i.test(raw)) return raw;
    if (/^[+-]\s*\d+$/i.test(raw)) return `d20 ${raw.replace(/\s+/g, "")}`;
    if (/^\d+$/i.test(raw)) return `d20 +${raw}`;
    return `d20 + ${raw}`;
  };

  const parseNumeric = (value) => {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    return null;
  };

  const resolveDc = (rawDc) => {
    const numeric = parseNumeric(rawDc);
    if (numeric !== null) return numeric;

    if (rawDc && typeof rawDc === "object") {
      const nestedValue = parseNumeric(rawDc.value ?? rawDc.flat ?? rawDc.dc);
      if (nestedValue !== null) return nestedValue;
      const calc = String(rawDc.calculation ?? rawDc.mode ?? "").toLowerCase();
      if (calc.includes("spell")) {
        const spellDc = parseNumeric(actor?.system?.attributes?.spelldc);
        if (spellDc !== null) return spellDc;
      }
    }

    const spellDc = parseNumeric(actor?.system?.attributes?.spelldc);
    if (spellDc !== null) return spellDc;
    return null;
  };

  const capitalize = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);

  const asTypeLabel = (types) => {
    if (!types) return "";
    if (types instanceof Set) types = Array.from(types);
    if (!Array.isArray(types) || !types.length) return "";
    return ` ${types.map((t) => capitalize(t)).join("/")}`;
  };

  const resolveFormulaTokens = (formula, fallbackMod = actorSpellMod) => {
    let out = String(formula ?? "");
    if (!out.trim()) return "";

    out = out.replace(/@abilities\.([a-z]+)\.mod/gi, (_m, ab) => {
      const key = String(ab ?? "").toLowerCase();
      const mod = Number(rollData?.abilities?.[key]?.mod ?? 0);
      return Number.isFinite(mod) ? String(mod) : "0";
    });
    out = out.replace(/@prof\b/gi, String(Number.isFinite(prof) ? prof : 0));
    out = out.replace(/@mod\b/gi, String(Number.isFinite(fallbackMod) ? fallbackMod : 0));
    return out;
  };

  const formatRollPiece = (number, denomination, bonus, scaling = null) => {
    let n = parseNumeric(number);
    const d = parseNumeric(denomination);
    if (n === null || d === null) return "";

    // Leveled spells: reflect selected cast level in suggested formula.
    if (
      item.type === "spell"
      && Number.isFinite(selectedCastLevel)
      && Number.isFinite(baseSpellLevel)
      && selectedCastLevel > baseSpellLevel
      && scaling
      && String(scaling.mode ?? "").toLowerCase() !== "none"
    ) {
      const scaleN = parseNumeric(scaling.number);
      if (scaleN !== null && scaleN > 0) {
        const steps = Math.max(0, selectedCastLevel - baseSpellLevel);
        n += scaleN * steps;
      }
    }

    let out = `${n}d${d}`;
    const b = resolveFormulaTokens(String(bonus ?? "").trim());
    if (b) out += /^[+-]/.test(b) ? b : `+${b}`;
    return out;
  };

  const applyFormulaScaling = (resolvedFormula, scaling, fallbackMod = actorSpellMod) => {
    const base = String(resolvedFormula ?? "").trim();
    if (!base) return base;
    if (
      item.type !== "spell"
      || !Number.isFinite(selectedCastLevel)
      || !Number.isFinite(baseSpellLevel)
      || selectedCastLevel <= baseSpellLevel
      || !scaling
      || typeof scaling !== "object"
      || String(scaling.mode ?? "").toLowerCase() === "none"
    ) return base;

    const steps = Math.max(0, selectedCastLevel - baseSpellLevel);
    if (!steps) return base;

    const diceMatch = base.match(/^(\d+)\s*d\s*(\d+)(\s*[+\-]\s*\d+)?$/i);
    if (diceMatch) {
      const baseDice = parseNumeric(diceMatch[1]);
      const die = parseNumeric(diceMatch[2]);
      const tailRaw = String(diceMatch[3] ?? "");
      const scalingNumber = parseNumeric(scaling.number);
      if (baseDice !== null && die !== null && scalingNumber !== null) {
        const nextDice = baseDice + (scalingNumber * steps);
        const tailMatch = tailRaw.match(/([+\-])\s*(\d+)/);
        const tail = tailMatch ? ` ${tailMatch[1]} ${tailMatch[2]}` : "";
        return `${nextDice}d${die}${tail}`;
      }
    }

    const baseConst = parseNumeric(base);
    if (baseConst === null) return base;

    const scalingFormula = resolveFormulaTokens(String(scaling.formula ?? "").trim(), fallbackMod);
    const formulaConst = parseNumeric(scalingFormula);
    if (formulaConst !== null) {
      return String(baseConst + (formulaConst * steps));
    }

    const scalingNumber = parseNumeric(scaling.number);
    if (scalingNumber !== null) {
      return String(baseConst + (scalingNumber * steps));
    }

    return base;
  };

  const addDamageLike = (bucket, prefix, data, fallbackMod = actorSpellMod) => {
    if (!data || typeof data !== "object") return;
    if (data.custom?.enabled && typeof data.custom?.formula === "string" && data.custom.formula.trim()) {
      const resolved = resolveFormulaTokens(data.custom.formula.trim(), fallbackMod);
      const scaled = applyFormulaScaling(resolved, data.scaling, fallbackMod);
      pushUnique(bucket, `${prefix}: ${scaled}`);
      return;
    }
    if (typeof data.formula === "string" && data.formula.trim()) {
      const resolved = resolveFormulaTokens(data.formula.trim(), fallbackMod);
      const scaled = applyFormulaScaling(resolved, data.scaling, fallbackMod);
      pushUnique(bucket, `${prefix}: ${scaled}`);
      return;
    }
    const piece = formatRollPiece(data.number, data.denomination, data.bonus, data.scaling);
    if (piece) {
      pushUnique(bucket, `${prefix}: ${piece}${asTypeLabel(data.types)}`);
    }
  };

  const activities = getItemActivities(item);

  const labels = item.labels ?? {};
  const fallbackLabelDamage = String(labels.damage ?? "").trim();
  if (labels.toHit) pushUnique(attackHints, `Attack: ${formatAttackRoll(labels.toHit)}`);
  if (Array.isArray(labels.attacks)) {
    labels.attacks.forEach((atk) => {
      const toHit = atk?.toHit ?? atk?.modifier;
      if (toHit) pushUnique(attackHints, `Attack: ${formatAttackRoll(toHit)}`);
    });
  }
  if (Array.isArray(labels.damages) && !(item.type === "spell" && activities.length)) {
    labels.damages.forEach((dmg) => {
      const formula = resolveFormulaTokens(String(dmg?.formula ?? "").trim());
      if (!formula) return;
      const type = String(dmg?.damageType ?? "").trim().toLowerCase();
      if (type === "healing") {
        pushUnique(healingHints, `Healing: ${formula} Healing`);
      } else {
        pushUnique(damageHints, `Damage: ${formula}${type ? ` ${capitalize(type)}` : ""}`);
      }
    });
  }
  if (labels.save) {
    const rawSave = String(labels.save).replace(/\s+/g, " ").trim();
    const dcMatch = rawSave.match(/\bdc\s*(\d+)\b/i);
    const abMatch = rawSave.match(/\b(str|dex|con|int|wis|cha|strength|dexterity|constitution|intelligence|wisdom|charisma)\b/i);
    if (dcMatch || abMatch) {
      const ab = normalizeAbility(abMatch?.[1] ?? "SAVE");
      const dc = dcMatch ? Number(dcMatch[1]) : (resolveDc(null) ?? "?");
      pushUnique(saveHints, `Save: ${ab} DC ${dc}`);
    } else {
      pushUnique(saveHints, `Save: ${rawSave}`);
    }
  }
  if (labels.formula) pushUnique(formulaHints, `Formula: ${resolveFormulaTokens(String(labels.formula).trim())}`);

  if (!labels.toHit && item.system?.attackBonus) {
    pushUnique(attackHints, `Attack: ${formatAttackRoll(item.system.attackBonus)}`);
  }

  for (const activity of activities) {
    const atk = activity?.attack ?? {};
    const atkAbility = normalizeAbility(atk?.ability);
    const atkBonus = atk?.bonus || labels.toHit || "";
    const isAttackType = String(activity?.type ?? "").toLowerCase() === "attack";
    if (atkBonus || atkAbility || isAttackType) {
      const atkText = formatAttackRoll(resolveFormulaTokens(atkBonus));
      let text = `Attack: ${atkText || "d20"}`;
      if (atkAbility) text += ` (${atkAbility})`;
      pushUnique(attackHints, text);
    }

    const save = activity?.save ?? {};
    const saveAbility = normalizeAbility(save?.ability ?? save?.type ?? save?.abilities);
    const saveDc = resolveDc(save?.dc);
    const isSaveType = String(activity?.type ?? "").toLowerCase() === "save";
    if (saveAbility || saveDc !== null || isSaveType) {
      const abilityText = saveAbility || "SAVE";
      const dcText = (saveDc !== null) ? saveDc : "?";
      pushUnique(saveHints, `Save: ${abilityText} DC ${dcText}`);
    }

    const fallbackMod = Number(
      rollData?.abilities?.[String(atk?.ability ?? "").toLowerCase()]?.mod
      ?? actorSpellMod
      ?? 0
    );

    const activityDamage = activity?.damage ?? {};
    const activityPartsRaw = activityDamage.parts ?? activityDamage?.base?.parts ?? [];
    const activityParts = Array.isArray(activityPartsRaw)
      ? activityPartsRaw
      : Object.values(activityPartsRaw ?? {});
    const activityType = String(activity?.type ?? "").toLowerCase();
    const damagePrefix = activityType === "heal" ? "Healing" : "Damage";
    const damageBucket = activityType === "heal" ? healingHints : damageHints;
    for (const part of activityParts) {
      addDamageLike(damageBucket, damagePrefix, part, fallbackMod);
    }
    if (typeof activityDamage?.formula === "string" && activityDamage.formula.trim()) {
      pushUnique(damageBucket, `${damagePrefix}: ${resolveFormulaTokens(activityDamage.formula.trim(), fallbackMod)}`);
    }

    const healing = activity?.healing ?? {};
    if (Object.keys(healing).length) {
      addDamageLike(healingHints, "Healing", healing, actorSpellMod);
    }
  }

  const legacySave = item.system?.save ?? {};
  const legacySaveAbility = normalizeAbility(legacySave?.ability ?? legacySave?.type);
  const legacySaveDc = resolveDc(legacySave?.dc);
  if (legacySaveAbility || legacySaveDc !== null) {
    const abilityText = legacySaveAbility || "SAVE";
    const dcText = (legacySaveDc !== null) ? legacySaveDc : "?";
    pushUnique(saveHints, `Save: ${abilityText} DC ${dcText}`);
  }

  const baseDamage = item.system?.damage?.base ?? {};
  addDamageLike(damageHints, "Damage", baseDamage);

  const legacyParts = item.system?.damage?.parts;
  if (Array.isArray(legacyParts)) {
    for (const part of legacyParts) {
      if (Array.isArray(part)) {
        const formula = resolveFormulaTokens(String(part[0] ?? "").trim());
        if (formula) pushUnique(damageHints, `Damage: ${formula}`);
      } else {
        addDamageLike(damageHints, "Damage", part);
      }
    }
  }

  if (typeof item.system?.formula === "string" && item.system.formula.trim()) {
    pushUnique(formulaHints, `Formula: ${resolveFormulaTokens(item.system.formula.trim())}`);
  }
  if (typeof item.system?.damage?.formula === "string" && item.system.damage.formula.trim()) {
    pushUnique(formulaHints, `Formula: ${resolveFormulaTokens(item.system.damage.formula.trim())}`);
  }

  const components = labels?.components?.vsm || "";
  const mat = String(item.system?.materials?.value ?? "").trim();
  if (components || mat) {
    pushUnique(componentHints, `Components: ${components || "-"}${mat ? ` (${mat})` : ""}`);
  }

  if (selectedAmmo) {
    const ammoName = String(selectedAmmo.name ?? "Ammo");
    const ammoTail = Number.isFinite(selectedAmmoQty) ? ` (${Math.max(0, selectedAmmoQty)} left)` : "";
    const bonusBits = [];
    if (Number.isFinite(ammoAttackBonus) && ammoAttackBonus !== 0) {
      bonusBits.push(`${ammoAttackBonus > 0 ? "+" : ""}${ammoAttackBonus} atk`);
    }
    if (ammoDamageBonusRaw) {
      bonusBits.push(`${ammoDamageBonusRaw} dmg`);
    }
    const bonusText = bonusBits.length ? `, ${bonusBits.join(", ")}` : "";
    pushUnique(miscHints, `Ammo: ${ammoName}${ammoTail}${bonusText}`);
  }

  // Consumption/resource hints (ammo, charges, class resources).
  const findActorItemByRef = (ref) => {
    if (!actor || !ref) return null;
    const key = String(ref).trim();
    if (!key) return null;
    return actor.items?.get?.(key)
      ?? actor.items?.find?.((i) => String(i?.name ?? "").toLowerCase() === key.toLowerCase())
      ?? null;
  };
  const knownResourceLabel = (rawPath) => {
    const path = String(rawPath ?? "").toLowerCase();
    if (!path) return "";
    if (path.includes("channeldivinity") || path.includes("channel-divinity") || path.includes("channel divinity")) return "Channel Divinity";
    if (path.includes("focus")) return "Focus Points";
    if (path.includes("ki")) return "Ki Points";
    if (path.includes("sorcery")) return "Sorcery Points";
    if (path.includes("superiority")) return "Superiority Dice";
    if (path.includes("hitdie") || path.includes("hit-die")) return "Hit Dice";
    if (path.includes("inspiration")) return "Inspiration";
    if (path.includes("resource")) return "Class Resource";
    return "";
  };
  const isAmmoLikeItem = (doc) => {
    if (!doc) return false;
    const subtype = String(doc.system?.consumableType ?? doc.system?.type?.value ?? "").toLowerCase();
    if (subtype === "ammo" || subtype === "ammunition") return true;
    const name = String(doc.name ?? "").toLowerCase();
    return /\b(ammo|ammunition|arrow|bolt|bullet|shot|dart|stone|quiver)\b/.test(name);
  };
  const addResourceHint = (label, amount = null, remaining = null, max = null) => {
    const qty = Number.isFinite(amount) && amount > 0 ? ` x${amount}` : "";
    const rem = Number.isFinite(remaining) && Number.isFinite(max) && max >= 0 ? ` (${remaining}/${max} left)` : "";
    pushUnique(miscHints, `Consumes: ${label}${qty}${rem}`);
  };

  if (item.system?.uses) {
    const usesVal = parseNumeric(item.system.uses.value);
    const usesMax = parseNumeric(item.system.uses.max);
    if (usesMax !== null && usesMax > 0) {
      addResourceHint("Item Uses", null, Math.max(0, usesVal ?? 0), usesMax);
    }
  }

  for (const activity of activities) {
    const consumption = activity?.consumption ?? {};
    const targetsRaw = consumption?.targets;
    const targets = Array.isArray(targetsRaw) ? targetsRaw : Object.values(targetsRaw ?? {});
    if (!targets.length) continue;
    for (const target of targets) {
      if (!target || typeof target !== "object") continue;
      const path = String(
        target.target
        ?? target.path
        ?? target.resource
        ?? target.id
        ?? target.name
        ?? ""
      ).trim();
      const amount = parseNumeric(target.value ?? target.amount ?? target.cost ?? target.count ?? 1) ?? 1;
      const linkedItem = findActorItemByRef(path);
      if (linkedItem) {
        if (isAmmoLikeItem(linkedItem)) continue;
        const left = parseNumeric(linkedItem.system?.quantity ?? linkedItem.system?.uses?.value);
        const max = parseNumeric(linkedItem.system?.uses?.max);
        addResourceHint(linkedItem.name, amount, left, max);
        continue;
      }
      const known = knownResourceLabel(path);
      if (known) addResourceHint(known, amount);
    }
  }

  const scaling = item.system?.scaling ?? {};
  if (scaling?.mode && scaling.mode !== "none" && item.type !== "spell") {
    const more = scaling?.formula ? `${scaling.mode} (${resolveFormulaTokens(scaling.formula)})` : scaling.mode;
    pushUnique(miscHints, `Higher levels: ${more}`);
  }
  if (item.type === "spell" && actor?.system?.attributes?.spelldc) {
    pushUnique(saveHints, `Spell Save DC: ${actor.system.attributes.spelldc}`);
  }

  // Use generic labels.damage only as fallback when no better structured damage was found.
  if (!damageHints.length && !healingHints.length && fallbackLabelDamage) {
    pushUnique(damageHints, `Damage: ${resolveFormulaTokens(fallbackLabelDamage)}`);
  }

  // Drop less-specific duplicates, e.g. "Damage: 1d6" when "Damage: 1d6+2 Bludgeoning" exists.
  const compact = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "");
  const damageCompacts = damageHints.map((h) => compact(h.replace(/^damage:\s*/i, "")));
  const prunedDamageHints = damageHints.filter((hint, idx) => {
    const mine = damageCompacts[idx];
    if (!mine) return false;
    return !damageCompacts.some((other, j) => {
      if (j === idx || !other || other === mine) return false;
      return other.startsWith(mine) && other.length > mine.length;
    });
  });

  const hasResolvedDamage = prunedDamageHints.some((h) => !/@[a-z_][a-z0-9_]*/i.test(h));
  const finalDamageHints = hasResolvedDamage
    ? prunedDamageHints.filter((h) => !/@[a-z_][a-z0-9_]*/i.test(h))
    : prunedDamageHints;
  const normalizeComparableRoll = (text) => String(text ?? "")
    .replace(/^(damage|healing):\s*/i, "")
    .replace(/\bhealing\b/gi, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const healingBodies = new Set(healingHints.map((h) => normalizeComparableRoll(h)));
  const dedupedDamageHintsRaw = healingHints.length
    ? finalDamageHints.filter((h) => {
      if (/\bhealing\b/i.test(h)) return false;
      const body = normalizeComparableRoll(h);
      return !healingBodies.has(body);
    })
    : finalDamageHints;
  const chooseMostInformativeByBody = (sourceHints) => {
    const byBody = new Map();
    sourceHints.forEach((hint) => {
      const body = normalizeComparableRoll(hint);
      if (!body) return;
      const prev = byBody.get(body);
      if (!prev || hint.length > prev.length) byBody.set(body, hint);
    });
    return Array.from(byBody.values());
  };
  const dedupedHealingHints = chooseMostInformativeByBody(healingHints);
  const damageTypeRegex = /\b(slashing|piercing|bludgeoning|acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder)\b/i;
  const isNumericDamageOnly = (h) => /^damage:\s*[0-9+\-*/ ().]+$/i.test(String(h ?? "").trim());
  const hasTypedOrDiceDamage = dedupedDamageHintsRaw.some((h) => /d\d+/i.test(h) || damageTypeRegex.test(h));
  const dedupedDamageHints = hasTypedOrDiceDamage
    ? dedupedDamageHintsRaw.filter((h) => !isNumericDamageOnly(h))
    : dedupedDamageHintsRaw;
  const suppressWeaponSaveHints = String(item.type ?? "").toLowerCase() === "weapon" && attackHints.length > 0;
  const finalSaveHints = suppressWeaponSaveHints ? [] : saveHints;

  const hints = [
    ...attackHints,
    ...finalSaveHints,
    ...dedupedDamageHints,
    ...dedupedHealingHints,
    ...miscHints,
    ...formulaHints,
    ...componentHints
  ];
  const maxHints = item.type === "spell" ? 10 : 8;
  return hints.slice(0, maxHints);
}

function getSpellSlotLevelChoices(actor, item) {
  if (!actor || !item || item.type !== "spell") return [];

  const baseLevel = Number(item.system?.level ?? 0);
  if (!Number.isFinite(baseLevel) || baseLevel <= 0) return [];

  const spells = actor.system?.spells ?? {};
  const byLevel = new Map();
  const upsert = (level, value, max, source = "slot") => {
    if (!Number.isFinite(level) || level <= 0) return;
    const normalized = {
      level,
      value: Number.isFinite(value) ? value : 0,
      max: Number.isFinite(max) ? max : 0,
      source
    };
    const prev = byLevel.get(level);
    if (!prev) {
      byLevel.set(level, normalized);
      return;
    }
    byLevel.set(level, {
      level,
      value: Math.max(prev.value, normalized.value),
      max: Math.max(prev.max, normalized.max),
      source: prev.source
    });
  };

  for (let level = baseLevel; level <= 9; level += 1) {
    const slot = spells[`spell${level}`];
    if (!slot) continue;
    const max = Number(slot.max ?? 0);
    const value = Number(slot.value ?? 0);
    if (max > 0 || value > 0) upsert(level, value, max, "slot");
  }

  const pact = spells.pact ?? null;
  const pactLevel = Number(pact?.level ?? 0);
  const pactMax = Number(pact?.max ?? 0);
  const pactValue = Number(pact?.value ?? 0);
  if (pactLevel >= baseLevel && (pactMax > 0 || pactValue > 0)) {
    upsert(pactLevel, pactValue, pactMax, "pact");
  }

  return Array.from(byLevel.values()).sort((a, b) => a.level - b.level);
}

function spellLevelLabel(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n <= 0) return String(level ?? "");
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function getItemActivities(item) {
  const raw = item?.system?.activities;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.contents)) return raw.contents;
  if (typeof raw?.values === "function") return Array.from(raw.values());
  return Object.values(raw);
}

function getAmmoChoices(actor, item) {
  if (!actor || !item) return { required: false, choices: [], defaultId: "" };

  const activities = getItemActivities(item);
  const extractRef = (raw) => {
    if (!raw) return "";
    if (typeof raw === "string") return raw.trim();
    if (typeof raw === "number") return String(raw);
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const found = extractRef(value);
        if (found) return found;
      }
      return "";
    }
    if (raw instanceof Set) {
      for (const value of raw.values()) {
        const found = extractRef(value);
        if (found) return found;
      }
      return "";
    }
    if (typeof raw === "object") {
      if (raw.item && typeof raw.item === "object") {
        const nested = extractRef(raw.item);
        if (nested) return nested;
      }
      const candidates = [
        raw.id,
        raw.itemId,
        raw.uuid,
        raw.value,
        raw.key,
        raw.name,
        raw.target,
        raw.path,
        raw.resource
      ];
      for (const candidate of candidates) {
        const found = extractRef(candidate);
        if (found) return found;
      }
    }
    return "";
  };
  const explicitRefs = new Set();
  activities.forEach((activity) => {
    const ammoRef = extractRef(activity?.ammunition);
    if (ammoRef) explicitRefs.add(ammoRef);
    const targetsRaw = activity?.consumption?.targets;
    const targets = Array.isArray(targetsRaw) ? targetsRaw : Object.values(targetsRaw ?? {});
    targets.forEach((target) => {
      const targetType = String(target?.type ?? target?.kind ?? target?.consumptionType ?? "").toLowerCase();
      if (!targetType.includes("ammo")) return;
      const ref = extractRef(target);
      if (ref) explicitRefs.add(ref);
    });
  });
  const systemAmmo = extractRef(item.system?.ammunition);
  if (systemAmmo) explicitRefs.add(systemAmmo);

  const asQty = (i) => {
    const q = Number(i?.system?.quantity ?? i?.system?.uses?.value ?? 0);
    return Number.isFinite(q) ? q : 0;
  };
  const keywordScore = (name = "") => {
    const n = String(name).toLowerCase();
    if (/\bbolts?\b/.test(n)) return 3;
    if (/\barrows?\b/.test(n)) return 3;
    if (/\bbullets?\b/.test(n)) return 2;
    if (/\bstones?\b/.test(n)) return 2;
    if (/\bdarts?\b/.test(n)) return 2;
    if (/\bammo|ammunition|quiver|cartridge|shot\b/.test(n)) return 1;
    return 0;
  };
  const isAmmoCandidate = (i) => {
    if (!i || i.id === item.id) return false;
    const type = String(i.type ?? "").toLowerCase();
    if (!["consumable", "loot", "tool", "backpack", "equipment", "weapon"].includes(type)) return false;
    const subtype = String(i.system?.consumableType ?? i.system?.type?.value ?? "").toLowerCase();
    if (subtype === "ammo" || subtype === "ammunition") return true;
    return keywordScore(i.name) > 0;
  };
  const attackName = String(item.name ?? "").toLowerCase();
  const matchesWeapon = (i) => {
    const n = String(i.name ?? "").toLowerCase();
    if (/crossbow/.test(attackName)) return /\bbolt/.test(n);
    if (/\bbow\b|longbow|shortbow/.test(attackName)) return /\barrow/.test(n);
    if (/sling/.test(attackName)) return /\bstone|bullet/.test(n);
    if (/dart/.test(attackName)) return /\bdart/.test(n);
    return true;
  };

  const explicitItems = Array.from(explicitRefs)
    .map((ref) => actor.items.get(ref) ?? actor.items.find((i) => String(i.name ?? "").toLowerCase() === ref.toLowerCase()))
    .filter((i) => !!i && isAmmoCandidate(i) && matchesWeapon(i));

  const explicitRequired = explicitItems.length > 0;
  const propertyAmm = item.system?.properties?.amm === true
    || item.system?.properties?.has?.("amm")
    || /\bcrossbow|bow|sling|dart\b/.test(attackName);
  const required = explicitRequired || !!propertyAmm;
  if (!required) return { required: false, choices: [], defaultId: "" };

  const inferred = actor.items.filter((i) => isAmmoCandidate(i) && matchesWeapon(i));
  const source = [...explicitItems, ...inferred];

  const seen = new Set();
  const choices = [];
  source.forEach((ammo) => {
    if (seen.has(ammo.id)) return;
    seen.add(ammo.id);

    const qty = asQty(ammo);
    const atkBonus = Number(ammo.system?.attackBonus ?? ammo.system?.magicalBonus ?? 0);
    const dmgBonusRaw = String(ammo.system?.damage?.base?.bonus ?? ammo.system?.damage?.bonus ?? "").trim();
    const bonusBits = [];
    if (Number.isFinite(atkBonus) && atkBonus !== 0) bonusBits.push(`${atkBonus > 0 ? "+" : ""}${atkBonus} atk`);
    if (dmgBonusRaw) bonusBits.push(`${dmgBonusRaw} dmg`);
    const bonusText = bonusBits.length ? `, ${bonusBits.join(", ")}` : "";
    const label = `${ammo.name} (${qty} left${bonusText})`;
    choices.push({
      id: ammo.id,
      name: ammo.name,
      qty,
      attackBonus: Number.isFinite(atkBonus) ? atkBonus : 0,
      damageBonus: dmgBonusRaw,
      label
    });
  });

  const defaultId = choices.find((c) => c.qty > 0)?.id ?? choices[0]?.id ?? "";
  return { required, choices, defaultId };
}

const ssUseConfirmHintState = globalThis.__SS_USE_CONFIRM_HINT_STATE__
  ?? (globalThis.__SS_USE_CONFIRM_HINT_STATE__ = new Map());

const SS_HINT_ICON_ROOT = "systems/dnd5e/icons/svg";
const SS_HINT_ICONS = {
  attack: `${SS_HINT_ICON_ROOT}/activity/attack.svg`,
  save: `${SS_HINT_ICON_ROOT}/activity/save.svg`,
  damage: `${SS_HINT_ICON_ROOT}/activity/damage.svg`,
  heal: `${SS_HINT_ICON_ROOT}/activity/heal.svg`,
  formula: `${SS_HINT_ICON_ROOT}/dice/d20.svg`,
  resource: `${SS_HINT_ICON_ROOT}/activity/utility.svg`,
  ammo: `${SS_HINT_ICON_ROOT}/damage/piercing.svg`,
  misc: `${SS_HINT_ICON_ROOT}/activity/utility.svg`,
  component: `${SS_HINT_ICON_ROOT}/activity/cast.svg`
};

function getDamageTypeIconPath(text) {
  const value = String(text ?? "").toLowerCase();
  const typeToIcon = {
    acid: "acid",
    bludgeoning: "bludgeoning",
    cold: "cold",
    fire: "fire",
    force: "force",
    lightning: "lightning",
    necrotic: "necrotic",
    piercing: "piercing",
    poison: "poison",
    psychic: "psychic",
    radiant: "radiant",
    slashing: "slashing",
    thunder: "thunder",
    healing: "healing"
  };
  for (const [type, icon] of Object.entries(typeToIcon)) {
    if (value.includes(type)) return `${SS_HINT_ICON_ROOT}/damage/${icon}.svg`;
  }
  return SS_HINT_ICONS.damage;
}

function normalizeHintCard(hint) {
  const raw = String(hint ?? "").trim();
  const match = raw.match(/^([^:]+):\s*(.+)$/);
  const label = (match?.[1] ?? "Roll").trim();
  const value = (match?.[2] ?? raw).trim();
  const key = label.toLowerCase();
  if (key.includes("attack")) return { type: "attack", label: "Attack", value, icon: SS_HINT_ICONS.attack };
  if (key.includes("save")) return { type: "save", label: label.replace(/\s+/g, " "), value, icon: SS_HINT_ICONS.save };
  if (key.includes("damage")) return { type: "damage", label: "Damage", value, icon: getDamageTypeIconPath(value) };
  if (key.includes("healing") || key.includes("heal")) return { type: "healing", label: "Healing", value, icon: getDamageTypeIconPath(`healing ${value}`) };
  if (key.includes("formula")) return { type: "formula", label: "Formula", value, icon: SS_HINT_ICONS.formula };
  if (key.includes("ammo")) return { type: "ammo", label: "Ammo", value, icon: SS_HINT_ICONS.ammo };
  if (key.includes("consumes") || key.includes("uses")) return { type: "resource", label, value, icon: SS_HINT_ICONS.resource };
  return { type: "misc", label, value, icon: SS_HINT_ICONS.misc };
}

function buildRollHintsHtml(rolls = []) {
  if (!Array.isArray(rolls) || !rolls.length) return "";
  const cards = rolls.map((hint) => {
    const card = normalizeHintCard(hint);
    return `
      <article class="ss-hint-card ss-hint-${escapeHtml(card.type)}">
        <span class="ss-hint-icon-wrap"><img class="ss-hint-icon" src="${escapeHtml(card.icon)}" alt=""></span>
        <div class="ss-hint-text">
          <span class="ss-hint-label">${escapeHtml(card.label)}</span>
          <span class="ss-hint-value">${escapeHtml(card.value)}</span>
        </div>
      </article>
    `;
  }).join("");

  return `
    <p class="ss-hint-section-title"><strong>Suggested roll:</strong></p>
    <div class="ss-hint-grid">${cards}</div>
  `;
}

function buildComponentHintsHtml(components = []) {
  if (!Array.isArray(components) || !components.length) return "";
  const cards = components.map((text) => `
    <article class="ss-hint-card ss-component-card ss-hint-component">
      <span class="ss-hint-icon-wrap"><img class="ss-hint-icon" src="${escapeHtml(SS_HINT_ICONS.component)}" alt=""></span>
      <div class="ss-hint-text">
        <span class="ss-hint-label">Components</span>
        <span class="ss-hint-value">${escapeHtml(text)}</span>
      </div>
    </article>
  `).join("");

  return `
    <p class="ss-hint-section-title"><strong>Components:</strong></p>
    <div class="ss-hint-grid ss-component-grid">${cards}</div>
  `;
}

function buildConsumesHintsHtml(consumes = []) {
  if (!Array.isArray(consumes) || !consumes.length) return "";
  const cards = consumes.map((text) => {
    const value = String(text ?? "").replace(/^consumes:\s*/i, "").trim();
    return `
      <article class="ss-hint-card ss-hint-resource">
        <span class="ss-hint-icon-wrap"><img class="ss-hint-icon" src="${escapeHtml(SS_HINT_ICONS.resource)}" alt=""></span>
        <div class="ss-hint-text">
          <span class="ss-hint-label">Consumes</span>
          <span class="ss-hint-value">${escapeHtml(value)}</span>
        </div>
      </article>
    `;
  }).join("");

  return `
    <p class="ss-hint-section-title"><strong>Consumes:</strong></p>
    <div class="ss-hint-grid ss-consumes-grid">${cards}</div>
  `;
}

function renderUseConfirmHintsIntoScope(scope, hintSet) {
  if (!(scope instanceof HTMLElement)) return;
  const rolls = Array.isArray(hintSet?.rolls) ? hintSet.rolls : [];
  const components = Array.isArray(hintSet?.components) ? hintSet.components : [];
  const consumes = Array.isArray(hintSet?.consumes) ? hintSet.consumes : [];

  const rollWrap = scope.querySelector(".ss-roll-hints-wrap");
  if (rollWrap) {
    rollWrap.innerHTML = buildRollHintsHtml(rolls);
  }

  const componentWrap = scope.querySelector(".ss-components-wrap");
  if (componentWrap) {
    componentWrap.innerHTML = buildComponentHintsHtml(components);
  }

  const consumesWrap = scope.querySelector(".ss-consumes-wrap");
  if (consumesWrap) {
    consumesWrap.innerHTML = buildConsumesHintsHtml(consumes);
  }
}

function getUseConfirmSelectedLevel(scope, state) {
  const picker = scope.querySelector("#ss-cast-level");
  const raw = Number.parseInt(picker?.value ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const fallback = Number.parseInt(state?.defaultLevel ?? "", 10);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function getUseConfirmSelectedAmmoId(scope, state) {
  const picker = scope.querySelector("#ss-ammo-type");
  const raw = String(picker?.value ?? "").trim();
  if (raw) return raw;
  return String(state?.defaultAmmoId ?? "").trim();
}

function resolveUseConfirmHintSet(state, level, ammoId) {
  if (!state?.splitHints) return { rolls: [], components: [], consumes: [] };
  const key = `${level ?? ""}|${ammoId ?? ""}`;
  state.cache = state.cache ?? {};
  if (!state.cache[key]) state.cache[key] = state.splitHints(level, ammoId);
  return state.cache[key];
}

function findUseConfirmYesButton(scope) {
  const dialog = scope.closest("dialog.application, .app.dialog, .dialog");
  if (!(dialog instanceof HTMLElement)) return null;
  return dialog.querySelector(
    ".dialog-buttons button[data-action='yes'], .dialog-buttons button[data-button='yes'], .dialog-buttons button:first-child"
  );
}

function evaluateUseConfirmTurnLockReason(state) {
  if (!state?.enforceCombatTurnLock) return "";
  const turnAccess = getCombatTurnAccessForUser(state.userId ?? game.user?.id ?? null, {
    combat: getActiveCombatForViewedScene()
  });
  if (!turnAccess.locked) return "";

  const currentName = String(turnAccess.currentCombatantName ?? "").trim() || "another combatant";
  return `It is currently ${currentName}'s turn. You can review this item, but you can only use it on your turn.`;
}

function evaluateUseConfirmInvalidReason(scope, state) {
  const turnLockReason = evaluateUseConfirmTurnLockReason(state);
  if (turnLockReason) return turnLockReason;

  if (state?.requireSlot) {
    const level = getUseConfirmSelectedLevel(scope, state);
    const levelKey = String(level ?? "");
    const slot = state.slotByLevel?.[levelKey] ?? null;
    const value = Number(slot?.value ?? 0);
    if (!slot || !Number.isFinite(value) || value <= 0) {
      return "No spell slots left for that cast level.";
    }
  }

  if (state?.requireItemUses) {
    const usesValue = Number(state.itemUsesValue ?? 0);
    if (!Number.isFinite(usesValue) || usesValue <= 0) {
      return "No uses left for this item.";
    }
  }

  if (state?.requireAmmo) {
    const ammoId = getUseConfirmSelectedAmmoId(scope, state);
    const ammo = state.ammoById?.[ammoId] ?? null;
    const qty = Number(ammo?.qty ?? 0);
    if (!ammo) return "No compatible ammo available.";
    if (!Number.isFinite(qty) || qty <= 0) return `No ${ammo.name} left.`;
  }

  return "";
}

function syncUseConfirmDialogState(scope, state) {
  const level = getUseConfirmSelectedLevel(scope, state);
  const ammoId = getUseConfirmSelectedAmmoId(scope, state);
  const hintSet = resolveUseConfirmHintSet(state, level, ammoId);
  renderUseConfirmHintsIntoScope(scope, hintSet);

  const invalidReason = evaluateUseConfirmInvalidReason(scope, state);
  const turnLockReason = evaluateUseConfirmTurnLockReason(state);
  const warning = scope.querySelector(".ss-use-confirm-warning");
  if (warning instanceof HTMLElement) {
    warning.textContent = invalidReason;
    warning.style.display = invalidReason ? "block" : "none";
    warning.classList.toggle("ss-turn-locked", !!turnLockReason);
  }

  const yesButton = findUseConfirmYesButton(scope);
  if (yesButton instanceof HTMLButtonElement) {
    yesButton.disabled = !!invalidReason;
    yesButton.classList.toggle("disabled", !!invalidReason);
    yesButton.classList.toggle("ss-turn-locked", !!turnLockReason);
    if (turnLockReason) yesButton.title = "Wait for your turn";
    else yesButton.removeAttribute("title");
  }

  return { level, ammoId, invalidReason };
}

if (!globalThis.__SS_USE_CONFIRM_LEVEL_CHANGE_BOUND__) {
  globalThis.__SS_USE_CONFIRM_LEVEL_CHANGE_BOUND__ = true;
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.id !== "ss-cast-level" && target.id !== "ss-ammo-type") return;

    const scope = target.closest(".ss-use-confirm[data-ss-hints-key]");
    if (!(scope instanceof HTMLElement)) return;
    const key = scope.dataset?.ssHintsKey;
    if (!key) return;

    const state = ssUseConfirmHintState.get(key);
    if (!state) return;
    syncUseConfirmDialogState(scope, state);
  }, true);
}

if (!globalThis.__SS_USE_CONFIRM_INFO_CLICK_BOUND__) {
  globalThis.__SS_USE_CONFIRM_INFO_CLICK_BOUND__ = true;
  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const infoBtn = target.closest(".ss-use-confirm-info");
    if (!(infoBtn instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const section = infoBtn.closest(".ss-use-confirm");
    const title = section?.querySelector(".ss-use-confirm-title strong")?.textContent?.trim() || "Item Details";
    const uuid = String(infoBtn.dataset?.uuid ?? "").trim();
    let sourceBtn = infoBtn;
    if (uuid) {
      const linked = Array.from(document.querySelectorAll(".ss-tooltip-btn[data-uuid]"))
        .find((el) => String(el.getAttribute("data-uuid") ?? "").trim() === uuid);
      if (linked instanceof HTMLElement) sourceBtn = linked;
    }
    await openLockedItemTooltipDialogFromButton(sourceBtn, title, infoBtn);
  }, true);
}

async function confirmTapToCast(itemOrName, actor = null) {
  const item = (typeof itemOrName === "object" && itemOrName) ? itemOrName : null;
  const itemName = item?.name ?? String(itemOrName ?? "item");
  const requiresSpellSlots = !!item && item.type === "spell" && Number(item.system?.level ?? 0) > 0;
  const castChoices = item ? getSpellSlotLevelChoices(actor, item) : [];
  const defaultChoice = castChoices.find((c) => Number(c.value ?? 0) > 0) ?? castChoices[0] ?? null;
  const defaultLevel = Number(defaultChoice?.level ?? item?.system?.level ?? 0) || null;
  const showLevelPicker = requiresSpellSlots && castChoices.length > 0;
  const ammoConfig = item ? getAmmoChoices(actor, item) : { required: false, choices: [], defaultId: "" };
  const defaultAmmoId = String(ammoConfig.defaultId ?? "");
  const showAmmoPicker = ammoConfig.choices.length > 0 && (ammoConfig.required || ammoConfig.choices.length > 1);
  const itemUsesValue = Number(item?.system?.uses?.value ?? 0);
  const itemUsesMax = Number(item?.system?.uses?.max ?? 0);
  const requireItemUses = Number.isFinite(itemUsesMax) && itemUsesMax > 0;

  const splitHints = (level = null, ammoId = null) => {
    const hints = item ? collectItemRollHints(item, actor, level, ammoId) : [];
    const components = hints
      .filter((h) => /^components?:/i.test(h))
      .map((h) => h.replace(/^components?:\s*/i, "").trim())
      .filter(Boolean);
    const consumes = hints.filter((h) => /^consumes?:/i.test(h));
    const rolls = hints.filter((h) => !/^components?:/i.test(h) && !/^consumes?:/i.test(h));
    return { rolls, components, consumes };
  };
  const initial = splitHints(defaultLevel, defaultAmmoId);
  const dialogKey = `soh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (item) {
    const slotByLevel = {};
    castChoices.forEach((c) => { slotByLevel[String(c.level)] = c; });
    const ammoById = {};
    ammoConfig.choices.forEach((c) => { ammoById[c.id] = c; });
    ssUseConfirmHintState.set(dialogKey, {
      splitHints,
      cache: {},
      defaultLevel: String(defaultLevel ?? ""),
      defaultAmmoId,
      requireSlot: requiresSpellSlots,
      requireItemUses,
      itemUsesValue,
      itemUsesMax,
      requireAmmo: !!ammoConfig.required,
      slotByLevel,
      ammoById,
      enforceCombatTurnLock: !!actor,
      userId: game.user?.id ?? null
    });
    setTimeout(() => ssUseConfirmHintState.delete(dialogKey), 120000);
  }

  const title = "Use Item?";
  const imageHtml = item?.img
    ? `<img class="ss-use-confirm-image" src="${escapeHtml(item.img)}" alt="${escapeHtml(itemName)}">`
    : "";
  const infoButtonHtml = item?.uuid
    ? `<button type="button"
        class="ss-use-confirm-info item-tooltip"
        aria-label="Show Details"
        title="Show Details"
        data-uuid="${escapeHtml(item.uuid)}"
        data-action="ssTooltip"
        data-tooltip="<section class=&quot;loading&quot; data-uuid=&quot;${escapeHtml(item.uuid)}&quot;><i class=&quot;fas fa-spinner fa-spin-pulse&quot;></i></section>"
        data-tooltip-class="dnd5e2 dnd5e-tooltip item-tooltip themed theme-light"
        data-tooltip-direction="LEFT">
        <i class="fa-solid fa-circle-info" inert></i>
      </button>`
    : "";
  const levelHtml = showLevelPicker
    ? `
      <label class="ss-use-confirm-level">
        <span>Cast at level</span>
        <select id="ss-cast-level">
          ${castChoices.map((choice) => {
            const level = Number(choice.level);
            const value = Math.max(0, Number(choice.value ?? 0));
            const max = Math.max(0, Number(choice.max ?? 0));
            const label = `${spellLevelLabel(level)} (${value}/${max} slots)`;
            const disabled = value <= 0 ? " disabled" : "";
            const selected = level === defaultLevel ? " selected" : "";
            return `<option value="${level}"${selected}${disabled}>${escapeHtml(label)}</option>`;
          }).join("")}
        </select>
      </label>
    `
    : "";
  const ammoHtml = showAmmoPicker
    ? `
      <label class="ss-use-confirm-level">
        <span>Ammo type</span>
        <select id="ss-ammo-type">
          ${ammoConfig.choices.map((choice) => {
            const qty = Number(choice.qty ?? 0);
            const disabled = qty <= 0 ? " disabled" : "";
            const selected = choice.id === defaultAmmoId ? " selected" : "";
            return `<option value="${escapeHtml(choice.id)}"${selected}${disabled}>${escapeHtml(choice.label)}</option>`;
          }).join("")}
        </select>
      </label>
    `
    : (ammoConfig.required && ammoConfig.choices.length
      ? `<p class="ss-use-confirm-inline">Ammo: <strong>${escapeHtml(ammoConfig.choices[0].label)}</strong></p>`
      : "");
  const hintsHtml = buildRollHintsHtml(initial.rolls);
  const componentsHtml = buildComponentHintsHtml(initial.components);
  const consumesHtml = buildConsumesHintsHtml(initial.consumes);
  const content = `
    <section class="ss-use-confirm" data-ss-hints-key="${escapeHtml(dialogKey)}">
      <header class="ss-use-confirm-header">
        ${imageHtml}
        <div class="ss-use-confirm-title-row">
          <p class="ss-use-confirm-title">Use <strong>${escapeHtml(itemName)}</strong> now?</p>
          ${infoButtonHtml}
        </div>
      </header>
      ${levelHtml}
      ${ammoHtml}
      <p class="ss-use-confirm-warning" style="display:none"></p>
      <div class="ss-use-confirm-body">
        <div class="ss-roll-hints-wrap">${hintsHtml}</div>
        <div class="ss-consumes-wrap">${consumesHtml}</div>
        <div class="ss-components-wrap">${componentsHtml}</div>
      </div>
    </section>
  `;

  if (globalThis.Dialog?.confirm) {
    const resultPromise = Dialog.confirm({
      title,
      content,
      yes: (html) => {
        const root = html?.[0] ?? html;
        const scope = root?.querySelector?.(".ss-use-confirm");
        const state = ssUseConfirmHintState.get(dialogKey);
        const syncState = (scope instanceof HTMLElement && state)
          ? syncUseConfirmDialogState(scope, state)
          : { level: defaultLevel, ammoId: defaultAmmoId, invalidReason: "" };

        if (syncState.invalidReason) {
          ui.notifications.warn(syncState.invalidReason);
          return { confirmed: false, slotLevel: null, ammoItemId: null };
        }

        const pickedLevel = Number.parseInt(String(syncState.level ?? ""), 10);
        const slotLevel = Number.isFinite(pickedLevel) && pickedLevel > 0 ? pickedLevel : null;
        const ammoItemId = String(syncState.ammoId ?? "").trim() || null;
        return { confirmed: true, slotLevel, ammoItemId };
      },
      no: () => {
        return { confirmed: false, slotLevel: null, ammoItemId: null };
      },
      defaultYes: false
    }, {
      width: 560,
      classes: ["ss-use-confirm-dialog"]
    });
    setTimeout(() => {
      const scope = document.querySelector(`.ss-use-confirm[data-ss-hints-key='${dialogKey}']`);
      const state = ssUseConfirmHintState.get(dialogKey);
      const dialogRoot = scope?.closest?.(".app.window-app.dialog, dialog.application");
      if (dialogRoot instanceof HTMLElement) dialogRoot.classList.add("ss-use-confirm-dialog");
      if (scope instanceof HTMLElement && state) {
        syncUseConfirmDialogState(scope, state);
      }
    }, 40);
    const result = await resultPromise;
    ssUseConfirmHintState.delete(dialogKey);
    if (result && typeof result === "object" && "confirmed" in result) return result;
    return { confirmed: !!result, slotLevel: null, ammoItemId: null };
  }

  // Fallback if a confirm dialog helper is unavailable.
  if (requiresSpellSlots && (!castChoices.length || !castChoices.some((c) => Number(c.value ?? 0) > 0))) {
    ui.notifications.warn("No spell slots left.");
    return { confirmed: false, slotLevel: null, ammoItemId: null };
  }
  if (requireItemUses && (!Number.isFinite(itemUsesValue) || itemUsesValue <= 0)) {
    ui.notifications.warn("No uses left for this item.");
    return { confirmed: false, slotLevel: null, ammoItemId: null };
  }
  if (ammoConfig.required && (!ammoConfig.choices.length || !ammoConfig.choices.some((c) => Number(c.qty ?? 0) > 0))) {
    ui.notifications.warn("No compatible ammo available.");
    return { confirmed: false, slotLevel: null, ammoItemId: null };
  }
  const hintText = initial.rolls.length ? `\nSuggested roll: ${initial.rolls[0]}` : "";
  return {
    confirmed: !!globalThis.confirm?.(`Use ${itemName} now?${hintText}`),
    slotLevel: defaultLevel,
    ammoItemId: defaultAmmoId || null
  };
}
globalThis.ssCollectItemRollHints = collectItemRollHints;
globalThis.ssGetSpellSlotLevelChoices = getSpellSlotLevelChoices;

const CUSTOM_JS_DEBUG = false;
const debugLog = (...args) => {
  if (!CUSTOM_JS_DEBUG) return;
  console.log(...args);
};

const ssPendingMidiCastLevels = globalThis.__SS_PENDING_MIDI_CAST_LEVELS__
  ?? (globalThis.__SS_PENDING_MIDI_CAST_LEVELS__ = []);

function queuePendingMidiCastLevel(itemName, slotLevel) {
  const level = Number.parseInt(slotLevel, 10);
  const name = String(itemName ?? "").trim().toLowerCase();
  if (!name || !Number.isFinite(level) || level <= 0) return;
  ssPendingMidiCastLevels.push({ name, level, ts: Date.now() });
  if (ssPendingMidiCastLevels.length > 20) ssPendingMidiCastLevels.splice(0, ssPendingMidiCastLevels.length - 20);
}

function applyPendingMidiCastLevel(dialogApp, html) {
  if (!game.user?.isGM) return;
  if (!ssPendingMidiCastLevels.length) return;

  const root = html?.[0] ?? html;
  if (!(root instanceof HTMLElement)) return;
  const title = String(dialogApp?.title ?? "").toLowerCase();
  const rootText = String(root.textContent ?? "").toLowerCase();
  if (!rootText.includes("cast at level")) return;

  const now = Date.now();
  for (let i = ssPendingMidiCastLevels.length - 1; i >= 0; i -= 1) {
    if ((now - ssPendingMidiCastLevels[i].ts) > 30000) ssPendingMidiCastLevels.splice(i, 1);
  }
  if (!ssPendingMidiCastLevels.length) return;

  let idx = ssPendingMidiCastLevels.findIndex((p) => title.includes(p.name) || rootText.includes(p.name));
  if (idx < 0) idx = ssPendingMidiCastLevels.length - 1;
  const pending = ssPendingMidiCastLevels[idx];
  if (!pending) return;

  const findCastLevelSelect = () => {
    const named = root.querySelector(
      "select[name='castLevel'], select[name='spellLevel'], select[name='slotLevel'], select[data-action='castLevel']"
    );
    if (named instanceof HTMLSelectElement) return named;

    const labels = Array.from(root.querySelectorAll("label, legend, h4, div, span"));
    for (const label of labels) {
      const txt = String(label.textContent ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!txt.includes("cast at level")) continue;
      const container = label.closest(".form-group, .field-group, .form-fields, .midi-qol-box, section, div") ?? label.parentElement;
      const nearby = container?.querySelector?.("select");
      if (nearby instanceof HTMLSelectElement) return nearby;
    }

    const candidates = Array.from(root.querySelectorAll("select")).filter((el) => el instanceof HTMLSelectElement);
    for (const candidate of candidates) {
      const optionText = Array.from(candidate.options).map((o) => String(o.textContent ?? "").toLowerCase()).join(" ");
      if (optionText.includes("level")) return candidate;
    }
    return null;
  };

  const tryApplyLevel = () => {
    const select = findCastLevelSelect();
    if (!(select instanceof HTMLSelectElement)) return false;

    const wantedValue = String(pending.level);
    let targetOption = Array.from(select.options).find((opt) => String(opt.value) === wantedValue) ?? null;
    if (!targetOption) {
      const ordinal = spellLevelLabel(pending.level).toLowerCase();
      targetOption = Array.from(select.options).find((opt) => {
        const txt = String(opt.textContent ?? "").toLowerCase();
        return txt.startsWith(`${ordinal} `) || txt.startsWith(`${ordinal}level`) || txt.includes(`${ordinal} level`);
      }) ?? null;
    }
    if (!targetOption) return false;

    select.value = String(targetOption.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };

  const delays = [0, 45, 120, 260, 520];
  let applied = false;
  delays.forEach((delay) => {
    setTimeout(() => {
      if (applied) return;
      applied = tryApplyLevel();
      if (!applied) return;
      ssPendingMidiCastLevels.splice(idx, 1);
    }, delay);
  });
}

// ------------------ PLAYER SLIM BOOTSTRAP POLICY (player-only) ------------------
// Edit this allow-list to keep specific modules "active" for player-slim clients.
// Note: Foundry cannot truly unload module JS per-user after bootstrap. This policy
// applies best-effort runtime suppression for non-allowed modules.
const PLAYER_SLIM_ALLOWED_MODULES = new Set([
  "sheet-sidekick",
  "sheet-sidekick",
  "custom-js"
]);

const PLAYER_SLIM_KEYS = {
  role: "custom-js:player-slim-role", // "player" | "gm"
  enabled: "custom-js:player-slim-enabled", // "1" | "0"
  primed: "custom-js:player-slim-primed", // "1" after first player visit
  allowModules: "custom-js:player-slim-allow-modules",
  bypass: "custom-js:player-slim-bypass" // "1" when this browser/user should skip slim policy
};

function shouldEarlyApplyPlayerSlimFromStorage() {
  try {
    if (localStorage.getItem(PLAYER_SLIM_KEYS.bypass) === "1") return false;
    return (localStorage.getItem(PLAYER_SLIM_KEYS.role) === "player")
      && (localStorage.getItem(PLAYER_SLIM_KEYS.enabled) === "1")
      && (localStorage.getItem(PLAYER_SLIM_KEYS.primed) === "1");
  } catch (_err) {
    return false;
  }
}

function isMonksCommonDisplayClient() {
  if (!game.user || game.user.isGM) return false;
  const monksDisplay = game.modules.get("monks-common-display");
  if (!monksDisplay?.active) return false;

  try {
    // Client-scoped setting set by Monks Common Display for the display account.
    if (game.settings.get("monks-common-display", "startupdata") === true) return true;
  } catch (_err) {
    // Fall through.
  }

  try {
    const playerData = game.settings.get("monks-common-display", "playerdata") ?? {};
    return !!playerData?.[game.user.id]?.display;
  } catch (_err) {
    return false;
  }
}

function syncMonitorClientClasses() {
  if (game.user?.isGM) return;
  if (!isSheetSidekickModuleActive()) return;
  if (!document.body) return;

  const isDisplayMonitor = isMonksCommonDisplayClient();
  document.body.classList.toggle("ss-monitor-client", isDisplayMonitor);
  document.body.classList.toggle("ss-sheet-sidekick-player", !isDisplayMonitor);
  document.body.classList.toggle("ss-monitor-client", isDisplayMonitor);
  document.body.classList.toggle("ss-sidekick-player", !isDisplayMonitor);
}

function ensureMonitorMeasurementVisible() {
  if (game.user?.isGM) return;
  const bodyClasses = document.body?.classList;
  if (!bodyClasses?.contains("ss-monitor-client") && !bodyClasses?.contains("ss-monitor-client")) return;
  if (!document.body?.classList?.contains("hide-ui")) return;

  const measurement = document.getElementById("measurement");
  if (!measurement) return;

  measurement.style.setProperty("display", "block", "important");
  measurement.style.setProperty("visibility", "visible", "important");
  measurement.style.setProperty("opacity", "1", "important");
  measurement.style.setProperty("pointer-events", "none", "important");
}

// Accounts in this list are always treated as no-audio clients.
// Keep values lowercase (match is case-insensitive).
const SS_AUDIO_FORCE_BLOCK_USERNAMES = new Set([
  "monitor"
]);

function shouldBlockClientAudio() {
  const user = game.user;
  if (!user) return false;

  const name = String(user.name ?? "").trim().toLowerCase();
  if (SS_AUDIO_FORCE_BLOCK_USERNAMES.has(name)) return true;

  // Monks Common Display client should stay silent.
  if (isMonksCommonDisplayClient()) return true;

  return !user.isGM;
}

function isResolutionWarningMessage(message) {
  const text = String(message ?? "").toLowerCase();
  return text.startsWith("error.resolution.")
    || text === "error.resolution.window"
    || text === "error.resolution.scale"
    || text.includes("requires a usable window dimensions")
    || text.includes("requires usable window dimensions");
}

function installEarlyPlayerSlimNotificationFilter() {
  if (!shouldEarlyApplyPlayerSlimFromStorage()) return;
  const Notifications = globalThis.foundry?.applications?.ui?.Notifications;
  if (!Notifications?.prototype) return;
  if (Notifications.prototype.__ssPlayerSlimPatched === true) return;

  const originalNotify = Notifications.prototype.notify;
  Notifications.prototype.notify = function (message, type = "info", options = {}) {
    if (isResolutionWarningMessage(message)) {
      return {
        id: -1,
        type,
        message: String(message ?? ""),
        active: false,
        remove: () => {},
        update: () => {}
      };
    }
    return originalNotify.call(this, message, type, options);
  };
  Notifications.prototype.__ssPlayerSlimPatched = true;
}

function parseModuleIdFromSocketEventName(eventName) {
  const name = String(eventName ?? "").replace(/^\$/, "");
  const match = name.match(/^module\.([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

function parsePlayerSlimAllowList(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((x) => String(x ?? "").trim())
        .filter(Boolean);
    }
  } catch (_err) {
    // Fall through to CSV-style parsing.
  }

  return String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getPlayerSlimAllowedModuleSet() {
  const allowed = new Set(PLAYER_SLIM_ALLOWED_MODULES);

  try {
    const raw = localStorage.getItem(PLAYER_SLIM_KEYS.allowModules);
    const extra = parsePlayerSlimAllowList(raw);
    extra.forEach((id) => allowed.add(id));
  } catch (_err) {
    // Ignore storage failures.
  }

  // Never allow users to disable this module's own channel handling.
  allowed.add("custom-js");
  return allowed;
}

function isModuleAllowedForPlayerSlim(moduleId) {
  return getPlayerSlimAllowedModuleSet().has(String(moduleId ?? ""));
}

function applyPlayerSlimSocketPolicy() {
  const socket = game.socket;
  if (!socket) return;

  // Remove already-registered module socket callbacks for disallowed modules.
  const callbackStores = [socket?._callbacks, socket?.io?._callbacks].filter(Boolean);
  for (const store of callbackStores) {
    for (const key of Object.keys(store)) {
      const moduleId = parseModuleIdFromSocketEventName(key);
      if (!moduleId || isModuleAllowedForPlayerSlim(moduleId)) continue;
      delete store[key];
    }
  }

  // Block future socket listener registrations from disallowed module channels.
  if (socket.__ssPlayerSlimOnPatched !== true && typeof socket.on === "function") {
    const originalOn = socket.on.bind(socket);
    socket.on = function (eventName, fn) {
      const moduleId = parseModuleIdFromSocketEventName(eventName);
      if (moduleId && !isModuleAllowedForPlayerSlim(moduleId)) return this;
      return originalOn(eventName, fn);
    };
    socket.__ssPlayerSlimOnPatched = true;
  }
}

function cleanupExistingResolutionWarnings() {
  const notificationsRoot = document.getElementById("notifications");
  if (notificationsRoot) {
    notificationsRoot.querySelectorAll("li.notification").forEach((node) => {
      if (!isResolutionWarningMessage(node.textContent)) return;
      node.remove();
    });
  }
}

function installResolutionWarningDomGuard(durationMs = 20000) {
  if (!shouldEarlyApplyPlayerSlimFromStorage()) return;
  if (globalThis.__SS_RESOLUTION_DOM_GUARD__) return;

  const removeNow = () => cleanupExistingResolutionWarnings();
  removeNow();

  const obs = new MutationObserver(() => removeNow());
  const target = document.body ?? document.documentElement;
  if (!target) return;
  obs.observe(target, { childList: true, subtree: true });
  globalThis.__SS_RESOLUTION_DOM_GUARD__ = obs;

  window.setTimeout(() => {
    try { obs.disconnect(); } catch (_err) { /* noop */ }
    if (globalThis.__SS_RESOLUTION_DOM_GUARD__ === obs) {
      delete globalThis.__SS_RESOLUTION_DOM_GUARD__;
    }
  }, Math.max(2500, durationMs));
}

function applyPlayerSlimPolicyForUser() {
  if (!game.user || game.user.isGM) return;

  const bypass = isMonksCommonDisplayClient();
  let firstPlayerVisit = false;
  try {
    localStorage.setItem(PLAYER_SLIM_KEYS.role, "player");
    localStorage.setItem(PLAYER_SLIM_KEYS.bypass, bypass ? "1" : "0");
    if (localStorage.getItem(PLAYER_SLIM_KEYS.enabled) === null) {
      localStorage.setItem(PLAYER_SLIM_KEYS.enabled, "1");
    }
    if (localStorage.getItem(PLAYER_SLIM_KEYS.primed) !== "1") {
      localStorage.setItem(PLAYER_SLIM_KEYS.primed, "1");
      firstPlayerVisit = true;
    }
  } catch (_err) {
    // Ignore storage failures.
  }

  const enabled = (() => {
    try {
      return localStorage.getItem(PLAYER_SLIM_KEYS.enabled) === "1";
    } catch (_err) {
      return false;
    }
  })();

  if (!enabled) return;
  if (bypass) {
    debugLog("[custom-js] Player-slim bypass active for Monks Common Display client.");
    return;
  }
  if (firstPlayerVisit) {
    ui.notifications?.info?.("Player slim mode primed for this browser. It will be stronger after next reload.");
    return;
  }

  installEarlyPlayerSlimNotificationFilter();
  cleanupExistingResolutionWarnings();
  applyPlayerSlimSocketPolicy();

  const disallowedActiveModules = Array.from(game.modules.values())
    .filter((m) => m?.active && !isModuleAllowedForPlayerSlim(m.id))
    .map((m) => m.id);
  if (disallowedActiveModules.length) {
    debugLog("[custom-js] Player-slim soft policy applied. Disallowed active modules (cannot hard-unload per-user):",
      disallowedActiveModules);
  }
}

installEarlyPlayerSlimNotificationFilter();
installResolutionWarningDomGuard(20000);

globalThis.ssGetPlayerSlimConfig = () => {
  try {
    return {
      role: localStorage.getItem(PLAYER_SLIM_KEYS.role),
      enabled: localStorage.getItem(PLAYER_SLIM_KEYS.enabled),
      primed: localStorage.getItem(PLAYER_SLIM_KEYS.primed),
      bypass: localStorage.getItem(PLAYER_SLIM_KEYS.bypass),
      allowModulesRaw: localStorage.getItem(PLAYER_SLIM_KEYS.allowModules),
      allowModulesResolved: Array.from(getPlayerSlimAllowedModuleSet()).sort()
    };
  } catch (_err) {
    return {
      role: null,
      enabled: null,
      primed: null,
      bypass: null,
      allowModulesRaw: null,
      allowModulesResolved: Array.from(PLAYER_SLIM_ALLOWED_MODULES).sort()
    };
  }
};

globalThis.ssSetPlayerSlimEnabled = (enabled) => {
  try {
    localStorage.setItem(PLAYER_SLIM_KEYS.enabled, enabled ? "1" : "0");
    return true;
  } catch (_err) {
    return false;
  }
};

globalThis.ssSetPlayerSlimBypass = (bypass) => {
  try {
    localStorage.setItem(PLAYER_SLIM_KEYS.bypass, bypass ? "1" : "0");
    return true;
  } catch (_err) {
    return false;
  }
};

globalThis.ssSetPlayerSlimAllowModules = (value) => {
  const list = Array.isArray(value)
    ? value.map((x) => String(x ?? "").trim()).filter(Boolean)
    : parsePlayerSlimAllowList(String(value ?? ""));

  try {
    if (!list.length) {
      localStorage.removeItem(PLAYER_SLIM_KEYS.allowModules);
    } else {
      localStorage.setItem(PLAYER_SLIM_KEYS.allowModules, JSON.stringify(list));
    }
    return Array.from(getPlayerSlimAllowedModuleSet()).sort();
  } catch (_err) {
    return null;
  }
};

globalThis.ssClearPlayerSlimAllowModules = () => {
  try {
    localStorage.removeItem(PLAYER_SLIM_KEYS.allowModules);
    return Array.from(getPlayerSlimAllowedModuleSet()).sort();
  } catch (_err) {
    return null;
  }
};

const ssDpadState = globalThis.__SS_DPAD_STATE__ ?? (globalThis.__SS_DPAD_STATE__ = {
  override: null,
  setAt: 0
});

function setDpadEnabledOverride(value) {
  if (typeof value !== "boolean") return;
  ssDpadState.override = value;
  ssDpadState.setAt = Date.now();
}

function isDpadEnabledByGm() {
  const gms = game.users?.filter?.((u) => u.isGM) ?? [];
  if (!gms.length) {
    if (typeof ssDpadState.override === "boolean") return ssDpadState.override;
    return true;
  }

  const primary = gms.find((u) => u.active) ?? gms[0];
  const value = primary?.getFlag?.("world", "dpadEnabled");
  if (typeof value === "boolean") {
    setDpadEnabledOverride(value);
    return value;
  }
  if (typeof ssDpadState.override === "boolean") return ssDpadState.override;
  return true;
}

function emitPlayerControlsStateFromGm() {
  if (!game.user?.isGM) return;
  const enabled = game.user.getFlag("world", "dpadEnabled") ?? true;
  game.socket?.emit?.("module.custom-js", {
    type: "ssControls",
    enabled: !!enabled,
    at: Date.now(),
    gmUserId: game.user.id
  });
}

function ensurePlayerPauseBanner() {
  if (game.user?.isGM) return null;
  let el = document.getElementById("ss-player-pause-banner");
  if (el) return el;

  el = document.createElement("div");
  el.id = "ss-player-pause-banner";
  el.className = "ss-player-pause-banner";
  el.hidden = true;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <div class="ss-player-pause-banner__inner">
      <div class="ss-player-pause-banner__title">GAME PAUSED</div>
      <div class="ss-player-pause-banner__sub">Waiting for the GM to resume</div>
    </div>
  `;
  (document.body ?? document.documentElement)?.appendChild(el);
  return el;
}

function syncPlayerPauseBanner(paused = null) {
  if (game.user?.isGM) return;
  const el = ensurePlayerPauseBanner();
  if (!(el instanceof HTMLElement)) return;
  const isPaused = (typeof paused === "boolean") ? paused : !!game.paused;
  el.hidden = !isPaused;
  document.body?.classList?.toggle("ss-player-game-paused", isPaused);
}

function getActiveCombatForViewedScene() {
  const combat = game.combat;
  if (!combat) return null;
  if (!(combat.combatants?.size > 0)) return null;

  const viewedSceneId = game.scenes?.viewed?.id ?? null;
  const combatSceneId = combat.scene?.id ?? combat.sceneId ?? null;
  if (viewedSceneId && combatSceneId && viewedSceneId !== combatSceneId) return null;

  return combat;
}

function getCombatTurnAccessForUser(userId, { combat = null } = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) {
    return {
      inCombat: false,
      locked: false,
      isUsersTurn: true,
      currentCombatantName: "",
      message: ""
    };
  }

  const activeCombat = combat ?? getActiveCombatForViewedScene();
  if (!activeCombat || !(activeCombat.combatants?.size > 0)) {
    return {
      inCombat: false,
      locked: false,
      isUsersTurn: true,
      currentCombatantName: "",
      message: ""
    };
  }

  const currentCombatant = activeCombat.combatant
    ?? (Array.isArray(activeCombat.turns) ? activeCombat.turns[Number(activeCombat.turn ?? -1)] : null)
    ?? null;
  if (!currentCombatant) {
    return {
      inCombat: true,
      locked: false,
      isUsersTurn: true,
      currentCombatantName: "",
      message: ""
    };
  }

  const actor = currentCombatant.actor ?? currentCombatant.token?.actor ?? null;
  if (!actor) {
    return {
      inCombat: true,
      locked: false,
      isUsersTurn: true,
      currentCombatantName: String(currentCombatant.name ?? currentCombatant.token?.name ?? ""),
      message: ""
    };
  }

  const ownerLevelRequired = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const ownershipLevel = Number(actor.ownership?.[uid] ?? 0);
  const isUsersTurn = ownershipLevel >= ownerLevelRequired;
  const currentCombatantName = String(currentCombatant.name ?? currentCombatant.token?.name ?? actor.name ?? "another combatant");
  const locked = !isUsersTurn;

  return {
    inCombat: true,
    locked,
    isUsersTurn,
    currentCombatantName,
    message: locked
      ? `It is currently ${currentCombatantName}'s turn. You can move and target only on your turn.`
      : ""
  };
}

const SS_TAP_USE_TYPES = new Set([
  "spell",
  "feat",
  "weapon",
  "equipment",
  "consumable",
  "tool",
  "loot",
  "backpack"
]);

function isTapToUseItem(item) {
  return !!item && SS_TAP_USE_TYPES.has(item.type);
}

function normalizeChatCommandText(content) {
  const raw = String(content ?? "");
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getActiveGmIds() {
  return game.users.filter((u) => u.isGM && u.active).map((u) => u.id);
}

function sendCommandToGmSocket(type, payload = {}) {
  if (!type || typeof type !== "string") return false;
  if (!game.socket?.emit) return false;
  if (!getActiveGmIds().length) return false;

  try {
    game.socket.emit("module.custom-js", {
      type,
      ...payload,
      userId: payload.userId ?? game.user?.id ?? null
    });
    return true;
  } catch (_err) {
    return false;
  }
}

function sendCommandToGmWhisper(content, options = {}) {
  const includeSelf = options.includeSelf === true;
  const gms = getActiveGmIds();
  if (!gms.length) {
    ui.notifications.warn("No active GM connected.");
    return false;
  }

  const recipients = new Set(gms);
  if (includeSelf && game.user?.id) recipients.add(game.user.id);

  ChatMessage.create({ content, whisper: Array.from(recipients) }).catch((err) => {
    console.error("GM whisper failed:", err);
    ui.notifications.error("Failed to send command to GM.");
  });
  return true;
}

function sendUseInfoToGmWhisper(actor, item, slotLevel = null, ammoItemId = null) {
  const gms = getActiveGmIds();
  if (!gms.length) return false;
  if (!actor || !item) return false;

  const actorName = String(actor.name ?? "Actor");
  const itemName = String(item.name ?? "Item");
  const itemRef = item.uuid
    ? `@UUID[${item.uuid}]{${itemName}}`
    : itemName;
  const chosenLevel = Number.parseInt(slotLevel, 10);
  const baseLevel = Number(item.system?.level ?? 0);
  const usedLevel = Number.isFinite(chosenLevel) && chosenLevel > 0
    ? chosenLevel
    : ((item.type === "spell" && Number.isFinite(baseLevel) && baseLevel > 0) ? baseLevel : null);
  const castLevelLine = usedLevel
    ? `<p><strong style="color: crimson;">CAST LEVEL: ${escapeHtml(spellLevelLabel(usedLevel)).toUpperCase()}</strong></p>`
    : "";
  const ammoId = String(ammoItemId ?? "").trim();
  const ammoItem = ammoId ? actor.items?.get?.(ammoId) : null;
  const ammoQty = Number(ammoItem?.system?.quantity ?? ammoItem?.system?.uses?.value ?? 0);
  const ammoLine = ammoItem
    ? `<p><strong style="color:#7b4a2a;">AMMO:</strong> ${escapeHtml(ammoItem.name)} (${Number.isFinite(ammoQty) ? Math.max(0, ammoQty) : "?"} left)</p>`
    : "";
  const content = `
    <section class="ss-use-gm-whisper">
      <p><strong>[Sheet Sidekick USE]</strong> ${escapeHtml(actorName)} requested ${itemRef}</p>
      ${castLevelLine}
      ${ammoLine}
    </section>
  `;

  ChatMessage.create({
    content,
    whisper: gms
  }).catch((err) => {
    console.error("Sheet Sidekick use info whisper failed:", err);
  });
  return true;
}

const SS_ABILITY_LABELS = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

function normalizeAbilityKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (SS_ABILITY_LABELS[raw]) return raw;
  const byName = Object.entries(SS_ABILITY_LABELS).find(([_k, label]) => label.toLowerCase() === raw);
  if (byName) return byName[0];
  return raw.slice(0, 3);
}

function inferAbilityKeyFromText(text) {
  const raw = String(text ?? "").toLowerCase();
  for (const [key, label] of Object.entries(SS_ABILITY_LABELS)) {
    if (raw.includes(label.toLowerCase())) return key;
  }
  return "";
}

function extractRollRequestFromElement(target, actor) {
  if (!(target instanceof HTMLElement)) return null;
  const rollable = target.closest("[data-action='roll'][data-type], .rollable[data-action='roll']");
  if (!(rollable instanceof HTMLElement)) return null;

  const rawType = String(rollable.dataset?.type ?? "").trim().toLowerCase();
  if (!rawType) return null;

  const textLabel = String(rollable.textContent ?? "").replace(/\s+/g, " ").trim();
  if (rawType === "initiative") {
    return { kind: "initiative", key: "initiative", label: textLabel || "Initiative" };
  }

  if (rawType === "skill") {
    const skillKey = String(
      rollable.dataset?.key
      ?? rollable.closest("[data-key]")?.dataset?.key
      ?? ""
    ).trim().toLowerCase();
    if (!skillKey) return null;
    return { kind: "skill", key: skillKey, label: textLabel || `Skill (${skillKey.toUpperCase()})` };
  }

  if (rawType === "tool") {
    const toolKey = String(
      rollable.dataset?.key
      ?? rollable.closest("[data-key]")?.dataset?.key
      ?? ""
    ).trim().toLowerCase();
    if (!toolKey) return null;
    return { kind: "tool", key: toolKey, label: textLabel || toolKey };
  }

  const looksLikeSave = rawType.includes("save")
    || rollable.classList.contains("saving-throw")
    || !!rollable.closest(".saving-throw");
  const looksLikeAbility = rawType === "ability" || rawType.includes("ability");
  const abilityRaw = String(
    rollable.dataset?.ability
    ?? rollable.closest("[data-ability]")?.dataset?.ability
    ?? ""
  ).trim();
  const abilityKey = normalizeAbilityKey(abilityRaw || inferAbilityKeyFromText(textLabel));
  if (!looksLikeAbility || !abilityKey || !SS_ABILITY_LABELS[abilityKey]) return null;

  const label = `${SS_ABILITY_LABELS[abilityKey]} ${looksLikeSave ? "Save" : "Check"}`;
  return {
    kind: looksLikeSave ? "abilitySave" : "abilityCheck",
    key: abilityKey,
    label
  };
}

async function confirmTapToRoll(actor, rollRequest) {
  if (!actor || !rollRequest) return { confirmed: false };
  const label = String(rollRequest.label ?? "Roll");
  const title = "Roll Check?";
  const content = `
    <section class="ss-use-confirm">
      <header class="ss-use-confirm-header">
        <span class="ss-hint-icon-wrap"><img class="ss-hint-icon" src="${escapeHtml(SS_HINT_ICONS.save)}" alt=""></span>
        <p class="ss-use-confirm-title">Roll <strong>${escapeHtml(label)}</strong> for <strong>${escapeHtml(actor.name ?? "Actor")}</strong>?</p>
      </header>
    </section>
  `;

  if (globalThis.Dialog?.confirm) {
    const result = await Dialog.confirm({
      title,
      content,
      yes: () => ({ confirmed: true }),
      no: () => ({ confirmed: false }),
      defaultYes: false
    }, {
      width: 520,
      classes: ["ss-use-confirm-dialog"]
    });
    if (result && typeof result === "object" && "confirmed" in result) return result;
    return { confirmed: !!result };
  }

  return { confirmed: !!globalThis.confirm?.(`Roll ${label}?`) };
}

function sendRollInfoToGmWhisper(actor, rollRequest) {
  const gms = getActiveGmIds();
  if (!gms.length) return false;
  if (!actor || !rollRequest) return false;

  const actorName = String(actor.name ?? "Actor");
  const label = String(rollRequest.label ?? "Roll");
  const content = `
    <section class="ss-use-gm-whisper">
      <p><strong>[Sheet Sidekick ROLL]</strong> ${escapeHtml(actorName)} requested <strong>${escapeHtml(label)}</strong></p>
    </section>
  `;
  ChatMessage.create({ content, whisper: gms }).catch((err) => {
    console.error("Sheet Sidekick roll info whisper failed:", err);
  });
  return true;
}

function waitForRenderedItemTooltip(timeoutMs = 1400) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const tooltip = document.querySelector("#tooltip.active.item-tooltip, #tooltip.active .item-tooltip")?.closest?.("#tooltip")
        ?? document.querySelector("#tooltip.active");
      const content = tooltip?.querySelector?.(".content");
      if (content) {
        const html = content.innerHTML ?? "";
        const stillLoading = /fa-spinner\s+fa-spin-pulse/i.test(html) || /<section class="loading"/i.test(html);
        if (!stillLoading || (Date.now() - start) >= timeoutMs) return resolve(content);
      }
      if ((Date.now() - start) >= timeoutMs) return resolve(content ?? null);
      window.setTimeout(check, 55);
    };
    check();
  });
}

function normalizeLockedTooltipMarkup(root) {
  if (!(root instanceof HTMLElement)) return;

  const currencyMap = {
    pp: "PP",
    gp: "GP",
    ep: "EP",
    sp: "SP",
    cp: "CP"
  };

  root.querySelectorAll(".header .bottom .price").forEach((priceEl) => {
    const valueEl = priceEl.querySelector("span");
    const icon = priceEl.querySelector("i.currency");
    const rawValue = String(valueEl?.textContent ?? "").trim();
    if (!rawValue) {
      priceEl.classList.add("ss-empty");
      return;
    }

    const iconClass = icon
      ? Array.from(icon.classList).find((cls) => currencyMap[cls])
      : "";
    const code = iconClass ? currencyMap[iconClass] : "";
    if (valueEl && code && !new RegExp(`\\b${code}$`, "i").test(rawValue)) {
      valueEl.textContent = `${rawValue} ${code}`;
    }
  });

  root.querySelectorAll(".header .bottom .weight").forEach((weightEl) => {
    const valueEl = weightEl.querySelector("span");
    const rawValue = String(valueEl?.textContent ?? "").trim();
    if (!rawValue) {
      weightEl.classList.add("ss-empty");
      return;
    }
    if (valueEl && !/\blb\b/i.test(rawValue)) {
      valueEl.textContent = `${rawValue} lb`;
    }
  });

  root.querySelectorAll(".header .bottom .charges").forEach((chargesEl) => {
    const text = String(chargesEl.textContent ?? "").trim();
    if (!text) chargesEl.classList.add("ss-empty");
  });
}

function setupLockedTooltipScrollCue(dialogApp) {
  const root = dialogApp?.element?.[0]
    ?? document.querySelector(`.app.ss-locked-tooltip-dialog[data-appid="${dialogApp?.appId}"]`)
    ?? document.querySelector(".app.ss-locked-tooltip-dialog");
  if (!(root instanceof HTMLElement)) return;

  const scroller = root.querySelector(".window-content .dialog-content")
    ?? root.querySelector(".window-content");
  if (!(scroller instanceof HTMLElement)) return;

  const update = () => {
    const scrollable = scroller.scrollHeight > (scroller.clientHeight + 8);
    const atBottom = (scroller.scrollTop + scroller.clientHeight) >= (scroller.scrollHeight - 3);
    root.classList.toggle("ss-has-scroll-more", scrollable && !atBottom);
  };

  scroller.scrollTop = 0;
  update();
  scroller.addEventListener("scroll", update, { passive: true });

  dialogApp?.once?.("close", () => {
    scroller.removeEventListener("scroll", update);
    root.classList.remove("ss-has-scroll-more");
  });
}

function getElementZIndex(el) {
  if (!(el instanceof HTMLElement)) return 0;
  const inlineZ = Number.parseInt(String(el.style?.zIndex ?? ""), 10);
  if (Number.isFinite(inlineZ)) return inlineZ;
  const cssZ = Number.parseInt(String(window.getComputedStyle(el).zIndex ?? ""), 10);
  return Number.isFinite(cssZ) ? cssZ : 0;
}

async function openLockedItemTooltipDialogFromButton(btn, title = "Item Details", contextEl = null) {
  if (!(btn instanceof HTMLElement)) return;
  if (!game.tooltip?.activate) return;

  const uuid = String(btn.dataset?.uuid ?? "").trim();
  const hadItemTooltipClass = btn.classList.contains("item-tooltip");
  const prevTooltip = btn.dataset.tooltip;
  const prevTooltipClass = btn.dataset.tooltipClass;
  const prevTooltipDirection = btn.dataset.tooltipDirection;

  btn.classList.add("item-tooltip");
  btn.dataset.tooltip = `<section class="loading" data-uuid="${uuid}"><i class="fas fa-spinner fa-spin-pulse"></i></section>`;
  btn.dataset.tooltipClass = prevTooltipClass || "dnd5e2 dnd5e-tooltip item-tooltip themed theme-light";
  btn.dataset.tooltipDirection = prevTooltipDirection || "LEFT";

  game.tooltip.activate(btn);
  const renderedContent = await waitForRenderedItemTooltip(1500);
  const bodyHtml = renderedContent?.innerHTML?.trim()
    ? renderedContent.innerHTML
    : "<p>No details available.</p>";
  const root = document.createElement("div");
  root.innerHTML = bodyHtml;
  normalizeLockedTooltipMarkup(root);
  const finalHtml = root.innerHTML;

  try {
    game.tooltip?.deactivate?.();
  } catch (_err) {
    // noop
  }

  if (!hadItemTooltipClass) btn.classList.remove("item-tooltip");
  if (typeof prevTooltip === "string") btn.dataset.tooltip = prevTooltip;
  else delete btn.dataset.tooltip;
  if (typeof prevTooltipClass === "string") btn.dataset.tooltipClass = prevTooltipClass;
  else delete btn.dataset.tooltipClass;
  if (typeof prevTooltipDirection === "string") btn.dataset.tooltipDirection = prevTooltipDirection;
  else delete btn.dataset.tooltipDirection;

  const width = Math.min(Math.round((window.innerWidth || 1000) * 0.8), 980);
  const height = Math.min(Math.round((window.innerHeight || 800) * 0.82), 980);
  if (!globalThis.Dialog) return;

  try {
    const prev = globalThis.__SS_LOCKED_TOOLTIP_DIALOG__;
    if (prev?.rendered) prev.close();
  } catch (_err) {
    // noop
  }

  const app = new Dialog({
    title: String(title || "Item Details"),
    content: `<section class="ss-locked-tooltip-body">${finalHtml}</section>`,
    buttons: {
      close: {
        label: "Close",
        icon: '<i class="fa-solid fa-xmark"></i>'
      }
    },
    default: "close"
  }, {
    classes: ["ss-locked-tooltip-dialog"],
    width,
    height
  });
  globalThis.__SS_LOCKED_TOOLTIP_DIALOG__ = app;
  app.render(true);
  const forceDialogAboveOthers = () => {
    const el = app?.element?.[0]
      ?? document.querySelector(`.app.ss-locked-tooltip-dialog[data-appid="${app?.appId}"]`)
      ?? document.querySelector(".app.ss-locked-tooltip-dialog");
    if (!(el instanceof HTMLElement)) return;

    const contextNode = (contextEl instanceof HTMLElement ? contextEl : btn)
      .closest?.(".app.window-app, .app.dialog, dialog.application");
    const contextZ = getElementZIndex(contextNode);

    let maxZ = 100;
    document.querySelectorAll(".app.window-app, .app.dialog, dialog.application").forEach((node) => {
      if (!(node instanceof HTMLElement) || node === el) return;
      maxZ = Math.max(maxZ, getElementZIndex(node));
    });
    const targetZ = Math.max(maxZ + 2, contextZ + 4, 2000);
    el.style.zIndex = String(targetZ);
    try { app?.bringToTop?.(); } catch (_err) { /* noop */ }
    const current = getElementZIndex(el);
    if (!Number.isFinite(current) || current < targetZ) el.style.zIndex = String(targetZ);
  };

  window.setTimeout(() => {
    setupLockedTooltipScrollCue(app);
    forceDialogAboveOthers();
  }, 20);
  window.setTimeout(forceDialogAboveOthers, 90);
}

function normalizeActivationKind(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const compact = raw.replace(/[\s_-]+/g, "");
  if (compact === "ba" || compact.includes("bonus")) return "bonus";
  if (compact === "r" || compact.includes("reaction")) return "reaction";
  if (compact === "a" || compact.includes("action")) return "action";
  return "";
}

function inferRowActivationKinds(row, item = null) {
  const out = new Set();
  const addKind = (v) => {
    const kind = normalizeActivationKind(v);
    if (kind) out.add(kind);
  };

  if (item) {
    const activities = getItemActivities(item);
    activities.forEach((a) => {
      addKind(a?.activation?.type ?? a?.activation?.value ?? a?.activation);
    });
    addKind(item.system?.activation?.type ?? item.system?.activation?.value);
    addKind(item.labels?.activation);
  }

  const subtitle = row?.querySelector?.(".name .subtitle, .name-stacked .subtitle")?.textContent ?? "";
  const itemTime = row?.querySelector?.(".item-detail.item-time .condensed, .item-detail.item-time")?.textContent ?? "";
  const ariaLabel = row?.querySelector?.(".item-name[aria-label]")?.getAttribute?.("aria-label") ?? "";
  const blob = `${subtitle} ${itemTime} ${ariaLabel}`.toLowerCase();
  if (/\bbonus\s*action\b/.test(blob) || /\bba\b/.test(blob)) out.add("bonus");
  if (/\breaction\b/.test(blob)) out.add("reaction");
  if (/(^|\W)a($|\W)/.test(blob) || /\baction\b/.test(blob)) out.add("action");

  return out;
}

function getRowItem(row, actor) {
  const itemId = String(row?.dataset?.itemId ?? "");
  return itemId ? actor?.items?.get?.(itemId) ?? null : null;
}

function rowMatchesActionFilter(row, actor, mode) {
  if (mode === "all") return true;
  const item = getRowItem(row, actor);
  const kinds = inferRowActivationKinds(row, item);
  return kinds.has(mode);
}

function rowMatchesPreparedFilter(row, actor, mode) {
  if (mode !== "prepared") return true;
  const item = getRowItem(row, actor);
  if (!item || item.type !== "spell") return false;
  const prep = item.system?.preparation ?? {};
  const prepMode = String(prep.mode ?? prep.type ?? "").toLowerCase();
  const isPrepared = prep.prepared === true;
  if (prepMode === "always") return true; // include Always Prepared
  const lvl = Number(item.system?.level ?? 0);
  if (Number.isFinite(lvl) && lvl <= 0) {
    // Cantrips only count if explicitly marked prepared-like.
    return isPrepared || prepMode === "atwill";
  }
  return isPrepared;
}

function isItemEquipped(item) {
  if (!item) return false;
  const raw = item.system?.equipped;
  if (typeof raw === "boolean") return raw;
  if (raw && typeof raw === "object") {
    return !!(raw.value ?? raw.equipped ?? raw.active);
  }
  return false;
}

function rowMatchesEquippedFilter(row, actor, mode) {
  if (mode !== "equipped") return true;
  const item = getRowItem(row, actor);
  return isItemEquipped(item);
}

function getFilterMode(tab, group) {
  if (!(tab instanceof HTMLElement)) return "all";
  if (group === "prepared") return String(tab.dataset?.ssPreparedFilter ?? "all");
  if (group === "equip") return String(tab.dataset?.ssEquipFilter ?? "all");
  return String(tab.dataset?.ssActionFilter ?? "all");
}

function setFilterMode(tab, group, value) {
  if (!(tab instanceof HTMLElement)) return;
  const normalized = String(value ?? "all");
  if (group === "prepared") {
    tab.dataset.ssPreparedFilter = normalized;
    return;
  }
  if (group === "equip") {
    tab.dataset.ssEquipFilter = normalized;
    return;
  }
  tab.dataset.ssActionFilter = normalized;
}

function getItemViewMode(tab) {
  if (!(tab instanceof HTMLElement)) return "list";
  const mode = String(tab.dataset?.ssItemView ?? "list").toLowerCase();
  return mode === "grid" ? "grid" : "list";
}

function setItemViewMode(tab, value) {
  if (!(tab instanceof HTMLElement)) return;
  tab.dataset.ssItemView = (String(value ?? "list").toLowerCase() === "grid") ? "grid" : "list";
}

function applyItemViewModeToTab(tab) {
  if (!(tab instanceof HTMLElement)) return;
  const mode = getItemViewMode(tab);
  tab.classList.toggle("ss-items-grid-view", mode === "grid");
  tab.classList.toggle("ss-items-list-view", mode !== "grid");
}

function applyActionFilterToTab(tab, actor) {
  if (!(tab instanceof HTMLElement)) return;
  const tabName = String(tab.dataset?.tab ?? "").toLowerCase();
  const actionMode = getFilterMode(tab, "action");
  const preparedMode = getFilterMode(tab, "prepared");
  const equipMode = getFilterMode(tab, "equip");
  const rows = tab.querySelectorAll("li.item[data-item-id]");
  rows.forEach((row) => {
    let match = true;
    if (tabName === "features" || tabName === "spells") {
      match = match && rowMatchesActionFilter(row, actor, actionMode);
    }
    if (tabName === "spells") {
      match = match && rowMatchesPreparedFilter(row, actor, preparedMode);
    }
    if (tabName === "inventory") {
      match = match && rowMatchesEquippedFilter(row, actor, equipMode);
    }
    row.classList.toggle("ss-action-filter-muted", !match);
  });
  applyItemViewModeToTab(tab);
}

function updateActionFilterButtons(tab) {
  if (!(tab instanceof HTMLElement)) return;
  tab.querySelectorAll(".ss-action-filter-btn").forEach((btn) => {
    const group = String(btn.dataset?.filterGroup ?? "action");
    const value = String(btn.dataset?.filterValue ?? "all");
    const isActive = getFilterMode(tab, group) === value;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  const viewBtn = tab.querySelector(".ss-action-view-toggle");
  if (viewBtn instanceof HTMLButtonElement) {
    const mode = getItemViewMode(tab);
    const nextMode = mode === "grid" ? "list" : "grid";
    const label = (nextMode === "grid") ? "Grid View" : "List View";
    const icon = (nextMode === "grid") ? "fa-grip" : "fa-list";
    viewBtn.dataset.viewMode = mode;
    viewBtn.dataset.nextViewMode = nextMode;
    viewBtn.classList.toggle("active", mode === "grid");
    viewBtn.setAttribute("aria-pressed", String(mode === "grid"));
    viewBtn.setAttribute("aria-label", `Switch to ${label}`);
    viewBtn.setAttribute("title", `Switch to ${label}`);
    viewBtn.innerHTML = `<i class="fa-solid ${icon}" inert></i>`;
  }
}

function ensureActionFilterBars(scope, actor) {
  if (!(scope instanceof HTMLElement)) return;
  const tabs = scope.querySelectorAll("section.tab[data-tab='spells'], section.tab[data-tab='features'], section.tab[data-tab='inventory']");
  tabs.forEach((tab) => {
    const tabName = String(tab.dataset?.tab ?? "");
    const middle = tab.querySelector(".middle");
    if (!(middle instanceof HTMLElement)) return;
    let bar = tab.querySelector(".ss-action-filter-bar");
    if (!(bar instanceof HTMLElement)) {
      bar = document.createElement("div");
      bar.className = "ss-action-filter-bar";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Action filter");
      if (tabName === "inventory") {
        bar.innerHTML = `
          <span class="ss-action-filter-label">Filter</span>
          <button type="button" class="ss-action-filter-btn active" data-filter-group="equip" data-filter-value="all" aria-pressed="true">All</button>
          <button type="button" class="ss-action-filter-btn" data-filter-group="equip" data-filter-value="equipped" aria-pressed="false">Equipped</button>
        `;
      } else if (tabName === "spells") {
        bar.innerHTML = `
          <span class="ss-action-filter-label">Filter</span>
          <button type="button" class="ss-action-filter-btn active" data-filter-group="action" data-filter-value="all" aria-pressed="true">All</button>
          <button type="button" class="ss-action-filter-btn" data-filter-group="action" data-filter-value="bonus" aria-pressed="false">Bonus</button>
          <button type="button" class="ss-action-filter-btn" data-filter-group="action" data-filter-value="reaction" aria-pressed="false">Reaction</button>
          <button type="button" class="ss-action-filter-btn ss-action-filter-secondary" data-filter-group="prepared" data-filter-value="prepared" aria-pressed="false">Prepared</button>
        `;
      } else {
        bar.innerHTML = `
          <span class="ss-action-filter-label">Filter</span>
          <button type="button" class="ss-action-filter-btn active" data-filter-group="action" data-filter-value="all" aria-pressed="true">All</button>
          <button type="button" class="ss-action-filter-btn" data-filter-group="action" data-filter-value="bonus" aria-pressed="false">Bonus</button>
          <button type="button" class="ss-action-filter-btn" data-filter-group="action" data-filter-value="reaction" aria-pressed="false">Reaction</button>
        `;
      }
      middle.insertAdjacentElement("afterend", bar);
    }
    let viewBtn = bar.querySelector(".ss-action-view-toggle");
    if (!(viewBtn instanceof HTMLButtonElement)) {
      viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "ss-action-filter-btn ss-action-view-toggle";
      viewBtn.setAttribute("aria-pressed", "false");
      bar.appendChild(viewBtn);
    }
    if (!tab.dataset.ssActionFilter) tab.dataset.ssActionFilter = "all";
    if (tabName === "spells" && !tab.dataset.ssPreparedFilter) tab.dataset.ssPreparedFilter = "all";
    if (tabName === "inventory" && !tab.dataset.ssEquipFilter) tab.dataset.ssEquipFilter = "all";
    if (!tab.dataset.ssItemView) tab.dataset.ssItemView = "list";
    updateActionFilterButtons(tab);
    applyActionFilterToTab(tab, actor);
    bar.setAttribute("data-ss-filter-tab", tabName);
  });
}

const ssDpadNavObserverByForm = globalThis.__SS_DPAD_NAV_OBSERVERS__ ?? (globalThis.__SS_DPAD_NAV_OBSERVERS__ = new WeakMap());
const ssDpadNavResizeObserverByForm = globalThis.__SS_DPAD_NAV_RESIZE_OBSERVERS__ ?? (globalThis.__SS_DPAD_NAV_RESIZE_OBSERVERS__ = new WeakMap());

const ssSheetScrollState = globalThis.__SS_SHEET_SCROLL_STATE__ ?? (globalThis.__SS_SHEET_SCROLL_STATE__ = new Map());
const ssSidebarPanelState = globalThis.__SS_SIDEBAR_PANEL_STATE__ ?? (globalThis.__SS_SIDEBAR_PANEL_STATE__ = new Map());
const ssUiEnsureState = globalThis.__SS_UI_ENSURE_STATE__ ?? (globalThis.__SS_UI_ENSURE_STATE__ = {
  timer: null,
  stopAt: 0,
  stableTicks: 0
});
const ssFormRefreshState = globalThis.__SS_FORM_REFRESH_STATE__ ?? (globalThis.__SS_FORM_REFRESH_STATE__ = {
  timer: null
});
const ssProxyTargetsByUser = globalThis.__SS_PROXY_TARGETS_BY_USER__ ?? (globalThis.__SS_PROXY_TARGETS_BY_USER__ = new Map());

function setProxyTargetsForUser(userId, sceneId, tokenIds) {
  if (!userId) return;
  ssProxyTargetsByUser.set(String(userId), {
    sceneId: sceneId ? String(sceneId) : null,
    tokenIds: Array.isArray(tokenIds) ? tokenIds.map(String) : [],
    updatedAt: Date.now()
  });
}

function getProxyTargetsForUser(userId) {
  if (!userId) return null;
  const data = ssProxyTargetsByUser.get(String(userId));
  if (!data) return null;

  // Drop stale proxy targets after 2 hours.
  if (Number.isFinite(data.updatedAt) && (Date.now() - data.updatedAt > 2 * 60 * 60 * 1000)) {
    ssProxyTargetsByUser.delete(String(userId));
    return null;
  }

  return data;
}

function applyTargetsForCurrentGmUser(tokenIds) {
  if (!game.user?.isGM) return [];
  if (!canvas?.ready) return [];

  const validIds = Array.from(new Set(
    (Array.isArray(tokenIds) ? tokenIds : [])
      .map((id) => String(id))
      .filter((id) => !!canvas.tokens?.get?.(id))
  ));

  try {
    game.user.updateTokenTargets?.(validIds);
  } catch (_err) {
    // noop
  }

  try {
    const targeted = new Set(validIds);
    for (const token of (canvas.tokens?.placeables ?? [])) {
      token.setTarget(targeted.has(token.id), {
        releaseOthers: false,
        groupSelection: true,
        user: game.user
      });
    }
  } catch (_err) {
    // noop
  }

  try {
    game.user.broadcastActivity?.({ targets: validIds });
  } catch (_err) {
    // noop
  }

  return validIds;
}

function getSidebarPanelKey(app, scope) {
  // Prefer the rendered form id because refresh passes can miss the app instance.
  // Using a stable DOM key prevents the sidebar state from snapping back to collapsed.
  const keyPart =
    scope?.dataset?.ssSidebarKey
    ?? scope?.id
    ?? scope?.dataset?.actorId
    ?? app?.actor?.id
    ?? app?.id
    ?? "sheet";
  return `${game.user?.id ?? "u"}:${keyPart}`;
}

function ensureSidebarToggleElement(scope) {
  if (!scope) return null;

  const windowContent = scope.querySelector("section.window-content, .window-content");
  const header = windowContent?.querySelector("header.sheet-header") ?? scope.querySelector("header.sheet-header");
  if (!header || !windowContent) return null;

  let toggleBtn = windowContent.querySelector(".ss-sidebar-toggle");
  if (!toggleBtn) {
    toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "ss-sidebar-toggle";
    header.insertAdjacentElement("afterend", toggleBtn);
  }

  if (toggleBtn.dataset.ssStyled !== "1") {
    toggleBtn.dataset.ssStyled = "1";
    Object.assign(toggleBtn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "2.3rem",
      height: "1.4rem",
      margin: "0.1rem auto 0.35rem",
      borderRadius: "999px",
      border: "1px solid var(--color-border-light-2, #666)",
      background: "rgba(20, 24, 31, 0.88)",
      color: "var(--dnd5e-color-gold, #d6b56d)",
      fontSize: "0.95rem",
      lineHeight: "1",
      cursor: "pointer",
      zIndex: "25",
      pointerEvents: "auto"
    });
  }
  return toggleBtn;
}

function syncSidebarOverlayBounds(scope) {
  if (!(scope instanceof HTMLElement)) return;
  if (!scope.matches?.(SS_SHEET_DND5E_CHAR_FORM_SELECTOR)) return;

  const toggleBtn = scope.querySelector(".ss-sidebar-toggle");
  if (!(toggleBtn instanceof HTMLElement)) return;

  const btnRect = toggleBtn.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;

  // Start the overlay just under the toggle pill.
  const topPx = Math.max(0, Math.round(btnRect.bottom + 8));
  // The sidebar should overlay tabs + ability scores while expanded, so do not reserve
  // space for them. Keep only a small bottom margin and let CSS fallback handle safe-area.
  const bottomPx = 8;
  scope.style.setProperty("--ss-sidebar-overlay-top", `${topPx}px`);
  scope.style.setProperty("--ss-sidebar-overlay-bottom", `${bottomPx}px`);
}

function eventHitsSidebarOrToggle(event, scope) {
  if (!(scope instanceof HTMLElement)) return false;
  const sidebarSel = ".sheet-body .main-content > .sidebar";
  const toggleSel = ".ss-sidebar-toggle";

  const path = typeof event?.composedPath === "function" ? event.composedPath() : null;
  if (Array.isArray(path) && path.length) {
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(sidebarSel) || node.matches?.(toggleSel)) return true;
      if (node.closest?.(sidebarSel) || node.closest?.(toggleSel)) return true;
      if (node === scope) break;
    }
    return false;
  }

  const target = event?.target;
  if (!(target instanceof Element)) return false;
  return !!(target.closest?.(sidebarSel) || target.closest?.(toggleSel));
}

function syncSidebarPanelState(scope, expanded) {
  scope.classList.toggle("ss-sidebar-expanded", !!expanded);
  scope.classList.toggle("ss-sidebar-collapsed", !expanded);
  // Keep the native DnD5e sidebar state class in sync; leaving `sidebar-collapsed`
  // on the form while our custom state is expanded can cause layout conflicts.
  scope.classList.toggle("sidebar-collapsed", !expanded);
  scope.dataset.ssSidebarState = expanded ? "expanded" : "collapsed";

  const toggleBtn = scope.querySelector(".ss-sidebar-toggle");
  syncSidebarOverlayBounds(scope);
  if (!toggleBtn) return;

  const label = expanded ? "Hide Sidebar Stats" : "Show Sidebar Stats";
  toggleBtn.setAttribute("aria-expanded", String(!!expanded));
  toggleBtn.setAttribute("aria-label", label);
  toggleBtn.setAttribute("title", label);
  toggleBtn.innerHTML = expanded ? "&#9650;" : "&#9660;";
}

function decorateSheetSidekickTabs(scope) {
  const tabsNav = scope.querySelector("nav.tabs-right, nav.tabs");
  if (!tabsNav) return;

  const defs = [
    { tab: "details", icon: "fa-id-card", label: "Details" },
    { tab: "inventory", icon: "fa-backpack", label: "Inventory" },
    { tab: "features", icon: "fa-bolt", label: "Features" },
    { tab: "spells", icon: "fa-wand-magic-sparkles", label: "Spells" }
  ];

  defs.forEach((def) => {
    const el = tabsNav.querySelector(`a[data-tab='${def.tab}']`);
    if (!el) return;
    if (el.dataset.ssDecoratedTab === "1" && el.dataset.ssDecoratedIcon === def.icon) return;

    el.dataset.ssDecoratedTab = "1";
    el.dataset.ssDecoratedIcon = def.icon;
    el.classList.add("ss-nav-tab", `ss-tab-${def.tab}`);
    el.setAttribute("aria-label", def.label);
    el.setAttribute("title", def.label);
    el.innerHTML = `<i class="fa-solid ${def.icon}" inert></i><span class="ss-tab-label">${def.label}</span>`;
  });

  const dpad = tabsNav.querySelector("a.ss-dpad-fs-toggle");
  if (dpad) {
    dpad.classList.add("ss-nav-tab", "ss-tab-gamepad");
    const hasLabel = !!dpad.querySelector(".ss-tab-label");
    if (!hasLabel) {
      dpad.innerHTML = `<i class="fa-solid fa-gamepad" inert></i><span class="ss-tab-label">Gamepad</span>`;
    }
  }

  const target = tabsNav.querySelector("a.ss-target-fs-toggle");
  if (target) {
    target.classList.add("ss-nav-tab", "ss-tab-targets");
    const hasLabel = !!target.querySelector(".ss-tab-label");
    if (!hasLabel) {
      target.innerHTML = `<i class="fa-solid fa-crosshairs" inert></i><span class="ss-tab-label">Targets</span>`;
    }
  }
}

function decorateSpellSlotPips(scope) {
  if (!scope) return;

  const cards = scope.querySelectorAll("section.spells-list .items-section.card");
  cards.forEach((card) => {
    const header = card.querySelector(":scope > .items-header, :scope > header, .items-header, header");
    if (!header) return;

    const pips = header.querySelector(".pips")
      ?? card.querySelector(":scope > .pips, .items-header .pips, header .pips");
    if (!pips) return;

    if (pips.parentElement !== header) header.appendChild(pips);
    header.classList.add("ss-spell-slot-header");
    pips.classList.add("ss-spell-slot-pips");

    if (!header.querySelector(".ss-spell-slot-label")) {
      const label = document.createElement("span");
      label.className = "ss-spell-slot-label";
      label.textContent = "Spell Slots";
      header.appendChild(label);
    }
  });
}

function getSheetScrollKey(actor) {
  return `${game.user?.id ?? "u"}:${actor?.id ?? "a"}`;
}

function getSheetScrollElements(scope) {
  const elements = [
    scope.querySelector(".window-content"),
    scope.querySelector(".sheet-body .tab-body"),
    scope.querySelector(".sheet-body"),
    scope.querySelector(".tab.active"),
    scope.querySelector(".items-list"),
    scope
  ].filter(Boolean);

  // De-duplicate while preserving order.
  return Array.from(new Set(elements));
}

function saveSheetScroll(scope, actor) {
  const elements = getSheetScrollElements(scope);
  ssSheetScrollState.set(getSheetScrollKey(actor), {
    elements: elements.map(el => ({ top: el.scrollTop, left: el.scrollLeft }))
  });
}

function restoreSheetScroll(scope, actor) {
  const state = ssSheetScrollState.get(getSheetScrollKey(actor));
  if (!state) return;

  const elements = getSheetScrollElements(scope);
  if (!elements.length) return;

  const apply = () => {
    elements.forEach((el, i) => {
      const snap = state.elements?.[i];
      if (!snap) return;
      el.scrollTop = snap.top ?? 0;
      el.scrollLeft = snap.left ?? 0;
    });
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      apply();
      setTimeout(apply, 120);
      setTimeout(apply, 350);
    });
  });
}

function syncSheetSidekickPortraitBackground(app, scope) {
  if (!(scope instanceof HTMLElement)) return;
  if (!scope.matches?.(SS_SHEET_DND5E_CHAR_FORM_SELECTOR)) return;

  const actor = app?.actor ?? null;
  const domPortrait = scope.querySelector(
    ".sheet-body .main-content > .sidebar .card > .portrait > img, .sheet-body .main-content > .sidebar .card > .portrait > video"
  );
  const portrait = String(
    actor?.img
    ?? actor?.prototypeToken?.texture?.src
    ?? domPortrait?.getAttribute?.("src")
    ?? ""
  ).trim();
  if (!portrait) {
    scope.style.setProperty("--ss-actor-portrait-url", "none");
    return;
  }

  const escaped = portrait.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  scope.style.setProperty("--ss-actor-portrait-url", `url("/${escaped}")`);
}

function applySheetSidekickUiCleanup(app, element) {
  try {
    const root = (element instanceof HTMLElement)
      ? element
      : (element?.[0] instanceof HTMLElement ? element[0] : null);
    if (!root) return;

    const scope = root.matches?.(SS_SHEET_FORM_SELECTOR)
      ? root
      : (root.closest?.(SS_SHEET_FORM_SELECTOR)
        ?? root.querySelector?.(SS_SHEET_FORM_SELECTOR)
        ?? null);
    if (!scope) return;
    if (app?.actor?.id && !scope.dataset.actorId) scope.dataset.actorId = String(app.actor.id);
    if (!scope.dataset.ssSidebarKey && scope.id) scope.dataset.ssSidebarKey = String(scope.id);
    syncSheetSidekickPortraitBackground(app, scope);

    const hiddenTabs = ["effects", "biography", "specialTraits"];
    const hiddenTabSelector = hiddenTabs.map((t) => `a[data-tab='${t}']`).join(",");
    const hiddenTabLinks = Array.from(scope.querySelectorAll(hiddenTabSelector));
    const activeBlocked = hiddenTabLinks.some((tab) => tab.classList.contains("active"));

    hiddenTabLinks.forEach((tab) => {
      // Remove blocked tabs from layout entirely so they never consume nav grid slots.
      tab.remove();
    });
    scope.querySelectorAll(hiddenTabs.map((t) => `section.tab[data-tab='${t}']`).join(","))
      .forEach((panel) => { panel.style.display = "none"; });

    if (activeBlocked) {
      const fallback = scope.querySelector(
        "a[data-tab='spells'], a[data-tab='features'], a[data-tab='inventory'], a[data-tab='details']"
      );
      if (fallback) {
        fallback.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    }

    const sidebar = scope.querySelector(
      ".sheet-body .main-content > .sidebar, .sheet-body [data-application-part='sidebar'], .sheet-body .sidebar"
    );
    const toggleBtn = ensureSidebarToggleElement(scope);
    if (!toggleBtn) return;
    decorateSheetSidekickTabs(scope);
    decorateSpellSlotPips(scope);

    const stateKey = getSidebarPanelKey(app, scope);
    const isExpanded = ssSidebarPanelState.has(stateKey) ? !!ssSidebarPanelState.get(stateKey) : false;
    syncSidebarPanelState(scope, isExpanded);
    syncSidebarOverlayBounds(scope);

    // If sidebar is not mounted yet, keep the control visible but inert until next cleanup pass.
    const hasSidebar = !!sidebar;
    toggleBtn.disabled = !hasSidebar;
    toggleBtn.style.opacity = hasSidebar ? "1" : "0.55";

    if (toggleBtn.dataset.ssBound !== "1") {
      toggleBtn.dataset.ssBound = "1";
      toggleBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (toggleBtn.disabled) return;
        const nextExpanded = scope.classList.contains("ss-sidebar-collapsed");
        ssSidebarPanelState.set(stateKey, nextExpanded);
        syncSidebarPanelState(scope, nextExpanded);
      });
    }

    if (scope.dataset.ssSidebarOutsideBound !== "1") {
      scope.dataset.ssSidebarOutsideBound = "1";
      scope.addEventListener("pointerdown", (ev) => {
        if (!scope.classList.contains("ss-sidebar-expanded")) return;
        if (eventHitsSidebarOrToggle(ev, scope)) return;

        const liveStateKey = getSidebarPanelKey(app, scope);
        ssSidebarPanelState.set(liveStateKey, false);
        syncSidebarPanelState(scope, false);
      }, { passive: true });
    }
  } catch (err) {
    console.error("Sheet Sidekick cleanup error:", err);
  }
}

function refreshSheetSidekickUiCleanup() {
  const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
  forms.forEach((form) => {
    if (!needsSheetSidekickUiCleanup(form)) return;
    ensureSidebarToggleElement(form);
    try {
      const app = Object.values(ui.windows ?? {}).find((w) => String(w?.id ?? "") === String(form.id));
      applySheetSidekickUiCleanup(app ?? { actor: null }, form);
    } catch (_err) {
      // noop
    }
  });
}

function needsSheetSidekickUiCleanup(form) {
  if (!(form instanceof HTMLElement)) return false;

  const btn = form.querySelector(".ss-sidebar-toggle");
  if (!btn) return true;
  if (btn.dataset.ssBound !== "1") return true;
  if (!form.classList.contains("ss-sidebar-expanded") && !form.classList.contains("ss-sidebar-collapsed")) return true;

  const tabsNav = form.querySelector("nav.tabs-right, nav.tabs");
  if (tabsNav) {
    const requiredTabs = ["details", "inventory", "features", "spells"];
    for (const tab of requiredTabs) {
      const el = tabsNav.querySelector(`a[data-tab='${tab}']`);
      if (el && !el.querySelector(".ss-tab-label")) return true;
    }
  }

  return false;
}

function startSheetSidekickUiEnsure(durationMs = 10000) {
  if (game.user?.isGM) return;

  ssUiEnsureState.stopAt = Math.max(ssUiEnsureState.stopAt, Date.now() + durationMs);
  refreshSheetSidekickUiCleanup();
  if (ssUiEnsureState.timer) return;

  ssUiEnsureState.timer = window.setInterval(() => {
    const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR));
    const needsWork = forms.some((f) => needsSheetSidekickUiCleanup(f));
    if (needsWork) refreshSheetSidekickUiCleanup();

    const complete = forms.length > 0 && !needsWork;
    ssUiEnsureState.stableTicks = complete ? (ssUiEnsureState.stableTicks + 1) : 0;

    if (Date.now() >= ssUiEnsureState.stopAt || ssUiEnsureState.stableTicks >= 4) {
      window.clearInterval(ssUiEnsureState.timer);
      ssUiEnsureState.timer = null;
      ssUiEnsureState.stableTicks = 0;
    }
  }, 450);
}
globalThis.ssStartSheetSidekickUiEnsure = startSheetSidekickUiEnsure;

Hooks.once("setup", () => {
  if (game.user?.isGM) {
    try {
      localStorage.setItem(PLAYER_SLIM_KEYS.role, "gm");
    } catch (_err) {
      // Ignore storage failures.
    }
    return;
  }

  applyPlayerSlimPolicyForUser();
  installEarlyPlayerSlimNotificationFilter();
  installResolutionWarningDomGuard(20000);
  if (!isSheetSidekickModuleActive()) return;

  document.body.classList.add("ss-player-client");
  document.body.classList.add("ss-player-client");
  syncMonitorClientClasses();

  const ua = navigator.userAgent ?? "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  if (isIOS && isSafari) {
    document.body.classList.add("ss-ios-safari");
    document.body.classList.add("ss-ios-safari");
  }

  document.body.classList.add("ss-sheet-loading");
  document.body.classList.add("ss-sheet-loading");
});

Hooks.once("ready", () => {
  if (game.user?.isGM) return;
  applyPlayerSlimPolicyForUser();
  installEarlyPlayerSlimNotificationFilter();
  installResolutionWarningDomGuard(12000);
  if (!isSheetSidekickModuleActive()) return;
  syncMonitorClientClasses();
  setTimeout(syncMonitorClientClasses, 250);
  setTimeout(syncMonitorClientClasses, 1200);
  ensureMonitorMeasurementVisible();
  setTimeout(ensureMonitorMeasurementVisible, 120);
  setTimeout(ensureMonitorMeasurementVisible, 700);
  setTimeout(ensureMonitorMeasurementVisible, 1600);

  if (!globalThis.__SS_MONITOR_MEASUREMENT_OBSERVER__) {
    let queued = false;
    const queueApply = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        ensureMonitorMeasurementVisible();
      }, 60);
    };

    const obs = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        if (m.type === "attributes") {
          return m.target === document.body || (m.target instanceof HTMLElement && m.target.id === "measurement");
        }
        if (m.type === "childList") {
          const nodes = [...m.addedNodes, ...m.removedNodes];
          return nodes.some((n) => (n instanceof HTMLElement) && (n.id === "measurement" || !!n.querySelector?.("#measurement")));
        }
        return false;
      });
      if (!relevant) return;
      queueApply();
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    globalThis.__SS_MONITOR_MEASUREMENT_OBSERVER__ = obs;
  }

  const clearLoading = () => {
    if (!document.querySelector(SS_SHEET_FORM_SELECTOR)) return false;
    document.body.classList.remove("ss-sheet-loading");
    document.body.classList.remove("ss-sheet-loading");
    return true;
  };

  if (clearLoading()) return;

  const obs = new MutationObserver(() => {
    if (!clearLoading()) return;
    obs.disconnect();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    document.body.classList.remove("ss-sheet-loading");
    document.body.classList.remove("ss-sheet-loading");
    obs.disconnect();
  }, 15000);
});

Hooks.once("init", () => {
  if (!game.user || game.user.isGM) return;
  if (!game.settings?.settings?.has("core.noCanvas")) return;

  let shouldDisableCanvas = false;
  try {
    shouldDisableCanvas = shouldForceNoCanvasForSheetSidekickUser();
  } catch (err) {
    console.warn("[custom-js] Could not evaluate Sheet Sidekick bootstrap state.", err);
    return;
  }
  if (!shouldDisableCanvas) return;

  const noCanvasEnabled = game.settings.get("core", "noCanvas") === true;
  if (noCanvasEnabled) return;

  const oncePerSessionKey = "custom-js:no-canvas-bootstrap";
  if (sessionStorage.getItem(oncePerSessionKey) === "1") return;
  sessionStorage.setItem(oncePerSessionKey, "1");

  game.settings.set("core", "noCanvas", true)
    .then(() => foundry.utils.debouncedReload())
    .catch((err) => {
      console.warn("[custom-js] Failed to set core.noCanvas for Sheet Sidekick user.", err);
    });
});

Hooks.on("ready", () => {
  if (isSheetSidekickPlayerFastPath()) return;

  function updateTooltipVisibility() {
    const sheet = document.querySelector(SS_SHEET_FORM_SELECTOR);
    const tooltip = document.querySelector('aside#tooltip');

    if (!tooltip || !sheet) return;

    // Only hide if we're not actively trying to show it
    const shouldHide = !document.body.classList.contains("show-weapon-tooltip");

    tooltip.style.display = shouldHide ? "none" : "block";
  }

  let tooltipNodeObserver = null;
  const bindTooltipNodeObserver = () => {
    const tooltip = document.querySelector("aside#tooltip");
    if (!tooltip || tooltip.dataset.ssTooltipObserved === "1") return;
    tooltip.dataset.ssTooltipObserved = "1";
    tooltipNodeObserver = new MutationObserver(updateTooltipVisibility);
    tooltipNodeObserver.observe(tooltip, { attributes: true, attributeFilter: ["style", "class"] });
  };

  // Observe direct body child changes only (cheap), then bind tooltip observer if needed.
  const bodyChildObserver = new MutationObserver(() => {
    bindTooltipNodeObserver();
    updateTooltipVisibility();
  });
  bodyChildObserver.observe(document.body, { childList: true });

  // Also listen for body class changes
  const classObserver = new MutationObserver(updateTooltipVisibility);
  classObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Run once at start
  bindTooltipNodeObserver();
  updateTooltipVisibility();
});

// Block for weapons
Hooks.on("renderActorSheet", (app, html, data) => {
  if (isSheetSidekickPlayerFastPath()) return;

  const actor = app.actor;
  if (!actor) return;

  html.find(".item-name.item-tooltip[role='button']").on("click.weapon-tooltip-toggle", function (e) {
    const $li = $(this).closest("li.item");

    if ($li.data("grouped") === "weapon") {
      debugLog("✅ Weapon clicked — showing tooltip");
      document.body.classList.add("show-weapon-tooltip");
    } else {
      document.body.classList.remove("show-weapon-tooltip");
    }
  });
});

// Optional: Clicking outside any item hides the tooltip
Hooks.once("ready", () => {
  if (isSheetSidekickPlayerFastPath()) return;
  document.addEventListener("click", (e) => {
    if (!e.target.closest("li.item[data-grouped='weapon']")) {
      document.body.classList.remove("show-weapon-tooltip");
    }
  });
});


// Block #2 - Full height fix for mobile
Hooks.on("ready", () => {
  function resizeSheet() {
    const sheet = document.querySelector(SS_SHEET_FORM_SELECTOR);
    if (sheet) {
      const height = window.innerHeight;
      sheet.style.height = height + "px";
    }
  }

  window.addEventListener("resize", resizeSheet);
  window.addEventListener("orientationchange", resizeSheet);
  resizeSheet();
});

// Block #3 - Currency tooltip and input change
const ssCurrencyLabelByKey = {
  cp: "Copper",
  sp: "Silver",
  ep: "Electrum",
  gp: "Gold",
  pp: "Platinum"
};

const ssCurrencyNameToKey = {
  copper: "cp",
  silver: "sp",
  electrum: "ep",
  gold: "gp",
  platinum: "pp"
};

function getHookRoot(el) {
  if (el instanceof HTMLElement) return el;
  if (el?.[0] instanceof HTMLElement) return el[0];
  return null;
}

function inferCurrencyKey(labelEl, iconEl) {
  const className = String(iconEl?.className ?? "").toLowerCase();
  const classMatch = className.match(/\b(cp|sp|ep|gp|pp)\b/);
  if (classMatch?.[1]) return classMatch[1];

  const inputName = String(labelEl.querySelector("input")?.getAttribute("name") ?? "").toLowerCase();
  const inputMatch = inputName.match(/currency\.([a-z]{2})\b/);
  if (inputMatch?.[1]) return inputMatch[1];

  const dataKey = String(labelEl.getAttribute("data-currency") ?? "").toLowerCase();
  if (dataKey && ssCurrencyLabelByKey[dataKey]) return dataKey;

  const tooltip = String(iconEl?.getAttribute("data-tooltip") ?? "").toLowerCase();
  if (tooltip && ssCurrencyNameToKey[tooltip]) return ssCurrencyNameToKey[tooltip];

  const aria = String(labelEl.getAttribute("aria-label") ?? "").toLowerCase();
  if (aria && ssCurrencyNameToKey[aria]) return ssCurrencyNameToKey[aria];

  return "";
}

function applyCurrencyUiEnhancements(scope) {
  const root = getHookRoot(scope) ?? (scope instanceof Document ? scope.body : null);
  if (!root?.querySelectorAll) return;

  root.querySelectorAll("section.currency label").forEach((labelEl) => {
    const icon = labelEl.querySelector("i.currency");
    if (!icon) return;

    const key = inferCurrencyKey(labelEl, icon);
    const fallback = String(icon.getAttribute("data-tooltip") ?? labelEl.getAttribute("aria-label") ?? "Currency").trim();
    const labelText = ssCurrencyLabelByKey[key] ?? fallback;
    if (!labelText) return;

    let textEl = labelEl.querySelector(".currency-label");
    if (!(textEl instanceof HTMLElement)) {
      textEl = document.createElement("span");
      textEl.className = "currency-label";
      icon.insertAdjacentElement("afterend", textEl);
    }

    textEl.textContent = labelText;
    textEl.setAttribute("title", labelText);
  });

  root.querySelectorAll("section.currency input").forEach((input) => {
    input.setAttribute("inputmode", "text");
    input.setAttribute("pattern", "[0-9+\\-]*");
  });
}

Hooks.on("renderActorSheet", (_app, html, _data) => {
  applyCurrencyUiEnhancements(html);
});
Hooks.on("renderActorSheetV2", (_app, element, _data) => {
  applyCurrencyUiEnhancements(element);
});
Hooks.on("renderItemSheet", (_app, html, _data) => {
  applyCurrencyUiEnhancements(html);
});
Hooks.on("renderItemSheetV2", (_app, element, _data) => {
  applyCurrencyUiEnhancements(element);
});
Hooks.on("ready", () => {
  applyCurrencyUiEnhancements(document);
});

Hooks.on("ready", () => {
  debugLog("🛠 Filter toggle fixed v2 initialized");

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest(".filter-control");

    if (!button) return;

    // Find the next .filter-list in the DOM (usually it's nearby)
    const dropdown = button.parentElement?.querySelector(".filter-list");

    if (!dropdown) {
      console.warn("⚠️ No .filter-list found near:", button.parentElement);
      return;
    }

    // Toggle logic
    const isVisible = dropdown.classList.toggle("visible");

    // Optional: close other dropdowns
    if (isVisible) {
      document.querySelectorAll(".filter-list").forEach(el => {
        if (el !== dropdown) el.classList.remove("visible");
      });
    }

  });
});

// stats on weapons
Hooks.on("renderActorSheetV2", (app, element) => {
  if (isSheetSidekickPlayerFastPath()) return;
  if (app.actor?.type !== "character") return;

  debugLog("✅ Found V2 actor sheet:", app.constructor.name, "for", app.actor.name);

  const weaponRows = element.querySelectorAll("li.item[data-group-type='weapon']");
  debugLog(`🔍 Found ${weaponRows.length} weapon rows`);

  const profs = app.actor.system.traits.weapon?.value ?? [];
  const profBonus = app.actor.system.attributes.prof ?? 0;

  weaponRows.forEach(row => {
    const itemId = row.dataset.itemId;
    const item = app.actor.items.get(itemId);
    if (!item) return;

    if (row.querySelector(".weapon-inline-stats")) return; // Avoid duplicate injection

    const actorData = app.actor.getRollData();

    // --- Which ability to use
    const activity = item.system.activities?.dnd5eactivity000;
    const abilityKey = activity?.attack?.ability ||
      (item.system.properties?.fin ? "dex" : "str");
    const abilityMod = actorData.abilities[abilityKey]?.mod ?? 0;

    // --- Resolve proficiency ---
	const isProficient = !!item.system.prof?.hasProficiency;

	// --- Magical bonus ---
	const magicBonus = Number(item.system.magicalBonus ?? 0);

	// --- Total attack bonus ---
	// Base = ability + magic + proficiency (if applicable)
	let attackBonus = abilityMod + magicBonus + (isProficient ? profBonus : 0);

	// Add actor/system bonuses (mwak, rwak, all)
	const rollData = actorData;
	const isMelee = item.system.range?.units === "ft" && (item.system.range?.value ?? 5) <= 5;
	const atkType = isMelee ? "mwak" : "rwak";

	const bonusStrings = [
	  app.actor.system.bonuses[atkType]?.attack,
	  app.actor.system.bonuses.all?.attack
	].filter(Boolean);

	for (let bonus of bonusStrings) {
	  try {
		const resolved = new Roll(bonus, rollData).evaluateSync().total;
		attackBonus += resolved;
	  } catch (e) {
		console.warn(`Could not parse attack bonus "${bonus}" for ${item.name}`, e);
	  }
	}


    // --- Damage string ---
	let damageText = "";

	// Prefer custom formula/bonus if present
	const dmg = item.system.damage?.base;
	let formulaUsed = false;

	if (dmg?.custom?.enabled && dmg.custom.formula) {
	  damageText = dmg.custom.formula.replace(/@mod/g, abilityMod);
	  formulaUsed = true;
	}
	else if (dmg?.bonus) {
	  damageText = dmg.bonus.replace(/@mod/g, abilityMod);
	  formulaUsed = true;
	}
	else if (item.system.formula) {
	  damageText = item.system.formula.replace(/@mod/g, abilityMod);
	  formulaUsed = true;
	}
	else if (dmg?.number && dmg?.denomination) {
	  damageText = `${dmg.number}d${dmg.denomination}`;
	}

	// Add flat mods (ability + magic) only if formula didn’t already include @mod
	let flat = 0;
	if (!formulaUsed && abilityMod) flat += abilityMod;
	if (magicBonus) flat += magicBonus;
	if (flat !== 0) {
	  damageText += flat > 0 ? `+${flat}` : flat;
	}

	// Damage type if available
	if (dmg?.types?.size) {
	  damageText += " " + Array.from(dmg.types).join(", ");
	}
	
    // --- Inline stats ---
    const statsDiv = document.createElement("div");
    statsDiv.classList.add("weapon-inline-stats");
    statsDiv.style.fontSize = "0.85rem";
    statsDiv.style.lineHeight = "1.2rem";
    statsDiv.style.color = "#fff";
    statsDiv.style.whiteSpace = "normal"; // reset since we’ll use <br>
	statsDiv.innerHTML =
	  `<b>Proficient:</b> ${isProficient ? "✅" : "❌"}<br>` +
	  `<b>Attack Roll:</b> +${attackBonus}<br>` +
	  `<b>Damage Roll:</b> ${damageText}`;
	statsDiv.innerHTML =
	  `<b>Proficient:</b> ${isProficient ? "✅" : "❌"}<br>`;

    const nameElem = row.querySelector(".item-name h4");
    if (nameElem) nameElem.appendChild(statsDiv);
    else row.appendChild(statsDiv);

    debugLog(`🗡️ ${item.name} => prof=${isProficient}, ability=${abilityKey}, atk=+${attackBonus}, dmg=${damageText}`);
  });
});


// simpler quest display
Hooks.on("ready", () => {
  if (isSheetSidekickPlayerFastPath()) return;
  const targetSelector = "section.simpler-quests";

  const enforceQuestVisible = () => {
    if (!document.body.classList.contains("show-combat")) return;

    const questPanel = document.querySelector(targetSelector);
    if (questPanel) {
      debugLog("✅ Found simpler-quests panel. Forcing visible.");
      questPanel.style.setProperty("display", "block", "important");
    }
  };

  // Observe body class only (cheap). Avoid subtree scans of #ui-middle.
  const observer = new MutationObserver(enforceQuestVisible);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // Trigger once on startup in case it's already present
  setTimeout(() => {
    enforceQuestVisible();
  }, 500);
  setTimeout(enforceQuestVisible, 1200);
});

// Hook to make a scene visible
Hooks.on("ready", () => {
  if (!game.user.isGM) return;
  document.body.addEventListener("click", async (event) => {
    const target = event.target.closest("a.entity-link, a.content-link");
    if (!target) return;

    const uuid = target.dataset.uuid || target.getAttribute("data-uuid");
    if (!uuid || !/^Scene\.[^.]+$/.test(uuid)) return;  // Only proceed if UUID is a top-level Scene

    // Stop Foundry's default entity-link handler from opening the sheet
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
	
    try {
      const scene = await fromUuid(uuid);
      if (!scene || scene.documentName !== "Scene") {
        ui.notifications.warn(`Not a valid Scene: ${uuid}`);
        return;
      }

      await scene.activate();
      debugLog(`✅ Activated scene: ${scene.name}`);
    } catch (err) {
      console.error("Scene activation error:", err);
      ui.notifications.error("Could not activate the scene.");
    }
  }, { capture: true }); // <-- important
});

// Toggles Tile visibility via UUID links
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  document.body.addEventListener("click", async (event) => {
    const anchor = event.target.closest("a.content-link");
    if (!anchor) return;

    const uuid = anchor.dataset.uuid;
    const label = anchor.textContent?.trim();

    // Only handle links labeled "Toggle" and pointing to a Tile
    if (!uuid || label !== "Toggle") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const doc = await fromUuid(uuid);
      if (!(doc instanceof TileDocument)) {
        ui.notifications.warn("This UUID does not reference a tile.");
        return;
      }

      const tile = canvas.tiles.get(doc.id);
      if (!tile) throw new Error("Tile object not found on canvas");

      const isHidden = doc.hidden ?? false;

      if (isHidden) {
        // Make tile visible, then fade in
        await doc.update({ hidden: false });

        tile.alpha = 0;
        const fadeIn = () => {
          let opacity = 0;
          const step = 0.05;
          const interval = setInterval(() => {
            opacity += step;
            tile.alpha = Math.min(opacity, 1);
            if (opacity >= 1) clearInterval(interval);
          }, 16); // ~60fps
        };
        fadeIn();
      } else {
        // Fade out, then hide the tile
        const fadeOut = () => {
          let opacity = tile.alpha ?? 1;
          const step = 0.05;
          const interval = setInterval(() => {
            opacity -= step;
            tile.alpha = Math.max(opacity, 0);
            if (opacity <= 0) {
              clearInterval(interval);
              doc.update({ hidden: true });
            }
          }, 16); // ~60fps
        };
        fadeOut();
      }
    } catch (err) {
      console.error("❌ Tile toggle error:", err);
      ui.notifications.error("Failed to toggle the tile.");
    }
  }, true); // capture phase
});

// Intercept playlist sound start
Hooks.once("ready", () => {
  debugLog("🎵 GM-only audio override active (v13)");

  // Patch Sound.play to only work for GM
  const _soundPlay = Sound.prototype.play;
  Sound.prototype.play = function (...args) {
    if (!shouldBlockClientAudio()) {
      debugLog("🎵 GM hears sound:", this.path || this.data?.path);
      return _soundPlay.apply(this, args);
    } else {
      debugLog("🚫 Blocked sound for player/monitor:", this.path || this.data?.path);
      return null;
    }
  };

  // Patch PlaylistSound.play too
  if (globalThis.PlaylistSound) {
    const _psPlay = PlaylistSound.prototype.play;
    PlaylistSound.prototype.play = function (...args) {
      if (!shouldBlockClientAudio()) {
        debugLog("🎵 GM hears playlist:", this.path || this.data?.path);
        return _psPlay.apply(this, args);
      } else {
        debugLog("🚫 Blocked playlist sound for player/monitor:", this.path || this.data?.path);
        return null;
      }
    };
  }
});

// --- Enforce list view only (remove legacy detailed view toggle UI) ----------
(() => {
  const TOGGLE_CLS = "chips-view";

  function getRoot(el) {
    if (!el) return null;
    if (el instanceof HTMLElement) return el;
    return el?.[0] instanceof HTMLElement ? el[0] : null;
  }

  function enforceListView(_app, element) {
    const root = getRoot(element);
    if (!root) return;

    const form = (root.tagName === "FORM" ? root : root.querySelector("form"));
    if (!form) return;
    if (!form.classList.contains("dnd5e2")) return;

    form.classList.remove(TOGGLE_CLS);
    form.querySelectorAll(".chips-toggle-holder").forEach((node) => node.remove());
  }

  Hooks.on("renderActorSheet", enforceListView);
  Hooks.on("renderActorSheetV2", enforceListView);
})();

// ------------------ DPAD UI (players) & GM CONTROLS (Floating Button V5) ------------------

debugLog("✅ DPAD Script Loaded (Floating Button Method)");

// 1. GM TOGGLE BUTTON (Standalone Floating UI)
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  // Create the button element
  const toggleBtn = document.createElement("div");
  toggleBtn.id = "dpad-gm-toggle";
  
  // Style it to float in the bottom-left (above the players list or macros)
  Object.assign(toggleBtn.style, {
    position: "fixed",
    bottom: "120px",
    left: "20px",
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: "#222",
    border: "2px solid #555",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 0 10px rgba(0,0,0,0.5)",
    zIndex: "10000",
    fontSize: "20px",
    transition: "all 0.2s ease"
  });

  // Icon element
  const icon = document.createElement("i");
  toggleBtn.appendChild(icon);
  document.body.appendChild(toggleBtn);

  // Function to update visual state
  const updateVisuals = () => {
    const isEnabled = game.user.getFlag("world", "dpadEnabled") ?? true;
    if (isEnabled) {
      icon.className = "fas fa-mobile-alt";
      toggleBtn.style.borderColor = "#00FF00"; // Green border
      toggleBtn.style.color = "#00FF00";
      toggleBtn.title = "Player Controls: ON (Click to Disable)";
    } else {
      icon.className = "fas fa-mobile"; // or fa-ban
      toggleBtn.style.borderColor = "#FF0000"; // Red border
      toggleBtn.style.color = "#FF0000";
      toggleBtn.title = "Player Controls: OFF (Click to Enable)";
    }
  };

  // Initial render
  updateVisuals();
  emitPlayerControlsStateFromGm();
  setTimeout(emitPlayerControlsStateFromGm, 400);

  // Click Handler
  toggleBtn.addEventListener("click", async () => {
    const current = game.user.getFlag("world", "dpadEnabled") ?? true;
    const newState = !current;
    
    await game.user.setFlag("world", "dpadEnabled", newState);
    await game.user.setFlag("world", "dpadRefreshAt", Date.now());
    emitPlayerControlsStateFromGm();
    updateVisuals();

    if (newState) ui.notifications.info("Player Controls: Enabled");
    else ui.notifications.warn("Player Controls: Disabled");
  });
});

Hooks.on("userConnected", () => {
  if (!game.user?.isGM) return;
  setTimeout(emitPlayerControlsStateFromGm, 250);
  setTimeout(emitPlayerControlsStateFromGm, 1000);
});

// 2. PLAYER UI INJECTION
function injectSheetDpad(app, element) {
  try {
    if (game.user?.isGM) return;

    const actor = app?.actor ?? null;
    if (actor && actor.type !== "character") return;

    const root = (element instanceof HTMLElement) ? element : (element?.[0] instanceof HTMLElement) ? element[0] : null;
    if (!root) return;

    const form = (root.tagName === "FORM") ? root : root.querySelector("form") || root.closest("form");
    const scope = form ?? root;
    if (!scope?.matches?.(SS_SHEET_FORM_SELECTOR)) return;

    if (!document.getElementById("dpad-mobile-styles")) {
      const style = document.createElement("style");
      style.id = "dpad-mobile-styles";
      style.textContent = `
        form.sheet-sidekick-sheet .ss-dpad-fs-overlay,
        form.ss-sheet .ss-dpad-fs-overlay {
          position: fixed; inset: 0; z-index: 999999;
          display: none; grid-template-columns: 84px 84px 84px; grid-template-rows: 84px 84px 84px;
          place-content: center; gap: 10px; padding: 16px;
          background: rgba(6,10,14,.74); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          user-select: none; pointer-events: auto;
        }
        form.sheet-sidekick-sheet.ss-dpad-fs-open .ss-dpad-fs-overlay,
        form.ss-sheet.ss-dpad-fs-open .ss-dpad-fs-overlay { display: grid; }
        form.sheet-sidekick-sheet .ss-dpad-fs-overlay button,
        form.ss-sheet .ss-dpad-fs-overlay button {
          border-radius: 14px; border: 1px solid rgba(255,255,255,.25);
          background: rgba(30,30,30,.78); color: #fff;
          font-size: 28px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          touch-action: none; -webkit-tap-highlight-color: transparent;
        }
        form.sheet-sidekick-sheet .ss-dpad-fs-overlay button i,
        form.ss-sheet .ss-dpad-fs-overlay button i { pointer-events: none; font-size: 1.05em; line-height: 1; }
        form.sheet-sidekick-sheet .ss-dpad-fs-overlay button:active,
        form.ss-sheet .ss-dpad-fs-overlay button:active { transform: scale(0.98); filter: brightness(1.08); }
      `;
      document.head.appendChild(style);
    }

    const REPEAT_DELAY_MS = 250;
    const REPEAT_MS = 150;
    const MAX_STEPS = 20;
    let lastTurnLockNoticeAt = 0;

    const warnTurnLocked = (fallbackMessage = "You can move and target only on your turn.") => {
      const now = Date.now();
      if ((now - lastTurnLockNoticeAt) < 1200) return;
      lastTurnLockNoticeAt = now;
      ui.notifications?.warn?.(fallbackMessage);
    };

    function dispatchDpad(direction) {
      const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
        combat: getActiveCombatForViewedScene()
      });
      if (turnAccess.locked) {
        warnTurnLocked(turnAccess.message || "You cannot move until it is your turn.");
        return;
      }

      const ts = Date.now();
      const sent = sendCommandToGmSocket("ssDpad", {
        dir: direction,
        timestamp: ts,
        userId: game.user?.id ?? null
      });
      if (!sent) sendCommandToGmWhisper(`!dpad ${direction} ${ts}`);
    }

    function makeBtn(iconClass, ariaLabel, col, row, dir) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ss-dpad-dir-btn";
      b.dataset.ssDir = String(dir);
      b.dataset.ssBaseTitle = String(ariaLabel);
      b.setAttribute("aria-label", ariaLabel);
      b.setAttribute("title", ariaLabel);
      b.innerHTML = `<i class="fa-solid ${iconClass}" aria-hidden="true"></i>`;
      b.style.gridColumn = String(col);
      b.style.gridRow = String(row);

      let interval = null;
      let delay = null;
      let stepCount = 0;

      const fire = () => {
        stepCount++;
        if (stepCount > MAX_STEPS) {
          stop();
          return;
        }
        dispatchDpad(dir);
      };

      const stop = () => {
        if (delay) window.clearTimeout(delay);
        if (interval) window.clearInterval(interval);
        delay = null;
        interval = null;
        stepCount = 0;
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };

      const start = (ev) => {
        ev.preventDefault();
        if (ev.pointerType === "mouse" && ev.buttons !== 1) return;
        if (interval || delay) return;
        fire();
        window.addEventListener("pointerup", stop, { once: true });
        window.addEventListener("pointercancel", stop, { once: true });
        delay = window.setTimeout(() => {
          interval = window.setInterval(fire, REPEAT_MS);
        }, REPEAT_DELAY_MS);
      };

      b.addEventListener("pointerdown", start);
      b.addEventListener("pointerleave", stop);
      return b;
    }

    let overlay = scope.querySelector(".ss-dpad-fs-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "ss-dpad-fs-overlay";
      overlay.appendChild(makeBtn("fa-chevron-up", "Move Up", 2, 1, "up"));
      overlay.appendChild(makeBtn("fa-chevron-left", "Move Left", 1, 2, "left"));
      overlay.appendChild(makeBtn("fa-chevron-right", "Move Right", 3, 2, "right"));
      overlay.appendChild(makeBtn("fa-chevron-down", "Move Down", 2, 3, "down"));
      const mount = scope.querySelector(".window-content") ?? scope;
      mount.appendChild(overlay);
    }
    let dpadLockNote = overlay.querySelector(".ss-dpad-lock-note");
    if (!dpadLockNote) {
      dpadLockNote = document.createElement("div");
      dpadLockNote.className = "ss-dpad-lock-note";
      dpadLockNote.setAttribute("aria-live", "polite");
      dpadLockNote.hidden = true;
      overlay.appendChild(dpadLockNote);
    }

    let targetOverlay = scope.querySelector(".ss-target-panel-overlay");
    if (!targetOverlay) {
      targetOverlay = document.createElement("div");
      targetOverlay.className = "ss-target-panel-overlay";
      targetOverlay.innerHTML = `
        <section class="ss-target-panel" role="dialog" aria-label="Combat Targets">
          <header class="ss-target-panel-header">Combat Targets</header>
          <p class="ss-target-status">No active combat.</p>
          <div class="ss-target-list"></div>
          <footer class="ss-target-actions">
            <button type="button" class="ss-target-apply">Apply Targets</button>
            <button type="button" class="ss-target-close">Close</button>
          </footer>
        </section>
      `;
      const mount = scope.querySelector(".window-content") ?? scope;
      mount.appendChild(targetOverlay);
    }

    const targetList = targetOverlay.querySelector(".ss-target-list");
    const targetStatus = targetOverlay.querySelector(".ss-target-status");
    const targetPanel = targetOverlay.querySelector(".ss-target-panel");
    const applyTargetsBtn = targetOverlay.querySelector(".ss-target-apply");
    const closeTargetsBtn = targetOverlay.querySelector(".ss-target-close");

    const getCurrentSceneId = () => {
      return game.combat?.scene?.id
        ?? game.combat?.sceneId
        ?? game.scenes?.viewed?.id
        ?? "";
    };

    const getTargetRows = () => {
      const combat = getActiveCombatForViewedScene();
      if (!combat) return { sceneId: null, rows: [], reason: "No active combat in this scene." };

      const sceneId = combat.scene?.id ?? combat.sceneId ?? game.scenes?.viewed?.id ?? "";
      const rows = [];
      const combatants = Array.from(combat.combatants?.contents ?? combat.combatants ?? []);

      for (const combatant of combatants) {
        const tokenDoc = combatant.token ?? null;
        if (!tokenDoc?.id) continue;
        if (tokenDoc.hidden) continue;

        rows.push({
          tokenId: tokenDoc.id,
          name: tokenDoc.name ?? combatant.name ?? "Unknown",
          img: tokenDoc.texture?.src ?? combatant.img ?? combatant.actor?.img ?? ""
        });
      }

      if (!rows.length) return { sceneId, rows, reason: "No visible combatants." };
      return { sceneId, rows, reason: "" };
    };

    const getSelectedTargetIds = () => {
      return Array.from(targetList?.querySelectorAll?.(".ss-target-check:checked") ?? [])
        .map((el) => el.value)
        .filter(Boolean);
    };

    const syncTargetListScrollCue = () => {
      if (!(targetList instanceof HTMLElement)) return;
      const hasOverflow = (targetList.scrollHeight - targetList.clientHeight) > 6;
      const nearBottom = (targetList.scrollTop + targetList.clientHeight) >= (targetList.scrollHeight - 6);
      targetList.classList.toggle("ss-has-overflow", hasOverflow);
      targetList.classList.toggle("ss-scroll-end", !hasOverflow || nearBottom);
    };

    const renderTargetPanel = () => {
      if (!targetList || !targetStatus || !applyTargetsBtn) return;

      const selected = new Set((targetOverlay.dataset.ssSelectedTokens ?? "")
        .split(",")
        .filter(Boolean));
      const { sceneId, rows, reason } = getTargetRows();
      const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
        combat: getActiveCombatForViewedScene()
      });
      const targetLocked = !!turnAccess.locked;

      targetOverlay.dataset.ssSceneId = sceneId ?? "";
      targetList.innerHTML = "";
      targetStatus.classList.remove("ss-turn-locked");
      targetPanel?.classList.remove("ss-turn-locked");
      applyTargetsBtn.classList.remove("ss-turn-locked");

      if (!rows.length) {
        targetStatus.textContent = reason || "No visible combatants.";
        applyTargetsBtn.disabled = true;
        applyTargetsBtn.title = "";
        requestAnimationFrame(syncTargetListScrollCue);
        return;
      }

      if (targetLocked) {
        targetStatus.classList.add("ss-turn-locked");
        targetPanel?.classList.add("ss-turn-locked");
        applyTargetsBtn.classList.add("ss-turn-locked");
        const currentName = escapeHtml(turnAccess.currentCombatantName || "another combatant");
        targetStatus.innerHTML = `It is currently <strong class="ss-target-turn-name">${currentName}'s turn</strong>. You can ping now, but you cannot apply targets until your turn.`;
      } else {
        targetStatus.textContent = "Select one or more combatants, then Apply Targets.";
      }
      rows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "ss-target-row";
        item.dataset.tokenId = row.tokenId;
        item.innerHTML = `
          <label class="ss-target-pick">
            <input type="checkbox" class="ss-target-check" value="${row.tokenId}" ${selected.has(row.tokenId) ? "checked" : ""} ${targetLocked ? "disabled" : ""}>
            <span class="ss-target-avatar"${row.img ? ` style="background-image:url('${row.img}')"` : ""}></span>
            <span class="ss-target-name">${row.name}</span>
          </label>
          <button type="button" class="ss-target-ping">Ping</button>
        `;
        targetList.appendChild(item);
      });

      applyTargetsBtn.disabled = targetLocked;
      applyTargetsBtn.title = targetLocked ? "You can target only on your turn." : "";
      requestAnimationFrame(syncTargetListScrollCue);
    };

    let bottomNavMeasureRaf = 0;
    let bottomNavMeasureTimeout = 0;
    let hasMeasuredBottomNavOffsets = false;
    let lastBottomNavPadPx = -1;
    let lastAbilityScoresBottomPx = -1;
    const getBottomNavLayoutFlags = () => {
      const scopeWidth = Math.round(scope.getBoundingClientRect?.().width || 0);
      const narrowPhoneLayout = Math.min(window.innerWidth || Number.MAX_SAFE_INTEGER, scopeWidth || Number.MAX_SAFE_INTEGER) <= 630;
      return { scopeWidth, narrowPhoneLayout };
    };

    const applyMeasuredBottomNavOffsets = () => {
      const { narrowPhoneLayout } = getBottomNavLayoutFlags();
      const stickyContainer = scope.querySelector(".window-content") ?? scope;
      const containerRect = stickyContainer.getBoundingClientRect?.() ?? scope.getBoundingClientRect();
      const navRect = tabsNav.getBoundingClientRect();
      const navHeight = Math.ceil(navRect?.height || 0);
      if (!navHeight) return;

      const navTopDistanceFromContainerBottom = Math.max(0, Math.ceil((containerRect?.bottom || 0) - (navRect?.top || 0)));
      const contentCushionPx = narrowPhoneLayout ? 0 : 6;
      const abilityGapPx = narrowPhoneLayout ? 0 : 6;
      const nextBottomNavPadPx = Math.max(0, navTopDistanceFromContainerBottom + contentCushionPx);
      const nextAbilityScoresBottomPx = Math.max(0, navTopDistanceFromContainerBottom + abilityGapPx);

      if (Math.abs(nextBottomNavPadPx - lastBottomNavPadPx) > 1) {
        scope.style.setProperty("--ss-bottom-nav-pad", `${nextBottomNavPadPx}px`, "important");
        lastBottomNavPadPx = nextBottomNavPadPx;
      }
      if (Math.abs(nextAbilityScoresBottomPx - lastAbilityScoresBottomPx) > 1) {
        scope.style.setProperty("--ss-ability-scores-bottom", `${nextAbilityScoresBottomPx}px`);
        lastAbilityScoresBottomPx = nextAbilityScoresBottomPx;
      }
      hasMeasuredBottomNavOffsets = true;
    };

    const queueMeasuredBottomNavOffsets = () => {
      if (bottomNavMeasureRaf) return;
      bottomNavMeasureRaf = requestAnimationFrame(() => {
        bottomNavMeasureRaf = 0;
        applyMeasuredBottomNavOffsets();
      });
    };

    const updateBottomNavLayout = (enabled, canTarget) => {
      tabsNav.style.setProperty("grid-template-columns", "repeat(2, minmax(0, 1fr))", "important");
      const { narrowPhoneLayout } = getBottomNavLayoutFlags();

      // Deterministic expected rows for quick fallback.
      const expectedCount = 4 + (enabled ? 1 : 0) + (canTarget ? 1 : 0);
      const rows = Math.max(2, Math.ceil(expectedCount / 2));
      const fallbackRowHeightRem = narrowPhoneLayout ? 2.72 : 3.05;
      const fallbackGapRem = narrowPhoneLayout ? 0.2 : 0.32;
      const fallbackChromeRem = narrowPhoneLayout ? 0.55 : 0.8;
      const fallbackRem = (rows * fallbackRowHeightRem) + ((rows - 1) * fallbackGapRem) + fallbackChromeRem;
      if (!hasMeasuredBottomNavOffsets) {
        scope.style.setProperty("--ss-bottom-nav-pad", `calc(${fallbackRem.toFixed(2)}rem + env(safe-area-inset-bottom, 0px))`);
        scope.style.setProperty(
          "--ss-ability-scores-bottom",
          `calc(${(fallbackRem + (narrowPhoneLayout ? 0.08 : 0.34)).toFixed(2)}rem + env(safe-area-inset-bottom, 0px))`
        );
      }

      // Then measure rendered nav height to avoid stale spacing after control toggles.
      queueMeasuredBottomNavOffsets();
      if (bottomNavMeasureTimeout) window.clearTimeout(bottomNavMeasureTimeout);
      bottomNavMeasureTimeout = window.setTimeout(() => {
        bottomNavMeasureTimeout = 0;
        applyMeasuredBottomNavOffsets();
      }, 50);
    };

    const navCandidates = Array.from(scope.querySelectorAll("nav.tabs-right, nav.tabs"));
    const tabsNav = navCandidates.find((el) => el.offsetParent !== null) ?? navCandidates[0] ?? null;
    if (!tabsNav) {
      if (!ssDpadNavObserverByForm.has(scope)) {
        const navObserver = new MutationObserver(() => {
          const navNow = scope.querySelector("nav.tabs-right, nav.tabs");
          if (!navNow) return;
          navObserver.disconnect();
          ssDpadNavObserverByForm.delete(scope);
          injectSheetDpad(app, scope);
        });
        navObserver.observe(scope, { childList: true, subtree: true });
        ssDpadNavObserverByForm.set(scope, navObserver);
      }
      return;
    } else if (ssDpadNavObserverByForm.has(scope)) {
      ssDpadNavObserverByForm.get(scope)?.disconnect();
      ssDpadNavObserverByForm.delete(scope);
    }

    if (ssDpadNavResizeObserverByForm.has(scope)) {
      ssDpadNavResizeObserverByForm.get(scope)?.disconnect?.();
      ssDpadNavResizeObserverByForm.delete(scope);
    }
    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        queueMeasuredBottomNavOffsets();
      });
      resizeObserver.observe(tabsNav);
      resizeObserver.observe(scope);
      ssDpadNavResizeObserverByForm.set(scope, resizeObserver);
    }

    let dpadTab = tabsNav.querySelector(".ss-dpad-fs-toggle");
    if (!dpadTab) {
      dpadTab = document.createElement("a");
      dpadTab.href = "#";
      dpadTab.className = "item control ss-dpad-fs-toggle";
      dpadTab.setAttribute("aria-label", "Gamepad");
      dpadTab.setAttribute("title", "Toggle Gamepad");
      dpadTab.innerHTML = `<i class="fa-solid fa-gamepad" inert></i><span class="ss-tab-label">Gamepad</span>`;
      tabsNav.appendChild(dpadTab);
    }

    let targetTab = tabsNav.querySelector(".ss-target-fs-toggle");
    if (!targetTab) {
      targetTab = document.createElement("a");
      targetTab.href = "#";
      targetTab.className = "item control ss-target-fs-toggle";
      targetTab.setAttribute("aria-label", "Targets");
      targetTab.setAttribute("title", "Combat Targets");
      targetTab.innerHTML = `<i class="fa-solid fa-crosshairs" inert></i><span class="ss-tab-label">Targets</span>`;
      tabsNav.appendChild(targetTab);
    }

    decorateSheetSidekickTabs(scope);

    const baseTabSet = new Set(["details", "inventory", "features", "spells"]);
    const enforceBottomNavVisibility = (enabled, canTarget) => {
      tabsNav.querySelectorAll("a.item.control").forEach((el) => {
        const dataTab = String(el.dataset?.tab ?? "");
        const isBase = baseTabSet.has(dataTab);
        const isDpad = el === dpadTab || el.classList.contains("ss-dpad-fs-toggle");
        const isTarget = el === targetTab || el.classList.contains("ss-target-fs-toggle");
        const visible = isBase || (isDpad && enabled) || (isTarget && canTarget);
        if (visible) el.style.removeProperty("display");
        else el.style.setProperty("display", "none", "important");
      });
    };

    const sync = () => {
      const blockedTabs = ["effects", "biography", "specialTraits"];
      tabsNav.querySelectorAll(blockedTabs.map((t) => `a[data-tab='${t}']`).join(","))
        .forEach((el) => el.remove());

      const enabled = isDpadEnabledByGm();
      const canTarget = enabled && !!getActiveCombatForViewedScene();
      if (!enabled) {
        scope.classList.remove("ss-dpad-fs-open");
      }
      if (!canTarget) {
        scope.classList.remove("ss-target-panel-open");
      }
      scope.classList.toggle("ss-dpad-available", enabled);
      scope.classList.toggle("ss-target-available", canTarget);
      dpadTab.classList.toggle("ss-dpad-hidden", !enabled);
      targetTab.classList.toggle("ss-dpad-hidden", !canTarget);

      const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
        combat: getActiveCombatForViewedScene()
      });
      const dpadTurnLocked = !!(enabled && turnAccess.locked);
      overlay.classList.toggle("ss-turn-locked", dpadTurnLocked);
      dpadLockNote.hidden = !dpadTurnLocked;
      if (dpadTurnLocked) {
        const currentName = escapeHtml(turnAccess.currentCombatantName || "another combatant");
        dpadLockNote.innerHTML = `
          <div class="ss-dpad-lock-title">Movement Locked</div>
          <div class="ss-dpad-lock-text">Please wait for your turn.</div>
        `;
      } else {
        dpadLockNote.textContent = "";
      }
      overlay.querySelectorAll(".ss-dpad-dir-btn").forEach((btn) => {
        if (!(btn instanceof HTMLButtonElement)) return;
        btn.disabled = dpadTurnLocked;
        btn.classList.toggle("ss-turn-locked", dpadTurnLocked);
        const baseTitle = String(btn.dataset.ssBaseTitle ?? btn.getAttribute("aria-label") ?? "Move");
        btn.setAttribute("title", dpadTurnLocked ? `${baseTitle} (Wait for your turn)` : baseTitle);
      });

      dpadTab.classList.remove("active");
      targetTab.classList.remove("active");
      dpadTab.setAttribute("aria-pressed", String(enabled && scope.classList.contains("ss-dpad-fs-open")));
      targetTab.setAttribute("aria-pressed", String(canTarget && scope.classList.contains("ss-target-panel-open")));
      if (canTarget && scope.classList.contains("ss-target-panel-open")) renderTargetPanel();
      enforceBottomNavVisibility(enabled, canTarget);

      const hasVisibleControlTab = !dpadTab.classList.contains("ss-dpad-hidden")
        || !targetTab.classList.contains("ss-dpad-hidden");
      scope.classList.toggle("ss-dpad-available", hasVisibleControlTab);
      updateBottomNavLayout(enabled, canTarget);
      queueMeasuredBottomNavOffsets();
    };

    if (dpadTab.dataset.ssBound !== "1") {
      dpadTab.dataset.ssBound = "1";
      dpadTab.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        scope.classList.remove("ss-target-panel-open");
        scope.classList.toggle("ss-dpad-fs-open");
        sync();
      });
    }

    if (targetTab.dataset.ssBound !== "1") {
      targetTab.dataset.ssBound = "1";
      targetTab.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (targetTab.classList.contains("ss-dpad-hidden")) return;
        const nextOpen = !scope.classList.contains("ss-target-panel-open");
        scope.classList.remove("ss-dpad-fs-open");
        if (nextOpen) renderTargetPanel();
        scope.classList.toggle("ss-target-panel-open", nextOpen);
        sync();
      });
    }

    if (tabsNav.dataset.ssDpadCloseBound !== "1") {
      tabsNav.dataset.ssDpadCloseBound = "1";
      tabsNav.addEventListener("click", (ev) => {
        const tab = ev.target?.closest?.("a.item, a.control");
        if (!tab) return;
        if (tab.classList.contains("ss-dpad-fs-toggle")) return;
        if (tab.classList.contains("ss-target-fs-toggle")) return;
        scope.classList.remove("ss-dpad-fs-open");
        scope.classList.remove("ss-target-panel-open");
        sync();
      });
    }

    if (overlay.dataset.ssBound !== "1") {
      overlay.dataset.ssBound = "1";
      overlay.addEventListener("click", (ev) => {
        if (ev.target !== overlay) return;
        scope.classList.remove("ss-dpad-fs-open");
        sync();
      });
    }

    if (targetOverlay.dataset.ssBound !== "1") {
      targetOverlay.dataset.ssBound = "1";

      targetOverlay.addEventListener("click", (ev) => {
        if (ev.target !== targetOverlay) return;
        scope.classList.remove("ss-target-panel-open");
        sync();
      });

      targetList?.addEventListener("click", (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const pingBtn = target.closest(".ss-target-ping");
        if (!pingBtn) return;

        const row = pingBtn.closest(".ss-target-row");
        const tokenId = row?.dataset?.tokenId;
        const sceneId = targetOverlay.dataset.ssSceneId || getCurrentSceneId();
        if (!tokenId || !sceneId) return;

        const ts = Date.now();
        const sent = sendCommandToGmSocket("ssTarget", {
          mode: "ping",
          sceneId,
          payload: tokenId,
          timestamp: ts,
          userId: game.user?.id ?? null
        });
        if (!sent) {
          sendCommandToGmWhisper(`!ss-target ping ${sceneId} ${tokenId} ${ts} ${game.user.id}`, { includeSelf: true });
        }
      });

      targetList?.addEventListener("change", () => {
        targetOverlay.dataset.ssSelectedTokens = getSelectedTargetIds().join(",");
      });
      targetList?.addEventListener("scroll", () => {
        syncTargetListScrollCue();
      }, { passive: true });

      closeTargetsBtn?.addEventListener("click", () => {
        scope.classList.remove("ss-target-panel-open");
        sync();
      });

      applyTargetsBtn?.addEventListener("click", () => {
        const sceneId = targetOverlay.dataset.ssSceneId || getCurrentSceneId();
        if (!sceneId) return;
        const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
          combat: getActiveCombatForViewedScene()
        });
        if (turnAccess.locked) {
          warnTurnLocked(turnAccess.message || "You cannot target until it is your turn.");
          renderTargetPanel();
          return;
        }
        const tokenIds = getSelectedTargetIds();
        targetOverlay.dataset.ssSelectedTokens = tokenIds.join(",");

        const payload = tokenIds.length ? tokenIds.join(",") : "-";
        const ts = Date.now();
        const sent = sendCommandToGmSocket("ssTarget", {
          mode: "set",
          sceneId,
          payload,
          timestamp: ts,
          userId: game.user?.id ?? null
        });
        if (!sent) {
          sendCommandToGmWhisper(`!ss-target set ${sceneId} ${payload} ${ts} ${game.user.id}`, { includeSelf: true });
        }
      });
    }

    sync();
    app.once?.("close", () => {
      overlay.remove();
      targetOverlay?.remove();
      if (ssDpadNavObserverByForm.has(scope)) {
        ssDpadNavObserverByForm.get(scope)?.disconnect();
        ssDpadNavObserverByForm.delete(scope);
      }
      if (bottomNavMeasureRaf) {
        cancelAnimationFrame(bottomNavMeasureRaf);
        bottomNavMeasureRaf = 0;
      }
      if (bottomNavMeasureTimeout) {
        window.clearTimeout(bottomNavMeasureTimeout);
        bottomNavMeasureTimeout = 0;
      }
      if (ssDpadNavResizeObserverByForm.has(scope)) {
        ssDpadNavResizeObserverByForm.get(scope)?.disconnect?.();
        ssDpadNavResizeObserverByForm.delete(scope);
      }
    });
  } catch (e) {
    console.error("DPAD inject error:", e);
  }
}

Hooks.on("renderActorSheetV2", injectSheetDpad);
Hooks.on("renderActorSheet", injectSheetDpad);
globalThis.ssInjectSheetDpad = injectSheetDpad;

Hooks.on("pauseGame", (...args) => {
  if (game.user?.isGM) return;
  const pausedArg = args.find((a) => typeof a === "boolean");
  syncPlayerPauseBanner((typeof pausedArg === "boolean") ? pausedArg : !!game.paused);
});

function refreshSheetSidekickForms() {
  if (game.user?.isGM) return;
  const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
  const enabled = isDpadEnabledByGm();
  forms.forEach((form) => {
    if (!enabled) {
      form.classList.remove("ss-dpad-available");
      form.classList.remove("ss-dpad-fs-open");
      form.classList.remove("ss-target-available");
      form.classList.remove("ss-target-panel-open");
      form.style.setProperty("--ss-bottom-nav-pad", "calc(6.2rem + env(safe-area-inset-bottom, 0px))");
      const nav = form.querySelector("nav.tabs-right, nav.tabs");
      nav?.style?.setProperty?.("grid-template-columns", "repeat(2, minmax(0, 1fr))", "important");
    }

    try {
      injectSheetDpad({ actor: null, once: () => {} }, form);
    } catch (_err) {
      // noop
    }
  });
}
globalThis.ssRefreshSheetSidekickForms = refreshSheetSidekickForms;

function queueSheetSidekickFormRefresh(delayMs = 120) {
  if (game.user?.isGM) return;
  if (ssFormRefreshState.timer) window.clearTimeout(ssFormRefreshState.timer);
  ssFormRefreshState.timer = window.setTimeout(() => {
    ssFormRefreshState.timer = null;
    refreshSheetSidekickForms();
  }, delayMs);
}
globalThis.ssQueueSheetSidekickFormRefresh = queueSheetSidekickFormRefresh;

// Fallback for clients where sheet nav renders after hooks (common on mobile Safari).
Hooks.on("ready", () => {
  if (game.user?.isGM) return;
  setDpadEnabledOverride(isDpadEnabledByGm());
  syncPlayerPauseBanner(!!game.paused);

  const run = () => {
    const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
    forms.forEach((form) => injectSheetDpad({ actor: null, once: () => {} }, form));
  };

  run();
  setTimeout(run, 250);
  setTimeout(run, 900);

  if (!globalThis.__SS_DPAD_FORM_OBSERVER__) {
    let queued = false;
    const queueRun = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        run();
      }, 120);
    };
    const obs = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        if (m.type !== "childList") return false;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        return nodes.some((n) => {
          if (!(n instanceof HTMLElement)) return false;
          if (n.matches?.(SS_SHEET_FORM_SELECTOR)) return true;
          return !!n.querySelector?.(SS_SHEET_FORM_SELECTOR);
        });
      });
      if (!relevant) return;
      queueRun();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    globalThis.__SS_DPAD_FORM_OBSERVER__ = obs;
  }

  if (!globalThis.__SS_DPAD_FLAG_POLL__) {
    let last = null;
    globalThis.__SS_DPAD_FLAG_POLL__ = window.setInterval(() => {
      if (game.user?.isGM) return;
      const next = isDpadEnabledByGm();
      if (last === null) {
        last = next;
        setDpadEnabledOverride(next);
        refreshSheetSidekickForms();
        queueSheetSidekickFormRefresh(160);
        return;
      }
      if (next === last) return;
      last = next;
      setDpadEnabledOverride(next);
      refreshSheetSidekickForms();
    }, 1500);
  }
});

// React to GM toggling DPAD and/or refresh ping by re-injecting and rerendering Sheet Sidekick forms.
Hooks.on("updateUser", (user, changed) => {
  if (game.user?.isGM) return;
  if (!user?.isGM) return;

  const toggled = foundry.utils.hasProperty(changed, "flags.world.dpadEnabled");
  const refreshAt = foundry.utils.getProperty(changed, "flags.world.dpadRefreshAt");
  if (!toggled && !refreshAt) return;
  if (toggled) {
    const next = foundry.utils.getProperty(changed, "flags.world.dpadEnabled");
    if (typeof next === "boolean") {
      setDpadEnabledOverride(next);
      if (!next) {
        document.querySelectorAll(SS_SHEET_FORM_SELECTOR).forEach((form) => {
          form.classList.remove("ss-dpad-available");
          form.classList.remove("ss-target-available");
          form.classList.remove("ss-dpad-fs-open");
          form.classList.remove("ss-target-panel-open");
          form.style.setProperty("--ss-bottom-nav-pad", "calc(6.2rem + env(safe-area-inset-bottom, 0px))");
          const nav = form.querySelector("nav.tabs-right, nav.tabs");
          nav?.style?.setProperty?.("grid-template-columns", "repeat(2, minmax(0, 1fr))", "important");
        });
      }
    }
  }

  refreshSheetSidekickForms();
  queueSheetSidekickFormRefresh(180);
});

Hooks.on("createCombat", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh();
});
Hooks.on("deleteCombat", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh();
});
Hooks.on("combatStart", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh();
});
Hooks.on("combatEnd", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh();
});
Hooks.on("updateCombat", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh();
});

async function executeSsTargetCommand({ mode, sceneId, payload, timestamp, userId }) {
  if (!game.user?.isGM) return;
  if (!mode) return;
  if (Number.isFinite(timestamp) && (Date.now() - timestamp > 20000)) return;

  const combat = game.combat;
  if (!combat || !(combat.combatants?.size > 0)) return;
  const combatSceneId = combat.scene?.id ?? combat.sceneId ?? null;
  const effectiveSceneId = sceneId || combatSceneId || game.scenes?.viewed?.id || null;
  const sceneDoc = effectiveSceneId ? game.scenes?.get?.(effectiveSceneId) ?? null : null;

  const getCombatTokenDoc = (tokenId) => {
    const combatant = combat.combatants.find((c) => c.tokenId === tokenId);
    if (combatant?.token) return combatant.token;
    if (sceneDoc?.tokens?.get) return sceneDoc.tokens.get(tokenId) ?? null;
    return null;
  };

  const isTargetableCombatToken = (tokenId) => {
    const tokenDoc = getCombatTokenDoc(tokenId);
    if (!tokenDoc?.id) return false;
    if (tokenDoc.hidden) return false;
    return true;
  };

  if (mode === "ping") {
    const tokenId = payload;
    if (!tokenId || !isTargetableCombatToken(tokenId)) return;

    const token = canvas?.tokens?.get(tokenId) ?? null;
    if (!token || !canvas?.ready) return;

    const x = token.center?.x ?? (token.document.x + ((token.w ?? canvas.grid.size) / 2));
    const y = token.center?.y ?? (token.document.y + ((token.h ?? canvas.grid.size) / 2));

    try { canvas.ping?.({ x, y }); } catch (_err) { /* noop */ }
    try { canvas.controls?.drawPing?.({ x, y }, { scene: sceneId, user: game.user.id }); } catch (_err) { /* noop */ }
    try { canvas.animatePan?.({ x, y, duration: 350 }); } catch (_err) { /* noop */ }
    return;
  }

  if (mode === "set") {
    const targetUserId = String(userId ?? "");
    if (!targetUserId) return;
    if (getCombatTurnAccessForUser(targetUserId, { combat }).locked) return;

    const requested = (payload === "-" ? [] : String(payload).split(",").filter(Boolean));
    const tokenIds = requested.filter((id) => isTargetableCombatToken(id));
    setProxyTargetsForUser(targetUserId, effectiveSceneId, tokenIds);

    try {
      // Immediate GM-side proxy targeting so no player canvas is required.
      const viewedSceneId = game.scenes?.viewed?.id ?? null;
      if (!effectiveSceneId || !viewedSceneId || viewedSceneId === effectiveSceneId) {
        applyTargetsForCurrentGmUser(tokenIds);
      }
    } catch (err) {
      console.warn("Target apply failed:", err);
    }
  }
}

Hooks.once("ready", () => {
  if (globalThis.__SS_CUSTOM_JS_SOCKET_BOUND__) return;
  globalThis.__SS_CUSTOM_JS_SOCKET_BOUND__ = true;

  game.socket?.on?.("module.custom-js", async (data) => {
    if (!data || typeof data !== "object") return;

    if (data.type === "ssControls" && !game.user?.isGM) {
      const enabled = !!data.enabled;
      setDpadEnabledOverride(enabled);
      refreshSheetSidekickForms();
      queueSheetSidekickFormRefresh(180);
      return;
    }

    if (data.type === "ssDpad" && game.user?.isGM) {
      const exec = globalThis.__SS_EXECUTE_DPAD_COMMAND__;
      if (typeof exec === "function") {
        await exec({
          dir: String(data.dir ?? "").toLowerCase(),
          timestamp: Number.parseInt(data.timestamp, 10),
          userId: data.userId ?? null
        });
      } else if (typeof globalThis.__DPAD_CHAT_HOOK__ === "function") {
        await globalThis.__DPAD_CHAT_HOOK__({
          content: `!dpad ${String(data.dir ?? "").toLowerCase()} ${Number.parseInt(data.timestamp, 10)}`,
          author: { id: data.userId ?? null },
          user: { id: data.userId ?? null }
        });
      }
      return;
    }

    if (data.type === "ssUse" && game.user?.isGM) {
      const exec = globalThis.__SS_EXECUTE_USE_COMMAND__;
      if (typeof exec === "function") {
        await exec({
          actorId: data.actorId ?? "",
          itemId: data.itemId ?? "",
          timestamp: Number.parseInt(data.timestamp, 10),
          userId: data.userId ?? null,
          slotLevel: Number.parseInt(data.slotLevel, 10),
          ammoItemId: String(data.ammoItemId ?? "")
        });
      } else if (typeof globalThis.__SS_USE_CHAT_HOOK__ === "function") {
        const slotLevel = Number.parseInt(data.slotLevel, 10);
        const ammoItemId = String(data.ammoItemId ?? "").trim();
        const levelPart = Number.isFinite(slotLevel) && slotLevel > 0 ? String(slotLevel) : (ammoItemId ? "0" : "");
        const suffix = levelPart ? ` ${levelPart}` : "";
        const ammoSuffix = ammoItemId ? ` ${ammoItemId}` : "";
        await globalThis.__SS_USE_CHAT_HOOK__({
          content: `!ss-use ${data.actorId ?? ""} ${data.itemId ?? ""} ${Number.parseInt(data.timestamp, 10)}${suffix}${ammoSuffix}`,
          author: { id: data.userId ?? null },
          user: { id: data.userId ?? null }
        });
      }
      return;
    }

    if (data.type === "ssRoll" && game.user?.isGM) {
      const exec = globalThis.__SS_EXECUTE_ROLL_COMMAND__;
      if (typeof exec === "function") {
        await exec({
          actorId: data.actorId ?? "",
          rollKind: String(data.rollKind ?? ""),
          rollKey: String(data.rollKey ?? ""),
          rollLabel: String(data.rollLabel ?? ""),
          timestamp: Number.parseInt(data.timestamp, 10),
          userId: data.userId ?? null
        });
      } else if (typeof globalThis.__SS_ROLL_CHAT_HOOK__ === "function") {
        await globalThis.__SS_ROLL_CHAT_HOOK__({
          content: `!ss-roll ${data.actorId ?? ""} ${String(data.rollKind ?? "")} ${String(data.rollKey ?? "")} ${Number.parseInt(data.timestamp, 10)}`,
          author: { id: data.userId ?? null },
          user: { id: data.userId ?? null }
        });
      }
      return;
    }

    if (data.type === "ssTarget" && game.user?.isGM) {
      await executeSsTargetCommand({
        mode: String(data.mode ?? "").toLowerCase(),
        sceneId: data.sceneId ?? "",
        payload: data.payload ?? "",
        timestamp: Number.parseInt(data.timestamp, 10),
        userId: data.userId ?? null
      });
      return;
    }

    // no-op: target apply is handled via whisper chat command path
  });
});

// 2b. TAP-TO-CAST FOR SHEET-SIDEKICK PLAYERS (spells + features)
function bindTapToCast(app, element) {
  try {
    if (game.user?.isGM) return;
    if (!isSheetSidekickModuleActive()) return;

    const actor = app.actor;
    if (!actor || actor.type !== "character" || !actor.isOwner) return;

    const root = (element instanceof HTMLElement) ? element : (element?.[0] instanceof HTMLElement) ? element[0] : null;
    if (!root) return;

    const scope = (root.tagName === "FORM") ? root : (root.querySelector("form") ?? root);
    if (!scope) return;
    const alreadyBound = scope.dataset.ssTapCastBound === "1";
    if (!alreadyBound) scope.dataset.ssTapCastBound = "1";
    restoreSheetScroll(scope, actor);

    let decorateQueued = false;
    const queueDecorate = () => {
      if (decorateQueued) return;
      decorateQueued = true;
      requestAnimationFrame(() => {
        decorateQueued = false;
        decorateInfoButtons();
      });
    };

    const queueRestore = () => {
      requestAnimationFrame(() => restoreSheetScroll(scope, actor));
      setTimeout(() => restoreSheetScroll(scope, actor), 140);
    };
    const queueRehydrate = () => {
      queueDecorate();
      queueRestore();
      setTimeout(() => {
        queueDecorate();
        queueRestore();
      }, 120);
    };

    const decorateInfoButtons = () => {
      ensureActionFilterBars(scope, actor);
      scope.querySelectorAll("li.item[data-item-id]").forEach(row => {
        const itemId = row.dataset?.itemId;
        if (!itemId) return;

        const item = actor.items.get(itemId);
        const qtyInput = row.querySelector(".item-detail.item-quantity input[data-name='system.quantity']");
        if (qtyInput instanceof HTMLInputElement) {
          qtyInput.readOnly = true;
          qtyInput.setAttribute("aria-readonly", "true");
        }
        row.querySelectorAll(".item-detail.item-quantity .adjustment-button").forEach((btn) => {
          btn.setAttribute("aria-disabled", "true");
          btn.classList.add("disabled");
        });

        if (!isTapToUseItem(item)) return;

        const controls = row.querySelector(".item-controls");
        const additionalControls = controls?.querySelector("[data-context-menu]");
        if (additionalControls) {
          additionalControls.style.display = "none";
          additionalControls.removeAttribute("data-context-menu");
          additionalControls.removeAttribute("data-action");
        }

        // Keep native expand hidden; we replace it with an info button.
        const nativeToggle = row.querySelector("[data-action='toggleExpand'], button[data-toggle-description], button[aria-label='Toggle Description']");
        if (nativeToggle) {
          nativeToggle.classList.add("ss-native-toggle");
          nativeToggle.style.display = "none";
        }

        const nameAction = row.querySelector(".item-name.item-action[data-action], .item-name .item-action[data-action], h4.item-action[data-action], .item-name h4[data-action], .item-name");
        if (nameAction) {
          // Repurpose item name tap: always route spell/feature name taps through our confirmed use flow.
          if (nameAction.dataset.ssUsePatched !== "1") {
            if (!nameAction.dataset.ssOriginalAction) {
              nameAction.dataset.ssOriginalAction = nameAction.dataset.action ?? "";
            }
            nameAction.dataset.action = "ssUseItem";
            nameAction.dataset.ssUsePatched = "1";
            nameAction.style.cursor = "pointer";
          }
          nameAction.classList.remove("item-tooltip");
          delete nameAction.dataset.tooltip;
          delete nameAction.dataset.tooltipClass;
          delete nameAction.dataset.tooltipDirection;
        }

        let infoBtn = row.querySelector(".ss-tooltip-btn");
        if (!infoBtn) {
          infoBtn = document.createElement("button");
          infoBtn.type = "button";
          infoBtn.className = "ss-tooltip-btn";
          infoBtn.setAttribute("aria-label", "Show Details");
          infoBtn.style.marginLeft = "0.35rem";
          infoBtn.style.marginTop = "0";
          infoBtn.style.border = "1px solid var(--color-border-light-2, #666)";
          infoBtn.style.borderRadius = "4px";
          infoBtn.style.background = "rgba(0,0,0,0.15)";
          infoBtn.style.minWidth = "1.4rem";
          infoBtn.style.height = "1.4rem";
          infoBtn.style.lineHeight = "1";
          infoBtn.style.fontWeight = "700";
          infoBtn.style.color = "var(--color-text-primary, #ddd)";
          infoBtn.style.cursor = "pointer";
          infoBtn.dataset.action = "ssTooltip";
          infoBtn.innerHTML = `<i class="fa-solid fa-circle-info" inert></i>`;
        }
        infoBtn.classList.remove("item-tooltip");
        infoBtn.removeAttribute("title");
        infoBtn.dataset.uuid = item.uuid ?? row.dataset?.uuid ?? "";
        delete infoBtn.dataset.tooltip;
        delete infoBtn.dataset.tooltipClass;
        delete infoBtn.dataset.tooltipDirection;

        if (controls) {
          if (infoBtn.parentElement !== controls || infoBtn !== controls.lastElementChild) {
            controls.appendChild(infoBtn);
          }
        } else if (nameAction && infoBtn.previousElementSibling !== nameAction) {
          infoBtn.style.marginLeft = "0.35rem";
          nameAction.insertAdjacentElement("afterend", infoBtn);
        }
      });
      decorateSpellSlotPips(scope);
    };

    decorateInfoButtons();

    // On subsequent render hooks for the same scope, only refresh decorations.
    if (alreadyBound) return;

    const onContextMenu = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest("li.item, .items-list, .item-controls, .item-name, [data-context-menu]")) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    };
    scope.addEventListener("contextmenu", onContextMenu, true);

    let rehydrateTimer = null;
    const queueRehydrateDebounced = () => {
      if (rehydrateTimer) window.clearTimeout(rehydrateTimer);
      rehydrateTimer = window.setTimeout(() => {
        rehydrateTimer = null;
        queueRehydrate();
      }, 90);
    };

    const observer = new MutationObserver((mutations) => {
      // Re-decorate only when item-list structures change.
      const relevant = mutations.some((m) => {
        if (m.type !== "childList") return false;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        return nodes.some((n) => {
          if (!(n instanceof HTMLElement)) return false;
          if (n.matches?.("li.item, .items-list, .item-controls, .item-name")) return true;
          return !!n.querySelector?.("li.item, .items-list, .item-controls, .item-name");
        });
      });
      if (!relevant) return;
      queueRehydrateDebounced();
    });
    const observeRoot = scope.querySelector(".items-list, section[data-tab='spells'], section[data-tab='features'], section[data-tab='inventory']") ?? scope;
    observer.observe(observeRoot, {
      childList: true,
      subtree: true
    });

    const scrollEls = getSheetScrollElements(scope);
    let scrollQueued = false;
    const onScroll = () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        saveSheetScroll(scope, actor);
      });
    };
    scrollEls.forEach(el => el.addEventListener("scroll", onScroll, { passive: true }));

    let lastTapTs = 0;
    let confirmOpen = false;

    scope.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest(".item-action[data-action='prepare']")) {
        const prepareBtn = target.closest(".item-action[data-action='prepare']");
        if (prepareBtn instanceof HTMLElement) {
          prepareBtn.classList.add("ss-prepare-pending");
          const isPressed = prepareBtn.getAttribute("aria-pressed") === "true" || prepareBtn.classList.contains("active");
          prepareBtn.setAttribute("aria-pressed", String(!isPressed));
          prepareBtn.classList.toggle("active", !isPressed);
          setTimeout(() => prepareBtn.classList.remove("ss-prepare-pending"), 900);
        }
        saveSheetScroll(scope, actor);
        setTimeout(() => {
          queueDecorate();
          queueRestore();
        }, 50);
        return;
      }

      // Show rich item tooltip from dedicated info button.
      const tooltipBtn = target.closest(".ss-tooltip-btn");
      if (tooltipBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        const row = tooltipBtn.closest("li.item[data-item-id]");
        const itemId = row?.dataset?.itemId;
        const item = itemId ? actor.items.get(itemId) : null;
        await openLockedItemTooltipDialogFromButton(tooltipBtn, item?.name ?? "Item Details");
        queueRestore();
        return;
      }

      const filterBtn = target.closest(".ss-action-filter-btn");
      if (filterBtn instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        const tab = filterBtn.closest("section.tab[data-tab='spells'], section.tab[data-tab='features'], section.tab[data-tab='inventory']");
        if (filterBtn.classList.contains("ss-action-view-toggle")) {
          if (tab instanceof HTMLElement) {
            const current = getItemViewMode(tab);
            const next = (current === "grid") ? "list" : "grid";
            setItemViewMode(tab, next);
            updateActionFilterButtons(tab);
            applyActionFilterToTab(tab, actor);
            queueRestore();
          }
          return;
        }
        const group = String(filterBtn.dataset?.filterGroup ?? "action");
        let mode = String(filterBtn.dataset?.filterValue ?? "all");
        if (tab instanceof HTMLElement) {
          if (group === "prepared") {
            const current = getFilterMode(tab, "prepared");
            mode = (current === "prepared") ? "all" : "prepared";
          }
          setFilterMode(tab, group, mode);
          updateActionFilterButtons(tab);
          applyActionFilterToTab(tab, actor);
        }
        return;
      }

      const rollRequest = extractRollRequestFromElement(target, actor);
      if (rollRequest && !target.closest("li.item[data-item-id]")) {
        const tapTs = Date.now();
        if ((tapTs - lastTapTs) < 200) return;
        lastTapTs = tapTs;
        saveSheetScroll(scope, actor);
        queueRestore();

        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();

        if (confirmOpen) return;
        confirmOpen = true;
        const decision = await confirmTapToRoll(actor, rollRequest);
        confirmOpen = false;
        if (!decision?.confirmed) return;

        const commandTs = Date.now();
        sendRollInfoToGmWhisper(actor, rollRequest);
        const sent = sendCommandToGmSocket("ssRoll", {
          actorId: actor.id,
          rollKind: rollRequest.kind,
          rollKey: rollRequest.key,
          rollLabel: rollRequest.label,
          timestamp: commandTs,
          userId: game.user?.id ?? null
        });
        if (!sent) {
          sendCommandToGmWhisper(`!ss-roll ${actor.id} ${rollRequest.kind} ${rollRequest.key} ${commandTs}`);
        }
        return;
      }

      const nameTapTarget = target.closest(
        ".item-name[data-action='ssUseItem'], .item-name [data-action='ssUseItem'], h4[data-action='ssUseItem'], [data-action='ssUseItem']"
      );
      if (!nameTapTarget) return;

      const row = nameTapTarget.closest("li.item[data-item-id]");
      const itemId = row?.dataset?.itemId;
      if (!itemId) return;

      const item = actor.items.get(itemId);
      if (!isTapToUseItem(item)) return;

      const tapTs = Date.now();
      if ((tapTs - lastTapTs) < 200) return;
      lastTapTs = tapTs;
      saveSheetScroll(scope, actor);
      queueRestore();

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      if (confirmOpen) return;
      confirmOpen = true;
      const decision = await confirmTapToCast(item, actor);
      confirmOpen = false;
      if (!decision?.confirmed) return;

      const slotLevel = Number.parseInt(decision.slotLevel, 10);
      const hasSlotLevel = Number.isFinite(slotLevel) && slotLevel > 0;
      const ammoItemId = String(decision.ammoItemId ?? "").trim() || null;
      const commandTs = Date.now();
      sendUseInfoToGmWhisper(actor, item, hasSlotLevel ? slotLevel : null, ammoItemId);

      const sent = sendCommandToGmSocket("ssUse", {
        actorId: actor.id,
        itemId,
        timestamp: commandTs,
        userId: game.user?.id ?? null,
        slotLevel: hasSlotLevel ? slotLevel : null,
        ammoItemId
      });
      if (!sent) {
        const levelPart = hasSlotLevel ? String(slotLevel) : (ammoItemId ? "0" : "");
        const levelSuffix = levelPart ? ` ${levelPart}` : "";
        const ammoSuffix = ammoItemId ? ` ${ammoItemId}` : "";
        sendCommandToGmWhisper(`!ss-use ${actor.id} ${itemId} ${commandTs}${levelSuffix}${ammoSuffix}`);
      }
    }, { capture: true });

    app.once?.("close", () => {
      scrollEls.forEach(el => el.removeEventListener("scroll", onScroll));
      scope.removeEventListener("contextmenu", onContextMenu, true);
      if (rehydrateTimer) window.clearTimeout(rehydrateTimer);
      observer.disconnect();
    });
  } catch (e) {
    console.error("Tap-to-cast inject error:", e);
  }
}

Hooks.on("renderActorSheetV2", bindTapToCast);
Hooks.on("renderActorSheet", bindTapToCast);
Hooks.on("renderActorSheetV2", applySheetSidekickUiCleanup);
Hooks.on("renderActorSheet", applySheetSidekickUiCleanup);
Hooks.on("canvasReady", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh(80);
});
window.addEventListener("resize", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh(80);
});
Hooks.on("renderActorSheetV2", () => {
  startSheetSidekickUiEnsure(6000);
});
Hooks.on("renderActorSheet", () => {
  startSheetSidekickUiEnsure(6000);
});
Hooks.on("ready", () => {
  if (game.user?.isGM) return;
  startSheetSidekickUiEnsure(10000);

  if (!globalThis.__SS_UI_CLEANUP_FORM_OBSERVER__) {
    let queued = false;
    const queueRefresh = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        startSheetSidekickUiEnsure(6000);
      }, 120);
    };

    const obs = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => {
        if (m.type !== "childList") return false;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        return nodes.some((n) => {
          if (!(n instanceof HTMLElement)) return false;
          if (n.matches?.(SS_SHEET_FORM_SELECTOR)) return true;
          return !!n.querySelector?.(SS_SHEET_FORM_SELECTOR);
        });
      });
      if (!relevant) return;
      queueRefresh();
    });

    obs.observe(document.body, { childList: true, subtree: true });
    globalThis.__SS_UI_CLEANUP_FORM_OBSERVER__ = obs;
  }
});

// 3. GM EXECUTION LOGIC
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const COMMAND_PREFIX = "!dpad";

  function userOwnsTokenActor(userId, tokenDoc) {
    const actor = tokenDoc.actor;
    if (!actor) return false;
    const level = actor.ownership?.[userId] ?? 0;
    return level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }

  function pickTokenForUser(userId) {
    const scene = game.scenes.viewed;
    if (!scene) return null;
    const owned = scene.tokens.filter(td => userOwnsTokenActor(userId, td));
    if (!owned.length) return null;
    const pc = owned.find(td => td.actor?.type === "character");
    return pc ?? owned[0];
  }

  function snapAndClampTokenPosition(tokenDoc, nextX, nextY, gridSize) {
    const dims = canvas?.dimensions;
    if (!dims || !Number.isFinite(gridSize) || gridSize <= 0) {
      return { x: nextX, y: nextY };
    }

    const tokenW = (Number(tokenDoc.width ?? 1) || 1) * dims.size;
    const tokenH = (Number(tokenDoc.height ?? 1) || 1) * dims.size;
    const maxX = Math.max(0, dims.width - tokenW);
    const maxY = Math.max(0, dims.height - tokenH);

    let x = Number(nextX);
    let y = Number(nextY);
    if (!Number.isFinite(x)) x = Number(tokenDoc.x ?? 0);
    if (!Number.isFinite(y)) y = Number(tokenDoc.y ?? 0);

    // Simple snap on square-grid increments; avoid getSnappedPoint drift.
    x = Math.round(x / gridSize) * gridSize;
    y = Math.round(y / gridSize) * gridSize;

    x = Math.min(maxX, Math.max(0, x));
    y = Math.min(maxY, Math.max(0, y));
    return { x, y };
  }

  const executeDpadCommand = async ({ dir, timestamp, userId }) => {
    const isEnabled = game.user.getFlag("world", "dpadEnabled") ?? true;
    if (isEnabled === false) return;
    if (!canvas?.ready) return ui.notifications.warn("GM canvas not ready (view a scene).");

    // LAG PREVENTION: Drop commands older than 2s
    if (Number.isFinite(timestamp) && (Date.now() - timestamp > 2000)) {
      console.warn("Dropped old DPAD command due to lag:", Date.now() - timestamp, "ms");
      return;
    }

    if (!["up", "down", "left", "right"].includes(String(dir ?? "").toLowerCase())) return;
    if (!userId) return;
    if (getCombatTurnAccessForUser(userId, { combat: getActiveCombatForViewedScene() }).locked) return;

    const tokenDoc = pickTokenForUser(userId);
    if (!tokenDoc) return ui.notifications.warn("No owned token for that user in viewed scene.");

    const size = canvas.grid.size;
    const dx = (dir === "left" ? -1 : dir === "right" ? 1 : 0) * size;
    const dy = (dir === "up" ? -1 : dir === "down" ? 1 : 0) * size;

    const target = snapAndClampTokenPosition(tokenDoc, tokenDoc.x + dx, tokenDoc.y + dy, size);
    if (target.x === tokenDoc.x && target.y === tokenDoc.y) return;
    await tokenDoc.update(target);
  };
  globalThis.__SS_EXECUTE_DPAD_COMMAND__ = executeDpadCommand;

  if (globalThis.__DPAD_CHAT_HOOK__) Hooks.off("createChatMessage", globalThis.__DPAD_CHAT_HOOK__);

  globalThis.__DPAD_CHAT_HOOK__ = async (msg) => {
    const text = normalizeChatCommandText(msg.content);
    if (!text.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const parts = text.split(/\s+/);
    const dir = (parts[1] ?? "").toLowerCase();
    const timestamp = Number.parseInt(parts[2], 10);
    const userId = msg.author?.id ?? msg.user?.id;
    await executeDpadCommand({ dir, timestamp, userId });
  };

  Hooks.on("createChatMessage", globalThis.__DPAD_CHAT_HOOK__);
});

// 4. GM EXECUTION LOGIC FOR TAP-TO-CAST
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const COMMAND_PREFIX = "!ss-use";

  if (!globalThis.__SS_MIDI_CAST_LEVEL_HOOK__) {
    globalThis.__SS_MIDI_CAST_LEVEL_HOOK__ = (app, html) => applyPendingMidiCastLevel(app, html);
    Hooks.on("renderDialog", globalThis.__SS_MIDI_CAST_LEVEL_HOOK__);
  }

  const executeSsUseCommand = async ({ actorId, itemId, timestamp, userId, slotLevel = null, ammoItemId = null }) => {
    if (!actorId || !itemId) return;
    if (Number.isFinite(timestamp) && (Date.now() - timestamp > 20000)) return;
    if (!userId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.warn("Tap-to-cast actor not found.");

    const ownership = actor.ownership?.[userId] ?? 0;
    if (ownership < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
      return ui.notifications.warn("Player does not own that actor.");
    }
    if (getCombatTurnAccessForUser(userId, { combat: getActiveCombatForViewedScene() }).locked) {
      return ui.notifications.warn("You can use items only on your turn.");
    }

    const item = actor.items.get(itemId);
    if (!item) return ui.notifications.warn("Tap-to-cast item not found.");
    if (!isTapToUseItem(item)) return;

    try {
      const proxyTargets = getProxyTargetsForUser(userId);
      if (proxyTargets && canvas?.ready) {
        const viewedSceneId = game.scenes?.viewed?.id ?? null;
        const sameScene = !proxyTargets.sceneId || !viewedSceneId || proxyTargets.sceneId === viewedSceneId;
        if (sameScene) {
          applyTargetsForCurrentGmUser(proxyTargets.tokenIds ?? []);
        }
      }

      if (typeof item.use === "function") {
        const parsedLevel = Number.parseInt(slotLevel, 10);
        const baseLevel = Number(item.system?.level ?? 0);
        const castLevel = Number.isFinite(parsedLevel) && parsedLevel > 0
          ? parsedLevel
          : ((item.type === "spell" && Number.isFinite(baseLevel) && baseLevel > 0) ? baseLevel : null);

        if (item.type === "spell" && castLevel) {
          const slotChoices = getSpellSlotLevelChoices(actor, item);
          const choice = slotChoices.find((c) => Number(c.level) === Number(castLevel));
          const value = Number(choice?.value ?? 0);
          if (!choice || !Number.isFinite(value) || value <= 0) {
            return ui.notifications.warn("No spell slots left for that cast level.");
          }
        }

        const ammoInfo = getAmmoChoices(actor, item);
        let resolvedAmmoId = String(ammoItemId ?? "").trim();
        if (ammoInfo.required && !resolvedAmmoId) {
          resolvedAmmoId = String(ammoInfo.defaultId ?? "").trim();
        }
        if (ammoInfo.required && !resolvedAmmoId) {
          return ui.notifications.warn("No compatible ammo available.");
        }
        if (resolvedAmmoId) {
          const ammoItem = actor.items.get(resolvedAmmoId);
          const ammoQty = Number(ammoItem?.system?.quantity ?? ammoItem?.system?.uses?.value ?? 0);
          if (!ammoItem) {
            return ui.notifications.warn("Selected ammo not found.");
          }
          if (!Number.isFinite(ammoQty) || ammoQty <= 0) {
            return ui.notifications.warn(`No ${ammoItem.name} left.`);
          }
        }
        const useOptions = { legacy: false };
        if (item.type === "spell" && Number.isFinite(castLevel) && castLevel > 0) {
          queuePendingMidiCastLevel(item.name, castLevel);
          useOptions.level = castLevel;
          useOptions.spellLevel = castLevel;
          useOptions.slotLevel = castLevel;
          useOptions.castLevel = castLevel;
        }
        if (resolvedAmmoId) {
          useOptions.ammunition = resolvedAmmoId;
          useOptions.ammo = resolvedAmmoId;
        }
        await item.use(useOptions);
      } else if (typeof item.roll === "function") {
        await item.roll();
      } else {
        ui.notifications.info(`${actor.name} requested: ${item.name}`);
      }
    } catch (err) {
      console.error("Tap-to-cast execution error:", err);
      ui.notifications.error(`Failed to use ${item.name}.`);
    }
  };
  globalThis.__SS_EXECUTE_USE_COMMAND__ = executeSsUseCommand;

  if (globalThis.__SS_USE_CHAT_HOOK__) Hooks.off("createChatMessage", globalThis.__SS_USE_CHAT_HOOK__);

  globalThis.__SS_USE_CHAT_HOOK__ = async (msg) => {
    const text = normalizeChatCommandText(msg.content);
    if (!text.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const parts = text.split(/\s+/);
    const actorId = parts[1];
    const itemId = parts[2];
    const timestamp = Number.parseInt(parts[3], 10);
    const fourth = String(parts[4] ?? "").trim();
    const fifth = String(parts[5] ?? "").trim();
    let slotLevel = Number.parseInt(fourth, 10);
    let ammoItemId = "";
    if (fourth && (!Number.isFinite(slotLevel) || slotLevel <= 0)) {
      ammoItemId = fourth;
      slotLevel = NaN;
    } else if (fifth) {
      ammoItemId = fifth;
    }

    const userId = msg.author?.id ?? msg.user?.id;
    await executeSsUseCommand({ actorId, itemId, timestamp, userId, slotLevel, ammoItemId });
  };

  Hooks.on("createChatMessage", globalThis.__SS_USE_CHAT_HOOK__);
});

// 5. GM EXECUTION LOGIC FOR SHEET-SIDEKICK ROLLS
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const COMMAND_PREFIX = "!ss-roll";
  const isKnownAbility = (value) => ["str", "dex", "con", "int", "wis", "cha"].includes(String(value ?? "").toLowerCase());

  const executeSsRollCommand = async ({ actorId, rollKind, rollKey, rollLabel = "", timestamp, userId }) => {
    if (!actorId || !rollKind) return;
    if (Number.isFinite(timestamp) && (Date.now() - timestamp > 20000)) return;
    if (!userId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.warn("Requested roll actor not found.");

    const ownership = actor.ownership?.[userId] ?? 0;
    if (ownership < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
      return ui.notifications.warn("Player does not own that actor.");
    }

    const kind = String(rollKind ?? "").toLowerCase();
    const key = String(rollKey ?? "").trim().toLowerCase();

    try {
      if (kind === "initiative") {
        if (typeof actor.rollInitiative !== "function") return ui.notifications.warn("Initiative roll method not available.");
        await actor.rollInitiative({ createCombatants: true, configure: false });
        return;
      }

      if (kind === "skill") {
        if (!key || !actor.system?.skills?.[key]) return ui.notifications.warn("Skill key is invalid.");
        if (typeof actor.rollSkill !== "function") return ui.notifications.warn("Skill roll method not available.");
        await actor.rollSkill(key, { configure: false });
        return;
      }

      if (kind === "tool") {
        if (!key) return ui.notifications.warn("Tool key is invalid.");
        if (typeof actor.rollToolCheck === "function") {
          await actor.rollToolCheck(key, { configure: false });
          return;
        }
        if (typeof actor.rollSkill === "function" && actor.system?.skills?.[key]) {
          await actor.rollSkill(key, { configure: false });
          return;
        }
        return ui.notifications.warn("Tool roll method not available.");
      }

      if (kind === "abilitycheck") {
        if (!isKnownAbility(key)) return ui.notifications.warn("Ability key is invalid.");
        if (typeof actor.rollAbilityTest !== "function") return ui.notifications.warn("Ability check method not available.");
        await actor.rollAbilityTest(key, { configure: false });
        return;
      }

      if (kind === "abilitysave") {
        if (!isKnownAbility(key)) return ui.notifications.warn("Ability key is invalid.");
        if (typeof actor.rollAbilitySave !== "function") return ui.notifications.warn("Ability save method not available.");
        await actor.rollAbilitySave(key, { configure: false });
        return;
      }

      ui.notifications.info(`Unknown roll request: ${rollLabel || `${kind}:${key}`}`);
    } catch (err) {
      console.error("Sheet Sidekick roll execution error:", err);
      ui.notifications.error("Failed to execute requested roll.");
    }
  };
  globalThis.__SS_EXECUTE_ROLL_COMMAND__ = executeSsRollCommand;

  if (globalThis.__SS_ROLL_CHAT_HOOK__) Hooks.off("createChatMessage", globalThis.__SS_ROLL_CHAT_HOOK__);

  globalThis.__SS_ROLL_CHAT_HOOK__ = async (msg) => {
    const text = normalizeChatCommandText(msg.content);
    if (!text.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const parts = text.split(/\s+/);
    const actorId = parts[1];
    const rollKind = String(parts[2] ?? "").trim();
    const rollKey = String(parts[3] ?? "").trim();
    const timestamp = Number.parseInt(parts[4], 10);
    const userId = msg.author?.id ?? msg.user?.id;
    await executeSsRollCommand({ actorId, rollKind, rollKey, timestamp, userId });
  };

  Hooks.on("createChatMessage", globalThis.__SS_ROLL_CHAT_HOOK__);
});

// 6. GM EXECUTION LOGIC FOR SHEET-SIDEKICK TARGETING
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const COMMAND_PREFIX = "!ss-target";

  if (globalThis.__SS_TARGET_CHAT_HOOK__) Hooks.off("createChatMessage", globalThis.__SS_TARGET_CHAT_HOOK__);

  globalThis.__SS_TARGET_CHAT_HOOK__ = async (msg) => {
    const text = normalizeChatCommandText(msg.content);
    if (!text.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const parts = text.split(/\s+/);
    const mode = String(parts[1] ?? "").toLowerCase();
    const sceneId = parts[2] ?? "";
    const payload = parts[3] ?? "";
    const timestamp = Number.parseInt(parts[4], 10);
    const explicitUserId = parts[5] ?? null;
    const userId = explicitUserId ?? msg.author?.id ?? msg.user?.id ?? null;
    await executeSsTargetCommand({ mode, sceneId, payload, timestamp, userId });
  };

  Hooks.on("createChatMessage", globalThis.__SS_TARGET_CHAT_HOOK__);
});
