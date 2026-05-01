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

Hooks.once("ready", () => {
  if (game.user?.isGM) {
    document.body.classList.add("ss-gm-client");
  }
});

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
  if (key.includes("check") || key.includes("initiative")) return { type: "check", label: label.replace(/\s+/g, " "), value, icon: SS_HINT_ICONS.formula };
  if (key.includes("damage")) return { type: "damage", label: "Damage", value, icon: getDamageTypeIconPath(value) };
  if (key.includes("healing") || key.includes("heal")) return { type: "healing", label: "Healing", value, icon: getDamageTypeIconPath(`healing ${value}`) };
  if (key.includes("formula")) return { type: "formula", label: "Formula", value, icon: SS_HINT_ICONS.formula };
  if (key.includes("ammo")) return { type: "ammo", label: "Ammo", value, icon: SS_HINT_ICONS.ammo };
  if (key.includes("consumes") || key.includes("uses")) return { type: "resource", label, value, icon: SS_HINT_ICONS.resource };
  return { type: "misc", label, value, icon: SS_HINT_ICONS.misc };
}

function buildRollHintsHtml(rolls = [], options = {}) {
  if (!Array.isArray(rolls) || !rolls.length) return "";
  const title = String(options?.title ?? "Use this item's Suggested Rolls").trim();
  const helperText = String(
    options?.helperText
    ?? "These are prompts only. Roll the listed checks and add the shown modifier(s)."
  ).trim();
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
    <p class="ss-hint-section-title"><strong>${escapeHtml(title)}</strong></p>
    <p class="ss-hint-section-note">${escapeHtml(helperText)}</p>
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

function getSsItemActivities(item) {
  const raw = item?.system?.activities;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.contents)) return raw.contents;
  if (typeof raw === "object") return Object.values(raw);
  return [];
}

function parseNumericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickFirstNumeric(...values) {
  for (const value of values) {
    const numeric = parseNumericValue(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function hasConcentrationStatusId(value) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) return false;
  if (id === "concentration" || id === "concentrating") return true;
  if (id.endsWith(".concentration") || id.endsWith(".concentrating")) return true;
  return id.includes("concentrat");
}

function itemRequiresConcentration(item) {
  if (!item) return false;
  const root = item.system ?? {};
  const components = root?.components ?? {};
  const duration = root?.duration ?? {};
  const properties = root?.properties;
  const labelDuration = String(item?.labels?.duration ?? "").toLowerCase();
  if (components?.concentration === true || components?.concentration === 1) return true;
  if (duration?.concentration === true || duration?.concentration === 1) return true;
  if (String(duration?.units ?? "").toLowerCase() === "concentration") return true;
  if (labelDuration.includes("concentration")) return true;
  if (properties && typeof properties === "object") {
    if (properties?.concentration === true || properties?.con === true) return true;
    if (typeof properties?.has === "function") {
      if (properties.has("concentration") || properties.has("con")) return true;
    }
    if (Array.isArray(properties)) {
      if (properties.some((entry) => String(entry ?? "").toLowerCase() === "concentration" || String(entry ?? "").toLowerCase() === "con")) return true;
    }
  }
  const activities = getSsItemActivities(item);
  for (const activity of activities) {
    const actDuration = activity?.duration ?? activity?.activation?.duration ?? {};
    if (actDuration?.concentration === true || actDuration?.concentration === 1) return true;
    if (String(actDuration?.units ?? "").toLowerCase() === "concentration") return true;
  }
  return false;
}

function effectLooksLikeConcentration(effect) {
  if (!effect || effect.disabled) return false;
  const statuses = new Set(Array.from(effect?.statuses ?? []).map((id) => String(id ?? "").trim().toLowerCase()).filter(Boolean));
  if (Array.from(statuses).some((id) => hasConcentrationStatusId(id))) return true;
  const name = String(effect?.name ?? effect?.label ?? "").trim().toLowerCase();
  if (name.includes("concentrat")) return true;
  const changes = Array.from(effect?.changes ?? []);
  return changes.some((change) => String(change?.key ?? "").toLowerCase().includes("concentrat"));
}

function getConcentrationSourceItemId(effect) {
  const origin = String(effect?.origin ?? effect?.flags?.core?.sourceId ?? "").trim();
  if (!origin) return "";
  const match = origin.match(/\.item\.([^.]+)/i);
  return String(match?.[1] ?? "").trim();
}

function cleanConcentrationLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const stripped = raw
    .replace(/^concentrat(?:ion|ing)\s*[:\-]?\s*/i, "")
    .replace(/\(\s*concentrat(?:ion|ing)\s*\)/ig, "")
    .trim();
  if (!stripped) return "";
  if (/^concentrat(?:ion|ing)?$/i.test(stripped)) return "";
  return stripped;
}

function getActorConcentrationMeta(actor) {
  const result = { active: false, sourceName: "" };
  if (!actor) return result;
  const actorStatuses = Array.from(actor?.statuses ?? []).map((id) => String(id ?? "").trim().toLowerCase()).filter(Boolean);
  if (actorStatuses.some((id) => hasConcentrationStatusId(id))) result.active = true;

  const effects = Array.from(actor?.effects?.contents ?? actor?.effects ?? []);
  const effect = effects.find((candidate) => effectLooksLikeConcentration(candidate)) ?? null;
  if (!effect) return result;

  result.active = true;
  const sourceItemId = getConcentrationSourceItemId(effect);
  const sourceItemName = sourceItemId ? String(actor?.items?.get?.(sourceItemId)?.name ?? "").trim() : "";
  if (sourceItemName) {
    result.sourceName = sourceItemName;
    return result;
  }

  const flags = effect?.flags ?? {};
  const flaggedName = String(
    flags?.dnd5e?.spellName
    ?? flags?.dnd5e?.itemData?.name
    ?? flags?.dae?.itemName
    ?? flags?.core?.sourceName
    ?? ""
  ).trim();
  if (flaggedName) {
    result.sourceName = flaggedName;
    return result;
  }

  result.sourceName = cleanConcentrationLabel(effect?.name ?? effect?.label ?? "");
  return result;
}

function getUseConfirmConcentrationWarning(item, actor) {
  if (!item || !actor) return "";
  if (!itemRequiresConcentration(item)) return "";
  const concentration = getActorConcentrationMeta(actor);
  if (!concentration.active) return "";

  const nextName = String(item.name ?? "this spell").trim() || "this spell";
  const currentName = String(concentration.sourceName ?? "").trim();
  if (currentName) {
    if (currentName.toLowerCase() === nextName.toLowerCase()) {
      return `You are already concentrating on ${currentName}. Casting it again starts a new concentration and ends the previous one. D&D 5e allows only one concentration spell at a time.`;
    }
    return `You are concentrating on ${currentName}. Casting ${nextName} will end ${currentName}, because in D&D 5e you can concentrate on only one spell at a time.`;
  }
  return `You are already concentrating on another spell or effect. Casting ${nextName} will end your current concentration, because in D&D 5e you can concentrate on only one spell at a time.`;
}

function classifySsUseAssist(item, actor = null) {
  const result = {
    hasTargetAssist: false,
    hasPlacementAssist: false,
    selfOnly: false,
    reasons: [],
    placementReason: "",
    targetReason: "",
    targetLimit: 0,
    rangeFeet: 0
  };
  if (!item) return result;

  const activities = getSsItemActivities(item);
  const activityObjects = activities.map((a) => a?.toObject?.() ?? a ?? {});
  const rootSystem = item?.system?.toObject?.() ?? item?.system ?? {};
  const sources = [...activities, item.system ?? {}];
  let sawAnyRelevant = false;
  let sawOnlySelf = true;

  const addReason = (text) => {
    const line = String(text ?? "").trim();
    if (!line) return;
    if (!result.reasons.includes(line)) result.reasons.push(line);
  };

  const hasMeaningfulTemplateData = (template) => {
    if (!template) return false;
    if (typeof template === "string") return !!template.trim();
    if (Number.isFinite(Number(template))) return Number(template) > 0;
    if (typeof template !== "object") return false;

    const type = String(template.type ?? template.shape ?? "").trim().toLowerCase();
    const numericKeys = ["size", "distance", "width", "radius", "length", "angle"];
    const hasPositiveMetric = numericKeys.some((k) => {
      const n = Number(template?.[k]);
      return Number.isFinite(n) && n > 0;
    });
    const units = String(template.units ?? "").trim().toLowerCase();
    const count = Number(template.count);
    const hasCount = Number.isFinite(count) && count > 0;

    if (hasPositiveMetric) return true;
    if (type && !["", "none", "creature", "object", "self"].includes(type)) return true;
    if (units && !["", "ft", "feet", "m", "meter", "meters"].includes(units) && hasPositiveMetric) return true;
    if (hasCount && (type.includes("cone") || type.includes("line") || type.includes("circle") || type.includes("sphere") || type.includes("square") || type.includes("cube"))) return true;
    return false;
  };

  const toPositiveInt = (value) => {
    const n = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const getRangeFeetFromObj = (obj) => {
    const range = obj?.range ?? obj?.system?.range ?? {};
    const units = String(range?.units ?? range?.unit ?? "").toLowerCase();
    const raw = Number(range?.value ?? range?.distance ?? 0);
    if (units === "touch") return 5;
    if (["ft", "feet"].includes(units) && Number.isFinite(raw) && raw > 0) return Math.round(raw);
    return 0;
  };

  let explicitTargetLimit = 0;
  let explicitRangeFeet = 0;

  const hasCombatFollowupWithoutSlot = activityObjects.some((activity) => {
    const activityType = String(
      activity?.type
      ?? activity?.activityType
      ?? activity?.activation?.type
      ?? ""
    ).toLowerCase();
    const isCombatLike = /(attack|save|damage|heal)/.test(activityType)
      || !!activity?.attack || !!activity?.save || !!activity?.damage || !!activity?.healing;
    if (!isCombatLike) return false;

    const noSlot = activity?.consumption?.spellSlot === false;
    const override = activity?.activation?.override === true;
    if (!noSlot && !override) return false;

    const r = activity?.range ?? activity?.system?.range ?? {};
    const rangeUnits = String(r?.units ?? r?.unit ?? "").toLowerCase();
    const rangeValue = Number(r?.value ?? r?.distance ?? 0);
    const isCloseCombatRange = rangeUnits === "touch"
      || (rangeUnits === "ft" && Number.isFinite(rangeValue) && rangeValue > 0 && rangeValue <= 10);

    return override || isCloseCombatRange;
  });

  const hasSummonLikeActivity = activityObjects.some((activity) => {
    const activityType = String(
      activity?.type
      ?? activity?.activityType
      ?? activity?.activation?.type
      ?? ""
    ).toLowerCase();
    return /(summon|spawn|manifest|create)/.test(activityType);
  });

  for (const src of sources) {
    const obj = src?.toObject?.() ?? src ?? {};
    const target = obj.target ?? obj.system?.target ?? {};
    const targetAffects = target?.affects ?? {};
    const targetType = String(targetAffects?.type ?? target?.type ?? "").toLowerCase();
    const targetCount = Number(targetAffects?.count ?? target?.count ?? target?.value ?? 0);
    const range = obj.range ?? obj.system?.range ?? {};
    const rangeUnits = String(range?.units ?? range?.unit ?? "").toLowerCase();
    const activityType = String(obj.type ?? obj.activityType ?? obj?.activation?.type ?? "").toLowerCase();
    const template = target?.template
      ?? obj.template
      ?? obj.area
      ?? obj?.system?.template
      ?? obj?.system?.area
      ?? null;

    const isSelf = targetType.includes("self") || rangeUnits === "self";
    const hasTemplate = hasMeaningfulTemplateData(template);
    const looksPlacedSpace = targetType.includes("space") || targetType.includes("location");
    const looksTargeted = !isSelf && (
      targetCount > 0
      || /(creature|enemy|ally|allies|enemies|object|objects|token)/.test(targetType)
    );
    const isAttackOrSaveLike = /(attack|save|damage|heal)/.test(activityType)
      || !!obj.attack || !!obj.save || !!obj.healing || !!obj.damage;
    const hasReachRange = !!rangeUnits && !["", "none", "self", "touch"].includes(rangeUnits);
    const likelyTargetByAction = !isSelf && !hasTemplate && isAttackOrSaveLike && (looksTargeted || hasReachRange || rangeUnits === "touch");

    if (!isSelf && /(creature|enemy|ally|allies|enemies|object|objects|token)/.test(targetType)) {
      explicitTargetLimit = Math.max(explicitTargetLimit, toPositiveInt(targetAffects?.count ?? target?.count ?? target?.value));
    }
    explicitRangeFeet = Math.max(explicitRangeFeet, getRangeFeetFromObj(obj));

    if (isSelf || hasTemplate || looksPlacedSpace || looksTargeted || likelyTargetByAction) sawAnyRelevant = true;
    if (!isSelf && (hasTemplate || looksPlacedSpace || looksTargeted || likelyTargetByAction)) sawOnlySelf = false;

    if ((hasTemplate || looksPlacedSpace) && !isSelf) {
      result.hasPlacementAssist = true;
      if (!result.placementReason) result.placementReason = "This item uses a placed area/template.";
      addReason("Requires placement");
    }

    if (looksTargeted || likelyTargetByAction) {
      result.hasTargetAssist = true;
      if (!result.targetReason) result.targetReason = "This item appears to target one or more creatures/objects.";
      addReason("Can target creatures/objects");
    }
  }

  // Fallback: if the item exposes target metadata on the root item and we somehow missed it.
  const itemTargetType = String(item?.system?.target?.affects?.type ?? item?.system?.target?.type ?? "").toLowerCase();
  if (!result.hasTargetAssist && /(creature|enemy|ally|object|token)/.test(itemTargetType)) {
    result.hasTargetAssist = true;
    result.targetReason = result.targetReason || "This item appears to target one or more creatures/objects.";
  }
  const itemTemplate = item?.system?.target?.template ?? item?.system?.template ?? item?.system?.area ?? null;
  if (!result.hasPlacementAssist && hasMeaningfulTemplateData(itemTemplate)) {
    result.hasPlacementAssist = true;
    result.placementReason = result.placementReason || "This item uses a placed area/template.";
  }
  if (/(creature|enemy|ally|allies|enemies|object|objects|token)/.test(itemTargetType)) {
    explicitTargetLimit = Math.max(
      explicitTargetLimit,
      toPositiveInt(item?.system?.target?.affects?.count ?? item?.system?.target?.count ?? item?.system?.target?.value)
    );
  }
  explicitRangeFeet = Math.max(explicitRangeFeet, getRangeFeetFromObj(item?.system ?? {}));

  // Some summons/created effects do not carry explicit template metadata in actor-owned items.
  // Infer placement from structure: non-self ranged cast + summon-like/setup activity + no-slot follow-up combat action.
  if (!result.hasPlacementAssist) {
    const rootTargetType = String(
      rootSystem?.target?.affects?.type
      ?? rootSystem?.target?.type
      ?? ""
    ).toLowerCase();
    const rootTemplate = rootSystem?.target?.template ?? rootSystem?.template ?? rootSystem?.area ?? null;
    const rootRange = rootSystem?.range ?? {};
    const rootRangeUnits = String(rootRange?.units ?? rootRange?.unit ?? "").toLowerCase();
    const rootRangeValue = Number(rootRange?.value ?? rootRange?.distance ?? 0);

    const rootHasExplicitTarget = !!rootTargetType && !["", "none", "self"].includes(rootTargetType);
    const rootHasPlacementTemplate = hasMeaningfulTemplateData(rootTemplate);
    const rootHasNonSelfRange = !!rootRangeUnits && !["", "none", "self", "touch"].includes(rootRangeUnits);
    const rootHasDistance = Number.isFinite(rootRangeValue) ? rootRangeValue > 0 : rootHasNonSelfRange;

    const looksLikePlacedSummon =
      !rootHasExplicitTarget
      && !rootHasPlacementTemplate
      && rootHasNonSelfRange
      && rootHasDistance
      && (hasSummonLikeActivity || hasCombatFollowupWithoutSlot);

    if (looksLikePlacedSummon) {
      result.hasPlacementAssist = true;
      result.placementReason = result.placementReason || "This item appears to create or place an effect at a chosen location.";
      addReason("Requires placement");
    }
  }

  // Generic relocation heuristic (not spell-name specific): items that describe
  // teleporting/appearing in a chosen space should use placement assist.
  if (!result.hasPlacementAssist) {
    const textBits = [];
    textBits.push(String(item?.name ?? ""));
    textBits.push(String(rootSystem?.description?.value ?? ""));
    textBits.push(String(rootSystem?.description?.chat ?? ""));
    for (const activity of activityObjects) {
      textBits.push(String(activity?.name ?? ""));
      textBits.push(String(activity?.description?.value ?? ""));
      textBits.push(String(activity?.description?.chat ?? ""));
    }
    const text = textBits.join(" ").toLowerCase();

    const relocationPattern = /(teleport|unoccupied space|appears? in|choose(?:s|n)? a space|space you can see|reappear)/i;
    const createdEffectAtRangePattern = /(create(?:s|d)?[^.]{0,120}(?:within range|in an? unoccupied space|at a point)|at a point you can see within range|in an unoccupied space you can see)/i;
    const rootTargetType = String(
      rootSystem?.target?.affects?.type
      ?? rootSystem?.target?.type
      ?? ""
    ).toLowerCase();
    const rootRangeUnits = String(rootSystem?.range?.units ?? rootSystem?.range?.unit ?? "").toLowerCase();
    const rootRangeValue = Number(rootSystem?.range?.value ?? rootSystem?.range?.distance ?? 0);
    const selfScoped = rootTargetType.includes("self") || rootRangeUnits === "self";
    const rootHasExplicitTarget = !!rootTargetType && !["", "none", "self"].includes(rootTargetType);
    const rootHasNonSelfRange = !!rootRangeUnits && !["", "none", "self"].includes(rootRangeUnits);
    const rootHasDistance = Number.isFinite(rootRangeValue) ? rootRangeValue > 0 : rootHasNonSelfRange;

    if (
      (selfScoped && relocationPattern.test(text))
      || (!rootHasExplicitTarget && rootHasNonSelfRange && rootHasDistance && createdEffectAtRangePattern.test(text))
    ) {
      result.hasPlacementAssist = true;
      result.placementReason = result.placementReason || "This item appears to require choosing a destination/location.";
      addReason("Requires placement");
    }
  }

  result.targetLimit = explicitTargetLimit;
  result.rangeFeet = explicitRangeFeet;
  result.selfOnly = !!(sawAnyRelevant && sawOnlySelf && !result.hasPlacementAssist && !result.hasTargetAssist);
  return result;
}

function buildUseConfirmTargetingAssistHtml({ state }) {
  const assist = state?.assistMeta ?? {};
  if (!assist?.hasTargetAssist) return "";
  if (assist?.hasPlacementAssist) return "";
  const limit = Number.parseInt(String(assist?.targetLimit ?? 0), 10);
  const range = Number.parseInt(String(assist?.rangeFeet ?? 0), 10);
  const parts = [];
  if (Number.isFinite(limit) && limit > 0) parts.push(`up to ${limit} target${limit === 1 ? "" : "s"}`);
  if (Number.isFinite(range) && range > 0) parts.push(`within ${range} ft`);
  const dynamicLine = parts.length
    ? `Select ${parts.join(" ")}.`
    : "Select target(s) as needed.";

  return `
    <p class="ss-hint-section-title"><strong>Targeting:</strong></p>
    <div class="ss-use-confirm-assist ss-use-confirm-targeting-assist">
      <p class="ss-use-confirm-assist-text">${escapeHtml(dynamicLine)}</p>
      <button type="button" class="ss-use-confirm-open-targeting" data-ss-actor-id="${escapeHtml(String(state?.actorId ?? ""))}">Select Target (optional)</button>
      <div class="ss-use-confirm-target-live" data-ss-target-live style="display:none"></div>
    </div>
  `;
}

function buildUseConfirmPlacementAssistHtml({ state }) {
  const assist = state?.assistMeta ?? {};
  if (!assist?.hasPlacementAssist) return "";
  return `
    <p class="ss-hint-section-title"><strong>Placement:</strong></p>
    <div class="ss-use-confirm-assist ss-use-confirm-placement-assist">
      <p class="ss-use-confirm-assist-text">${escapeHtml(assist.placementReason || "This item needs placement on the map.")}</p>
      <p class="ss-use-confirm-assist-note">After you press <strong>Yes</strong>, Ping On Map will open automatically and request a snapshot from the GM.</p>
    </div>
  `;
}

function renderUseConfirmAssistIntoScope(scope, state) {
  if (!(scope instanceof HTMLElement)) return;
  const targetingWrap = scope.querySelector(".ss-targeting-assist-wrap");
  if (targetingWrap) targetingWrap.innerHTML = buildUseConfirmTargetingAssistHtml({ state });

  const placementWrap = scope.querySelector(".ss-placement-assist-wrap");
  if (placementWrap) placementWrap.innerHTML = buildUseConfirmPlacementAssistHtml({ state });
}

function getSsSceneDoc(sceneId = "") {
  const sid = String(sceneId ?? "").trim();
  if (sid) return game.scenes?.get?.(sid) ?? null;
  let effectiveSid = "";
  try {
    effectiveSid = (typeof getSsEffectiveSceneId === "function")
      ? String(getSsEffectiveSceneId({ preferCombat: false }) ?? "").trim()
      : "";
  } catch (_err) {
    effectiveSid = "";
  }
  if (effectiveSid) {
    return game.scenes?.get?.(effectiveSid)
      ?? (String(game.scenes?.viewed?.id ?? "").trim() === effectiveSid ? game.scenes?.viewed ?? null : null);
  }
  return game.scenes?.viewed ?? null;
}

function getSsCollectionDocuments(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (Array.isArray(collection.contents)) return collection.contents.filter(Boolean);
  if (typeof collection.values === "function") return Array.from(collection.values()).filter(Boolean);
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection).filter(Boolean);
  return [];
}

function getSsSceneTokenDocs(sceneDoc) {
  return getSsCollectionDocuments(sceneDoc?.tokens);
}

const SS_TARGET_LIST_FLAG_KEY = "ssTargetListInclude";

function readSsTargetListIncludeFromDocument(documentLike) {
  if (!documentLike) return false;
  try {
    const scoped = documentLike.getFlag?.(SS_MODULE_ID, SS_TARGET_LIST_FLAG_KEY);
    if (typeof scoped === "boolean") return scoped;
  } catch (_err) {
    // ignore and fall through to raw flags
  }
  const flags = documentLike.flags ?? documentLike._source?.flags ?? {};
  const scopedRaw = foundry.utils.getProperty(flags, `${SS_MODULE_ID}.${SS_TARGET_LIST_FLAG_KEY}`);
  if (typeof scopedRaw === "boolean") return scopedRaw;
  // Legacy fallback only reads raw data to avoid invalid scope exceptions from getFlag.
  const legacyRaw = foundry.utils.getProperty(flags, `custom-js.${SS_TARGET_LIST_FLAG_KEY}`);
  return !!legacyRaw;
}

function readSsTargetListInclude(actor) {
  return readSsTargetListIncludeFromDocument(actor);
}

function readSsTargetListIncludeForToken(tokenDoc) {
  return readSsTargetListIncludeFromDocument(tokenDoc);
}

async function writeSsTargetListIncludeForDocument(documentLike, enabled) {
  if (!documentLike) return;
  const next = !!enabled;
  try {
    await documentLike.setFlag(SS_MODULE_ID, SS_TARGET_LIST_FLAG_KEY, next);
    return;
  } catch (_err) {
    await documentLike.update({ [`flags.${SS_MODULE_ID}.${SS_TARGET_LIST_FLAG_KEY}`]: next });
  }
}

async function writeSsTargetListInclude(actor, enabled) {
  await writeSsTargetListIncludeForDocument(actor, enabled);
}

async function writeSsTargetListIncludeForToken(tokenDoc, enabled) {
  await writeSsTargetListIncludeForDocument(tokenDoc, enabled);
}

function getSsTargetTokenIdsForUserOnScene(user, sceneId) {
  const sid = String(sceneId ?? "").trim();
  if (!user) return [];
  const sceneDoc = getSsSceneDoc(sid);
  const sceneTokenIds = new Set(
    getSsSceneTokenDocs(sceneDoc)
      .map((t) => String(t?.id ?? ""))
      .filter(Boolean)
  );
  const ids = new Set();

  const targets = Array.from(user.targets ?? []);
  for (const target of targets) {
    const sceneMatch = String(target?.document?.parent?.id ?? target?.scene?.id ?? "") === sid;
    if (!sid || sceneMatch) {
      const tid = String(target?.id ?? target?.document?.id ?? "");
      if (tid && (!sid || sceneTokenIds.has(tid))) ids.add(tid);
    }
  }

  const activitySceneId = String(user?.activity?.scene ?? user?.activity?.sceneId ?? "");
  const activityTargets = Array.isArray(user?.activity?.targets) ? user.activity.targets : [];
  for (const entry of activityTargets) {
    const tid = String(
      (typeof entry === "string" ? entry : (entry?.token ?? entry?.id ?? entry?.target ?? ""))
    ).trim();
    if (!tid) continue;
    if (sid && activitySceneId && activitySceneId !== sid) continue;
    if (sid && !sceneTokenIds.has(tid)) continue;
    ids.add(tid);
  }

  return Array.from(ids);
}

function getSsActiveGmUser() {
  return game.users?.find?.((u) => !!u?.isGM && !!u?.active) ?? game.users?.find?.((u) => !!u?.isGM) ?? null;
}

function getSsLiveTargetRefsForScene(sceneId = "", fallbackRefs = [], { includeFallback = false } = {}) {
  const sid = String(sceneId ?? "").trim();
  const out = new Set();

  const pushTokenIds = (ids) => {
    for (const id of (ids ?? [])) {
      const tid = String(id ?? "").trim();
      if (!tid) continue;
      out.add(`token:${tid}`);
    }
  };

  const gm = getSsActiveGmUser();
  if (gm) {
    // GM is authoritative for shared targeting state.
    pushTokenIds(getSsTargetTokenIdsForUserOnScene(gm, sid));
  } else {
    pushTokenIds(getSsTargetTokenIdsForUserOnScene(game.user, sid));
  }

  const proxyForSelf = getProxyTargetsForUser(game.user?.id);
  if (proxyForSelf && out.size === 0) {
    const proxyScene = String(proxyForSelf.sceneId ?? "");
    if (!sid || !proxyScene || proxyScene === sid) pushTokenIds(proxyForSelf.tokenIds);
  }

  if (includeFallback && out.size === 0) {
    for (const ref of (Array.isArray(fallbackRefs) ? fallbackRefs : [])) {
      const raw = String(ref ?? "").trim();
      if (!raw) continue;
      out.add(raw.includes(":") ? raw : `token:${raw}`);
    }
  }

  return out;
}

function getSsTargetNamesFromRefs(sceneId = "", refs = []) {
  const sceneDoc = getSsSceneDoc(sceneId);
  const sceneTokens = getSsSceneTokenDocs(sceneDoc);
  const byId = new Map(sceneTokens.map((t) => [String(t?.id ?? ""), t]));
  const names = [];
  for (const ref of refs) {
    const raw = String(ref ?? "").trim();
    if (!raw) continue;
    let tokenId = raw;
    if (raw.includes(":")) tokenId = raw.slice(raw.indexOf(":") + 1).trim();
    const tokenDoc = byId.get(tokenId);
    if (tokenDoc?.name) names.push(String(tokenDoc.name));
  }
  return names;
}

function getSsTargetEntriesFromRefs(sceneId = "", refs = []) {
  const sceneDoc = getSsSceneDoc(sceneId);
  const sceneTokens = getSsSceneTokenDocs(sceneDoc);
  const byId = new Map(sceneTokens.map((t) => [String(t?.id ?? ""), t]));
  const entries = [];
  const seen = new Set();
  for (const ref of refs) {
    const raw = String(ref ?? "").trim();
    if (!raw) continue;
    let tokenId = raw;
    if (raw.includes(":")) tokenId = raw.slice(raw.indexOf(":") + 1).trim();
    if (!tokenId || seen.has(tokenId)) continue;
    const tokenDoc = byId.get(tokenId);
    if (!tokenDoc?.name) continue;
    const actorDoc = tokenDoc.actor ?? game.actors?.get?.(tokenDoc.actorId) ?? null;
    entries.push({
      tokenId,
      name: String(tokenDoc.name),
      img: String(tokenDoc.texture?.src ?? actorDoc?.img ?? "").trim()
    });
    seen.add(tokenId);
  }
  return entries;
}

function getUseConfirmTargetContext(state) {
  const actorId = String(state?.actorId ?? "").trim();
  const form = actorId
    ? Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR))
      .find((f) => String(f?.dataset?.actorId ?? "") === actorId)
    : null;

  const sceneId =
    String(form?.querySelector?.(".ss-target-panel-overlay")?.dataset?.ssSceneId ?? "").trim()
    || String(game.combat?.scene?.id ?? game.combat?.sceneId ?? getSsEffectiveSceneId() ?? "");

  const refs = Array.from(getSsLiveTargetRefsForScene(sceneId, [], { includeFallback: false }));
  return { sceneId, refs, form };
}

function renderUseConfirmLiveTargetSummary(scope, state) {
  if (!(scope instanceof HTMLElement)) return;
  const node = scope.querySelector(".ss-use-confirm-target-live[data-ss-target-live]");
  if (!(node instanceof HTMLElement)) return;

  const { sceneId, refs } = getUseConfirmTargetContext(state);
  const entries = getSsTargetEntriesFromRefs(sceneId, refs);
  if (!entries.length) {
    node.style.display = "none";
    node.innerHTML = "";
    return;
  }
  node.style.display = "block";
  node.innerHTML = `
    <strong>Targeting:</strong>
    <div class="ss-use-confirm-target-live-list">
      ${entries.map((entry) => `
        <div class="ss-use-confirm-target-live-item">
          <span class="ss-use-confirm-target-live-avatar"${entry.img ? ` style="background-image:url('${escapeHtml(entry.img)}')"` : ""}></span>
          <span class="ss-use-confirm-target-live-name">${escapeHtml(entry.name)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function getSsHighestWindowZ() {
  let maxZ = 2000;
  const nodes = document.querySelectorAll(".app.window-app, dialog.application");
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const z = Number.parseInt(getComputedStyle(node).zIndex ?? "", 10);
    if (Number.isFinite(z)) maxZ = Math.max(maxZ, z);
  }
  return maxZ;
}

function bringSsSheetToFront(scope) {
  if (!(scope instanceof HTMLElement)) return;
  const appShell = scope.closest(".application, .window-app");
  if (!(appShell instanceof HTMLElement)) return;
  if (!appShell.dataset.ssPrevZIndex) {
    appShell.dataset.ssPrevZIndex = appShell.style.zIndex ?? "";
  }
  const targetZ = Math.max(getSsHighestWindowZ() + 3, 2147482400);
  appShell.style.setProperty("z-index", String(targetZ), "important");
}

function restoreSsSheetZIndex(scope) {
  if (!(scope instanceof HTMLElement)) return;
  const appShell = scope.closest(".application, .window-app");
  if (!(appShell instanceof HTMLElement)) return;
  const prev = String(appShell.dataset.ssPrevZIndex ?? "");
  if (prev) appShell.style.setProperty("z-index", prev);
  else appShell.style.removeProperty("z-index");
  delete appShell.dataset.ssPrevZIndex;
}

function openSsTargetingPanelForActor(actorId, options = {}) {
  const aid = String(actorId ?? "").trim();
  if (!aid) return false;

  const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR));
  const scope = forms.find((f) => String(f?.dataset?.actorId ?? "") === aid)
    ?? null;
  if (!(scope instanceof HTMLElement)) return false;

  const forceTargeting = !!options?.forceTargeting;
  const targetLimit = Number.parseInt(String(options?.targetLimit ?? 0), 10);
  const rangeFeet = Number.parseInt(String(options?.rangeFeet ?? 0), 10);
  scope.dataset.ssTargetForce = forceTargeting ? "1" : "0";
  scope.dataset.ssTargetLimit = Number.isFinite(targetLimit) && targetLimit > 0 ? String(targetLimit) : "0";
  scope.dataset.ssTargetRangeFeet = Number.isFinite(rangeFeet) && rangeFeet > 0 ? String(rangeFeet) : "0";

  bringSsSheetToFront(scope);

  const openPanel = scope.__ssOpenTargetPanel;
  if (typeof openPanel === "function") {
    return !!openPanel({ openFromUse: forceTargeting });
  }

  const targetTab = scope.querySelector("a.ss-target-fs-toggle");
  if (targetTab instanceof HTMLElement) {
    if (forceTargeting) targetTab.dataset.ssOpenFromUse = "1";
    targetTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }
  return false;
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

  const targetLimit = Number.parseInt(String(state?.assistMeta?.targetLimit ?? 0), 10);
  if (state?.assistMeta?.hasTargetAssist && Number.isFinite(targetLimit) && targetLimit > 0) {
    const { refs } = getUseConfirmTargetContext(state);
    if (refs.length > targetLimit) {
      return `Too many targets selected (${refs.length}/${targetLimit}). Open Select Target and reduce the selection.`;
    }
  }

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
  renderUseConfirmAssistIntoScope(scope, state);
  renderUseConfirmLiveTargetSummary(scope, state);

  const invalidReason = evaluateUseConfirmInvalidReason(scope, state);
  const turnLockReason = evaluateUseConfirmTurnLockReason(state);
  const warning = scope.querySelector(".ss-use-confirm-warning");
  if (warning instanceof HTMLElement) {
    warning.textContent = invalidReason;
    warning.style.display = invalidReason ? "block" : "none";
    warning.classList.toggle("ss-turn-locked", !!turnLockReason);
  }
  const gmNote = scope.querySelector(".ss-use-confirm-gm-note");
  if (gmNote instanceof HTMLElement) {
    gmNote.style.display = getActiveGmIds().length ? "none" : "block";
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

if (!globalThis.__SS_USE_CONFIRM_TARGETING_CLICK_BOUND__) {
  globalThis.__SS_USE_CONFIRM_TARGETING_CLICK_BOUND__ = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest(".ss-use-confirm-open-targeting");
    if (!(btn instanceof HTMLButtonElement)) return;

    event.preventDefault();
    event.stopPropagation();

    const actorId = String(btn.dataset?.ssActorId ?? "").trim();
    const scope = btn.closest(".ss-use-confirm[data-ss-hints-key]");
    const key = String(scope?.dataset?.ssHintsKey ?? "").trim();
    const state = key ? ssUseConfirmHintState.get(key) : null;
    const targetLimit = Number.parseInt(String(state?.assistMeta?.targetLimit ?? 0), 10);
    const rangeFeet = Number.parseInt(String(state?.assistMeta?.rangeFeet ?? 0), 10);
    const opened = openSsTargetingPanelForActor(actorId, {
      forceTargeting: true,
      targetLimit: Number.isFinite(targetLimit) && targetLimit > 0 ? targetLimit : 0,
      rangeFeet: Number.isFinite(rangeFeet) && rangeFeet > 0 ? rangeFeet : 0
    });
    if (!opened) {
      ui.notifications?.warn?.("Could not open the Ping panel.");
      return;
    }
    if (scope instanceof HTMLElement && key) {
      if (state) {
        window.setTimeout(() => syncUseConfirmDialogState(scope, state), 250);
        window.setTimeout(() => syncUseConfirmDialogState(scope, state), 1000);
      }
    }
  }, true);
}

function refreshAllUseConfirmLiveTargetSummaries() {
  const scopes = document.querySelectorAll(".ss-use-confirm[data-ss-hints-key]");
  scopes.forEach((scope) => {
    if (!(scope instanceof HTMLElement)) return;
    const key = String(scope.dataset?.ssHintsKey ?? "");
    if (!key) return;
    const state = ssUseConfirmHintState.get(key);
    if (!state) return;
    renderUseConfirmLiveTargetSummary(scope, state);
  });
}

function syncOpenTargetPanelsWithLiveTargets() {
  const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
  forms.forEach((form) => {
    if (!(form instanceof HTMLElement)) return;
    const overlay = form.querySelector(".ss-target-panel-overlay");
    if (!(overlay instanceof HTMLElement)) return;
    const sceneId = String(
      overlay.dataset?.ssSceneId
      ?? game.combat?.scene?.id
      ?? game.combat?.sceneId
      ?? getSsEffectiveSceneId()
      ?? ""
    ).trim();
    const refs = Array.from(getSsLiveTargetRefsForScene(sceneId));
    overlay.dataset.ssSelectionDirty = "0";
    overlay.dataset.ssSelectedTokens = refs.join(",");
    if (typeof form.__ssRenderTargetPanel === "function" && form.classList.contains("ss-target-panel-open")) {
      try {
        form.__ssRenderTargetPanel();
      } catch (_err) {
        // noop
      }
    }
  });
}

function resetSsTargetsForActor(actor) {
  if (game.user?.isGM) return;
  const actorId = String(actor?.id ?? "").trim();
  if (!actorId) return;

  const sceneId = String(
    getActiveCombatForViewedScene()?.scene?.id
    ?? getActiveCombatForViewedScene()?.sceneId
    ?? getSsEffectiveSceneId({ preferCombat: false })
    ?? ""
  );

  setProxyTargetsForUser(game.user?.id, sceneId, []);
  const ts = Date.now();
  const sent = sendCommandToGmSocket("ssTarget", {
    mode: "set",
    sceneId,
    payload: "-",
    timestamp: ts,
    userId: game.user?.id ?? null
  });
  if (!sent) {
    sendCommandToGmWhisper(`!ss-target set ${sceneId} - ${ts} ${game.user?.id ?? ""}`, { includeSelf: true });
  }
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
  const assistMeta = item ? classifySsUseAssist(item, actor) : {
    hasTargetAssist: false, hasPlacementAssist: false, selfOnly: false, targetLimit: 0, rangeFeet: 0
  };
  const concentrationWarningText = getUseConfirmConcentrationWarning(item, actor);
  if (item && actor && !game.user?.isGM) {
    const combat = getActiveCombatForViewedScene();
    const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, { combat });
    if (!(combat && turnAccess.locked)) {
      resetSsTargetsForActor(actor);
    }
  }

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
      userId: game.user?.id ?? null,
      actorId: actor?.id ?? item?.parent?.id ?? "",
      assistMeta
    });
    setTimeout(() => ssUseConfirmHintState.delete(dialogKey), 120000);
  }

  const title = "Use Item?";
  const imageHtml = item?.img
    ? `<img class="ss-use-confirm-image" src="${escapeHtml(item.img)}" alt="${escapeHtml(itemName)}">`
    : "";
  const infoButtonHtml = item?.uuid
    ? `<button type="button"
        class="ss-use-confirm-info"
        aria-label="Open Item Details"
        title="Open Item Details"
        data-uuid="${escapeHtml(item.uuid)}"
        data-action="ssTooltip">
        <i class="fa-solid fa-circle-info" inert></i>
        <span class="ss-use-confirm-info-text">Info</span>
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
  const gmOnline = getActiveGmIds().length > 0;
  const gmNoteHtml = `
    <p class="ss-use-confirm-gm-note"${gmOnline ? ' style="display:none"' : ""}>
      GM is not connected. You can review this item, but a GM must be online to process Use/Target changes.
    </p>
  `;
  const concentrationHtml = concentrationWarningText
    ? `<p class="ss-use-confirm-concentration-note">${escapeHtml(concentrationWarningText)}</p>`
    : "";
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
      ${gmNoteHtml}
      ${concentrationHtml}
      <p class="ss-use-confirm-warning" style="display:none"></p>
      <div class="ss-use-confirm-body">
        <div class="ss-roll-hints-wrap">${hintsHtml}</div>
        <div class="ss-consumes-wrap">${consumesHtml}</div>
        <div class="ss-components-wrap">${componentsHtml}</div>
        <div class="ss-targeting-assist-wrap"></div>
        <div class="ss-placement-assist-wrap"></div>
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
          return { confirmed: false, slotLevel: null, ammoItemId: null, requestPlacementPing: false };
        }

        const pickedLevel = Number.parseInt(String(syncState.level ?? ""), 10);
        const slotLevel = Number.isFinite(pickedLevel) && pickedLevel > 0 ? pickedLevel : null;
        const ammoItemId = String(syncState.ammoId ?? "").trim() || null;
        return { confirmed: true, slotLevel, ammoItemId, requestPlacementPing: !!state?.assistMeta?.hasPlacementAssist };
      },
      no: () => {
        return { confirmed: false, slotLevel: null, ammoItemId: null, requestPlacementPing: false };
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
      setupUseConfirmScrollCue(dialogKey);
    }, 40);
    const result = await resultPromise;
    const openScope = document.querySelector(`.ss-use-confirm[data-ss-hints-key='${dialogKey}']`);
    const openRoot = openScope?.closest?.(".app.window-app.dialog, dialog.application");
    if (openRoot?.__ssUseConfirmScrollCueCleanup instanceof Function) {
      try { openRoot.__ssUseConfirmScrollCueCleanup(); } catch (_err) { /* noop */ }
      delete openRoot.__ssUseConfirmScrollCueCleanup;
    }
    ssUseConfirmHintState.delete(dialogKey);
    if (result && typeof result === "object" && "confirmed" in result) return result;
    return { confirmed: !!result, slotLevel: null, ammoItemId: null, requestPlacementPing: false };
  }

  // Fallback if a confirm dialog helper is unavailable.
  if (requiresSpellSlots && (!castChoices.length || !castChoices.some((c) => Number(c.value ?? 0) > 0))) {
    ui.notifications.warn("No spell slots left.");
    return { confirmed: false, slotLevel: null, ammoItemId: null, requestPlacementPing: false };
  }
  if (requireItemUses && (!Number.isFinite(itemUsesValue) || itemUsesValue <= 0)) {
    ui.notifications.warn("No uses left for this item.");
    return { confirmed: false, slotLevel: null, ammoItemId: null, requestPlacementPing: false };
  }
  if (ammoConfig.required && (!ammoConfig.choices.length || !ammoConfig.choices.some((c) => Number(c.qty ?? 0) > 0))) {
    ui.notifications.warn("No compatible ammo available.");
    return { confirmed: false, slotLevel: null, ammoItemId: null, requestPlacementPing: false };
  }
  const hintText = initial.rolls.length ? `\nSuggested rolls: ${initial.rolls.join("; ")}` : "";
  const concentrationText = concentrationWarningText ? `\n${concentrationWarningText}` : "";
  return {
    confirmed: !!globalThis.confirm?.(`Use ${itemName} now?${hintText}${concentrationText}`),
    slotLevel: defaultLevel,
    ammoItemId: defaultAmmoId || null,
    requestPlacementPing: !!assistMeta?.hasPlacementAssist
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
  if (user.isGM) return false;

  // Monks Common Display client should stay silent.
  if (isMonksCommonDisplayClient()) return true;

  const playerData = getSheetSidekickSetting("playerdata", {}) ?? {};
  return !!playerData?.[user.id]?.display;
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
const ssDpadViewportLockState = globalThis.__SS_DPAD_VIEWPORT_LOCK_STATE__ ?? (globalThis.__SS_DPAD_VIEWPORT_LOCK_STATE__ = {
  byActorId: {},
  sceneId: "",
  gmUserId: "",
  at: 0
});
const ssGmSceneState = globalThis.__SS_GM_SCENE_STATE__ ?? (globalThis.__SS_GM_SCENE_STATE__ = {
  sceneId: "",
  at: 0
});
const ssManualTargetListState = globalThis.__SS_MANUAL_TARGET_LIST_STATE__ ?? (globalThis.__SS_MANUAL_TARGET_LIST_STATE__ = {
  byScene: {}
});
const ssPlayerMovementState = globalThis.__SS_PLAYER_MOVEMENT_STATE__ ?? (globalThis.__SS_PLAYER_MOVEMENT_STATE__ = {
  tokenPositions: {},
  byActorId: {}
});
const ssGmBurstRulerState = globalThis.__SS_GM_BURST_RULER_STATE__ ?? (globalThis.__SS_GM_BURST_RULER_STATE__ = {
  byTokenId: {},
  container: null
});
const SS_PLAYER_MOVEMENT_BURST_MS = 2500;
const SS_PLAYER_MOVEMENT_DISPLAY_MS = 4500;

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

function getSsKnownGmSceneId() {
  return String(
    ssGmSceneState.sceneId
    || ssDpadViewportLockState.sceneId
    || game.scenes?.viewed?.id
    || canvas?.scene?.id
    || ""
  ).trim();
}

function getSsEffectiveSceneId({ preferCombat = true } = {}) {
  if (preferCombat) {
    const combat = game.combat;
    const combatSceneId = String(combat?.scene?.id ?? combat?.sceneId ?? "").trim();
    const hasCombatants = !!(combat?.combatants?.size > 0 || getSsCollectionDocuments(combat?.combatants).length > 0);
    if (hasCombatants && combatSceneId) return combatSceneId;
  }
  return getSsKnownGmSceneId();
}

function resetSsManualTargetListState() {
  ssManualTargetListState.byScene = {};
  try { globalThis.__SS_PROXY_TARGETS_BY_USER__?.clear?.(); } catch (_err) { /* noop */ }
}

function setSsGmSceneId(sceneId = "", { resetManualTargets = true } = {}) {
  const sid = String(sceneId ?? "").trim();
  if (!sid) return false;
  const previous = String(ssGmSceneState.sceneId ?? "").trim();
  const changed = previous && previous !== sid;
  ssGmSceneState.sceneId = sid;
  ssGmSceneState.at = Date.now();
  if (changed && resetManualTargets) resetSsManualTargetListState();
  return changed;
}

function getSsManualTargetList(sceneId = "") {
  const sid = String(sceneId ?? getSsEffectiveSceneId({ preferCombat: false }) ?? "").trim();
  if (!sid) return { actorIds: [], tokenIds: [] };
  const current = ssManualTargetListState.byScene?.[sid] ?? {};
  const actorIds = Array.from(new Set((Array.isArray(current.actorIds) ? current.actorIds : [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean)));
  const tokenIds = Array.from(new Set((Array.isArray(current.tokenIds) ? current.tokenIds : [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean)));
  ssManualTargetListState.byScene[sid] = { actorIds, tokenIds };
  return ssManualTargetListState.byScene[sid];
}

function setSsManualTargetList(sceneId = "", { actorIds = [], tokenIds = [] } = {}) {
  const sid = String(sceneId ?? "").trim();
  if (!sid) return;
  ssManualTargetListState.byScene[sid] = {
    actorIds: Array.from(new Set((Array.isArray(actorIds) ? actorIds : []).map((id) => String(id ?? "").trim()).filter(Boolean))),
    tokenIds: Array.from(new Set((Array.isArray(tokenIds) ? tokenIds : []).map((id) => String(id ?? "").trim()).filter(Boolean)))
  };
}

function setSsManualTargetMembership({ sceneId = "", actorId = "", tokenId = "", enabled = false } = {}) {
  const sid = String(sceneId ?? getSsEffectiveSceneId({ preferCombat: false }) ?? "").trim();
  if (!sid) return;
  const list = getSsManualTargetList(sid);
  const aid = String(actorId ?? "").trim();
  const tid = String(tokenId ?? "").trim();
  const updateList = (items, value) => {
    if (!value) return items;
    const next = new Set(items);
    if (enabled) next.add(value);
    else next.delete(value);
    return Array.from(next);
  };
  list.actorIds = updateList(list.actorIds, aid);
  list.tokenIds = updateList(list.tokenIds, tid);
}

function isSsManualTargetIncluded(sceneId = "", tokenDoc = null, actorId = "") {
  const list = getSsManualTargetList(sceneId);
  const tid = String(tokenDoc?.id ?? "").trim();
  const aid = String(actorId || tokenDoc?.actorId || tokenDoc?.actor?.id || "").trim();
  return (!!tid && list.tokenIds.includes(tid)) || (!!aid && list.actorIds.includes(aid));
}

function emitSsManualTargetListStateFromGm(sceneId = "") {
  if (!game.user?.isGM) return false;
  const sid = String(sceneId ?? getSsEffectiveSceneId({ preferCombat: false }) ?? "").trim();
  if (!sid) return false;
  const list = getSsManualTargetList(sid);
  return emitSsSocketMessage({
    type: "ssTargetListState",
    sceneId: sid,
    actorIds: list.actorIds,
    tokenIds: list.tokenIds,
    at: Date.now(),
    gmUserId: game.user?.id ?? null
  });
}

function setPlayerDpadViewportLockState(payload = {}) {
  if (game.user?.isGM) return;
  const next = {
    byActorId: {},
    sceneId: String(payload?.sceneId ?? "").trim(),
    gmUserId: String(payload?.gmUserId ?? "").trim(),
    at: Number(payload?.at ?? Date.now()) || Date.now()
  };
  const raw = payload?.byActorId;
  if (raw && typeof raw === "object") {
    for (const [actorId, entry] of Object.entries(raw)) {
      const aid = String(actorId ?? "").trim();
      if (!aid) continue;
      next.byActorId[aid] = {
        locked: !!entry?.locked,
        reason: String(entry?.reason ?? "").trim()
      };
    }
  }
  ssDpadViewportLockState.byActorId = next.byActorId;
  ssDpadViewportLockState.sceneId = next.sceneId;
  ssDpadViewportLockState.gmUserId = next.gmUserId;
  ssDpadViewportLockState.at = next.at;
  const sceneChanged = setSsGmSceneId(next.sceneId);
  if (sceneChanged) queueSheetSidekickFormRefresh(80);
}

function getPlayerDpadViewportLockForActor(actorId = "") {
  const aid = String(actorId ?? "").trim();
  if (!aid) return { locked: false, reason: "" };
  const entry = ssDpadViewportLockState.byActorId?.[aid];
  if (!entry || typeof entry !== "object") return { locked: false, reason: "" };
  const reason = String(entry.reason ?? "").trim();
  return {
    locked: !!entry.locked,
    reason: reason || "Your token is outside the GM's current view."
  };
}

function getSsTokenPositionCacheKey(tokenDoc) {
  const sceneId = String(tokenDoc?.parent?.id ?? tokenDoc?.parent?.parent?.id ?? game.scenes?.viewed?.id ?? "").trim();
  const tokenId = String(tokenDoc?.id ?? "").trim();
  if (!sceneId || !tokenId) return "";
  return `${sceneId}.${tokenId}`;
}

function rememberSsTokenPosition(tokenDoc) {
  const key = getSsTokenPositionCacheKey(tokenDoc);
  if (!key) return;
  const x = Number(tokenDoc?.x ?? 0);
  const y = Number(tokenDoc?.y ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  ssPlayerMovementState.tokenPositions[key] = { x, y };
}

function forgetSsTokenPosition(tokenDoc) {
  const key = getSsTokenPositionCacheKey(tokenDoc);
  if (!key) return;
  delete ssPlayerMovementState.tokenPositions[key];
}

function seedSsViewedSceneTokenPositions() {
  const sceneDoc = game.scenes?.viewed ?? null;
  const tokens = Array.from(sceneDoc?.tokens?.contents ?? sceneDoc?.tokens ?? []);
  tokens.forEach((tokenDoc) => rememberSsTokenPosition(tokenDoc));
}

function getSsCurrentActiveActorId() {
  const currentActor = getSheetSidekickModule()?.api?.getCurrentActor?.() ?? null;
  return String(currentActor?.id ?? game.user?.character?.id ?? "").trim();
}

function isSsSceneInActiveCombat(sceneId = "") {
  const sid = String(sceneId ?? "").trim();
  if (!sid) return false;
  const combats = Array.from(game.combats?.contents ?? game.combats ?? []);
  return combats.some((combat) => {
    if (!combat) return false;
    if (combat.started === false) return false;
    if (combat.round === 0 && combat.turn === null && combat.current === null && !combat.combatant) return false;
    return String(combat?.scene?.id ?? combat?.sceneId ?? "").trim() === sid;
  });
}

function formatSsFeetValue(value) {
  const rounded = Math.round(Number(value ?? 0) * 10) / 10;
  if (!Number.isFinite(rounded)) return "0";
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function createSsMeasurementPoint(point) {
  return {
    x: Number(point?.x ?? 0),
    y: Number(point?.y ?? 0)
  };
}

function createSsRulerWaypoint(tokenDoc, point) {
  return {
    x: Number(point?.x ?? 0),
    y: Number(point?.y ?? 0),
    elevation: Number(point?.elevation ?? tokenDoc?.elevation ?? tokenDoc?._source?.elevation ?? 0) || 0,
    width: Number(point?.width ?? tokenDoc?.width ?? tokenDoc?._source?.width ?? 1) || 1,
    height: Number(point?.height ?? tokenDoc?.height ?? tokenDoc?._source?.height ?? 1) || 1,
    shape: String(point?.shape ?? tokenDoc?.shape ?? tokenDoc?._source?.shape ?? "rectangle"),
    action: String(point?.action ?? tokenDoc?.movementAction ?? "displace"),
    snapped: point?.snapped ?? false,
    explicit: point?.explicit ?? true,
    checkpoint: point?.checkpoint ?? true,
    intermediate: point?.intermediate ?? false
  };
}

function getSsMeasurementDisplayPoint(tokenDoc, point) {
  const x = Number(point?.x ?? NaN);
  const y = Number(point?.y ?? NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  try {
    const center = tokenDoc?.getCenterPoint?.({
      x,
      y,
      elevation: Number(tokenDoc?.elevation ?? tokenDoc?._source?.elevation ?? 0) || 0,
      width: Number(tokenDoc?.width ?? tokenDoc?._source?.width ?? 1) || 1,
      height: Number(tokenDoc?.height ?? tokenDoc?._source?.height ?? 1) || 1
    });
    if (Number.isFinite(center?.x) && Number.isFinite(center?.y)) return center;
  } catch (_err) {
    // noop
  }

  const gridSize = Number(tokenDoc?.parent?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
  const tokenW = (Number(tokenDoc?.width ?? tokenDoc?._source?.width ?? 1) || 1) * gridSize;
  const tokenH = (Number(tokenDoc?.height ?? tokenDoc?._source?.height ?? 1) || 1) * gridSize;
  return {
    x: x + (tokenW / 2),
    y: y + (tokenH / 2)
  };
}

function getSsSceneDistanceUnit(sceneDoc) {
  const unit = String(
    sceneDoc?.grid?.units
    ?? canvas?.scene?.grid?.units
    ?? game.i18n?.localize?.("GRID.Feet")
    ?? "ft"
  ).trim();
  return unit || "ft";
}

function getSsUserOverlayColor(userId = "") {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const user = game.users?.get?.(uid) ?? null;
  const css = String(user?.color?.css ?? user?.color ?? "").trim();
  return css || null;
}

function normalizeSsOverlayColor(color, fallback = 0x6ee7ff) {
  if (typeof color === "number" && Number.isFinite(color)) return color;
  const raw = String(color ?? "").trim();
  if (!raw) return fallback;

  try {
    if (globalThis.PIXI?.Color) {
      return Number(new PIXI.Color(raw).toNumber());
    }
  } catch (_err) {
    // noop
  }

  try {
    if (typeof PIXI?.utils?.string2hex === "function") {
      return Number(PIXI.utils.string2hex(raw));
    }
  } catch (_err) {
    // noop
  }

  const hex = raw.replace(/^#/, "");
  if (/^[\da-f]{6}$/i.test(hex)) {
    const parsed = Number.parseInt(hex, 16);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function canRenderSsBurstRulerOverlay() {
  if (!canvas?.ready || !game.user) return false;
  return !!(game.user.isGM || isMonksCommonDisplayClient());
}

function getSsGmBurstRulerContainer() {
  if (!canRenderSsBurstRulerOverlay()) return null;
  const parent = canvas.controls ?? canvas.tokens ?? canvas.stage ?? null;
  if (!parent) return null;

  let container = ssGmBurstRulerState.container ?? null;
  if (container?.destroyed) container = null;
  if (!container || (container.parent !== parent)) {
    if (container?.parent) container.parent.removeChild(container);
    container = new PIXI.Container();
    container.name = "ss-gm-burst-ruler";
    container.eventMode = "none";
    parent.addChild(container);
    ssGmBurstRulerState.container = container;
  }
  return container;
}

function clearSsGmBurstRulerOverlay(tokenId = "") {
  const tid = String(tokenId ?? "").trim();
  const container = ssGmBurstRulerState.container ?? null;
  if (!tid || !container || container.destroyed) return;
  const overlay = container.getChildByName?.(`ss-gm-burst-ruler-${tid}`) ?? null;
  if (!overlay) return;
  container.removeChild(overlay);
  overlay.destroy({children: true});
}

function drawSsGmBurstRulerOverlay(tokenDoc, points = [], totalFeet = null, accentColor = null) {
  if (!canRenderSsBurstRulerOverlay() || !tokenDoc?.id) return;
  if (!Array.isArray(points) || points.length < 2) return;

  const container = getSsGmBurstRulerContainer();
  if (!container) return;

  const centers = points
    .map((point) => getSsMeasurementDisplayPoint(tokenDoc, point))
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (centers.length < 2) return;

  const tokenId = String(tokenDoc.id ?? "").trim();
  clearSsGmBurstRulerOverlay(tokenId);

  const overlay = new PIXI.Container();
  overlay.name = `ss-gm-burst-ruler-${tokenId}`;
  overlay.eventMode = "none";
  const lineColor = normalizeSsOverlayColor(accentColor, 0x6ee7ff);
  const markerBorder = 0x072433;

  const shadow = new PIXI.Graphics();
  shadow.lineStyle(8, 0x091018, 0.5, 0.5);
  shadow.moveTo(centers[0].x, centers[0].y);
  for (let i = 1; i < centers.length; i += 1) shadow.lineTo(centers[i].x, centers[i].y);

  const line = new PIXI.Graphics();
  line.lineStyle(4, lineColor, 0.95, 0.5);
  line.moveTo(centers[0].x, centers[0].y);
  for (let i = 1; i < centers.length; i += 1) line.lineTo(centers[i].x, centers[i].y);

  const markers = new PIXI.Graphics();
  markers.lineStyle(2, markerBorder, 0.95, 0.5);
  centers.forEach((point, index) => {
    const radius = index === (centers.length - 1) ? 7 : 5;
    const fill = index === (centers.length - 1) ? 0xfef3c7 : lineColor;
    markers.beginFill(fill, 0.98);
    markers.drawCircle(point.x, point.y, radius);
    markers.endFill();
  });

  overlay.addChild(shadow, line, markers);

  const measuredFeet = Number(totalFeet ?? NaN);
  if (Number.isFinite(measuredFeet) && measuredFeet > 0) {
    const labelText = `${formatSsFeetValue(measuredFeet)} ${getSsSceneDistanceUnit(tokenDoc?.parent ?? canvas?.scene ?? null)}`;
    const labelStyle = new PIXI.TextStyle({
      fill: lineColor,
      fontFamily: "Signika, sans-serif",
      fontSize: 22,
      fontWeight: "700",
      stroke: 0x08111b,
      strokeThickness: 5,
      lineJoin: "round"
    });
    const label = new PIXI.Text(labelText, labelStyle);
    label.anchor?.set?.(0.5, 1);

    const lastPoint = centers[centers.length - 1];
    label.position.set(lastPoint.x, lastPoint.y - 16);

    const paddingX = 12;
    const paddingY = 8;
    const bg = new PIXI.Graphics();
    bg.beginFill(0x08111b, 0.84);
    bg.lineStyle(2, lineColor, 0.45, 0.5);
    bg.drawRoundedRect(
      label.x - ((label.width / 2) + paddingX),
      label.y - label.height - paddingY,
      label.width + (paddingX * 2),
      label.height + (paddingY * 2),
      10
    );
    bg.endFill();

    overlay.addChild(bg, label);
  }

  container.addChild(overlay);
}

function clearSsBurstRulerOverlayTimer(tokenId = "") {
  const tid = String(tokenId ?? "").trim();
  if (!tid) return;
  const entry = ssGmBurstRulerState.byTokenId?.[tid];
  if (!entry?.overlayTimer) return;
  window.clearTimeout(entry.overlayTimer);
  delete entry.overlayTimer;
}

function scheduleSsBurstRulerOverlayClear(tokenDoc, delayMs = SS_PLAYER_MOVEMENT_DISPLAY_MS) {
  const tokenId = String(tokenDoc?.id ?? "").trim();
  if (!tokenId) return;
  clearSsBurstRulerOverlayTimer(tokenId);
  const timer = window.setTimeout(() => {
    const current = ssGmBurstRulerState.byTokenId?.[tokenId];
    if (current?.overlayTimer !== timer) return;
    clearSsGmBurstRulerOverlay(tokenId);
    delete current.overlayTimer;
    if (!game.user?.isGM && !current?.timer) {
      delete ssGmBurstRulerState.byTokenId[tokenId];
    }
  }, Math.max(50, Number(delayMs ?? SS_PLAYER_MOVEMENT_DISPLAY_MS)) + 25);
  ssGmBurstRulerState.byTokenId[tokenId] = {
    ...(ssGmBurstRulerState.byTokenId?.[tokenId] ?? {}),
    overlayTimer: timer
  };
}

function handleSsBurstRulerSocketForPlayer(data = {}) {
  if (game.user?.isGM) return;
  if (!isMonksCommonDisplayClient()) return;

  const viewedSceneId = String(game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
  const sceneId = String(data.sceneId ?? "").trim();
  if (sceneId && viewedSceneId && sceneId !== viewedSceneId) return;

  const tokenId = String(data.tokenId ?? "").trim();
  if (!tokenId) return;

  const tokenDoc = game.scenes?.viewed?.tokens?.get?.(tokenId)
    ?? canvas?.scene?.tokens?.get?.(tokenId)
    ?? null;
  if (!tokenDoc) return;

  if (String(data.action ?? "").trim() === "clear") {
    clearSsBurstRulerOverlayTimer(tokenId);
    clearSsGmBurstRulerOverlay(tokenId);
    delete ssGmBurstRulerState.byTokenId[tokenId];
    return;
  }

  const points = Array.isArray(data.points)
    ? data.points.map((point) => createSsMeasurementPoint(point))
    : [];
  if (points.length < 2) return;

  const totalFeet = Number(data.totalFeet ?? NaN);
  const color = getSsUserOverlayColor(String(data.userId ?? "").trim()) ?? data.color ?? null;
  drawSsGmBurstRulerOverlay(tokenDoc, points, Number.isFinite(totalFeet) ? totalFeet : null, color);
  const remaining = Math.max(50, Number(data.hideAt ?? 0) - Date.now());
  ssGmBurstRulerState.byTokenId[tokenId] = {
    ...(ssGmBurstRulerState.byTokenId?.[tokenId] ?? {}),
    lastAt: Date.now(),
    points,
    totalFeet: Number.isFinite(totalFeet) ? totalFeet : null,
    color
  };
  scheduleSsBurstRulerOverlayClear(tokenDoc, remaining);
}

function measureSsMovementPathFeet(sceneDoc, points = []) {
  if (!sceneDoc?.grid?.measurePath || !Array.isArray(points) || points.length < 2) return null;
  const waypoints = points
    .map((point) => createSsMeasurementPoint(point))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (waypoints.length < 2) return null;

  try {
    const result = sceneDoc.grid.measurePath(waypoints);
    const distance = Number(result?.distance ?? NaN);
    if (!Number.isFinite(distance) || distance <= 0) return null;
    return Math.round(distance * 10) / 10;
  } catch (_err) {
    return null;
  }
}

function measureSsTokenMoveFeet(sceneDoc, fromPos, toPos) {
  const measured = measureSsMovementPathFeet(sceneDoc, [fromPos, toPos]);
  if (measured !== null) return measured;

  const gridSize = Number(sceneDoc?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
  const gridDistance = Number(sceneDoc?.grid?.distance ?? canvas?.scene?.grid?.distance ?? 5) || 5;
  if (!(gridSize > 0) || !(gridDistance > 0)) return null;

  const fromX = Number(fromPos?.x ?? NaN);
  const fromY = Number(fromPos?.y ?? NaN);
  const toX = Number(toPos?.x ?? NaN);
  const toY = Number(toPos?.y ?? NaN);
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null;

  const dxCells = (toX - fromX) / gridSize;
  const dyCells = (toY - fromY) / gridSize;
  const rawFeet = Math.hypot(dxCells, dyCells) * gridDistance;
  if (!Number.isFinite(rawFeet) || rawFeet <= 0) return null;
  return Math.round(rawFeet * 10) / 10;
}

function getSsPlayerMovementStatus(actorId = "") {
  const aid = String(actorId ?? "").trim();
  if (!aid) return null;
  const entry = ssPlayerMovementState.byActorId?.[aid];
  if (!entry || typeof entry !== "object") return null;
  if (Number(entry.hideAt ?? 0) <= Date.now()) {
    if (entry.timer) window.clearTimeout(entry.timer);
    delete ssPlayerMovementState.byActorId[aid];
    return null;
  }
  const lastFeet = Number(entry.lastFeet ?? 0);
  const totalFeet = Number(entry.totalFeet ?? 0);
  const hasBurst = totalFeet > (lastFeet + 0.05);
  return {
    lastFeet,
    totalFeet,
    text: hasBurst
      ? `Moved ${formatSsFeetValue(lastFeet)} ft. Total ${formatSsFeetValue(totalFeet)} ft.`
      : `Moved ${formatSsFeetValue(lastFeet)} ft.`
  };
}

function syncOpenSheetDpadMovementNotes() {
  if (game.user?.isGM) return;
  document.querySelectorAll(SS_SHEET_FORM_SELECTOR).forEach((form) => {
    if (typeof form.__ssRenderDpadMoveNote === "function") {
      try {
        form.__ssRenderDpadMoveNote();
      } catch (_err) {
        // noop
      }
    }
  });
}

function clearSsGmBurstRuler(tokenDoc, userId = game.user?.id ?? "") {
  clearSsGmBurstRulerOverlay(tokenDoc?.id ?? "");
  if (!game.user?.isGM) return;
  const token = tokenDoc?.object ?? canvas.tokens?.get?.(tokenDoc?.id ?? "");
  if (!token) return;
  if (userId in token._plannedMovement) {
    delete token._plannedMovement[userId];
  }
  try {
    tokenDoc?.clearMovementHistory?.();
  } catch (_err) {
    // noop
  }
  token.renderFlags?.set?.({refreshRuler: true, refreshState: true});
  emitSsSocketMessage({
    type: "ssBurstRuler",
    action: "clear",
    sceneId: String(tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim(),
    tokenId: String(tokenDoc?.id ?? "").trim(),
    at: Date.now(),
    gmUserId: game.user?.id ?? null
  });
}

function resetSsGmBurstRulerIfExpired(tokenDoc) {
  if (!game.user?.isGM || !tokenDoc?.id) return;
  const tokenId = String(tokenDoc.id ?? "").trim();
  if (!tokenId) return;
  const prior = ssGmBurstRulerState.byTokenId?.[tokenId];
  if (!prior) return;
  const expired = (Date.now() - Number(prior.lastAt ?? 0)) > SS_PLAYER_MOVEMENT_BURST_MS;
  if (!expired) return;
  if (prior.timer) window.clearTimeout(prior.timer);
  clearSsGmBurstRuler(tokenDoc, prior.userId);
  delete ssGmBurstRulerState.byTokenId[tokenId];
}

function recordSsGmBurstRuler(tokenDoc, previous = null, next = null, userId = "") {
  if (!game.user?.isGM || !tokenDoc?.id) return;

  const tokenId = String(tokenDoc.id ?? "").trim();
  if (!tokenId) return;
  const now = Date.now();
  const prior = ssGmBurstRulerState.byTokenId?.[tokenId];
  const moverUserId = String(userId ?? prior?.moverUserId ?? "").trim();
  const color = getSsUserOverlayColor(moverUserId) ?? prior?.color ?? null;
  const currentPoint = createSsMeasurementPoint({
    x: Number(next?.x ?? tokenDoc.x ?? 0),
    y: Number(next?.y ?? tokenDoc.y ?? 0)
  });
  const withinBurst = prior && ((now - Number(prior.lastAt ?? 0)) <= SS_PLAYER_MOVEMENT_BURST_MS);
  const points = withinBurst
    ? [...(Array.isArray(prior.points) ? prior.points : []), currentPoint]
    : [
      createSsMeasurementPoint({
        x: Number(previous?.x ?? prior?.origin?.x ?? tokenDoc.x ?? 0),
        y: Number(previous?.y ?? prior?.origin?.y ?? tokenDoc.y ?? 0)
      }),
      currentPoint
    ];
  const dedupedPoints = points.filter((point, index, arr) => (
    index === 0
    || point.x !== arr[index - 1]?.x
    || point.y !== arr[index - 1]?.y
  ));
  const sceneDoc = tokenDoc?.parent ?? game.scenes?.viewed ?? canvas?.scene ?? null;
  const totalFeet = measureSsMovementPathFeet(sceneDoc, dedupedPoints);
  if (prior?.timer) window.clearTimeout(prior.timer);
  const timer = window.setTimeout(() => {
    const current = ssGmBurstRulerState.byTokenId?.[tokenId];
    if (!current || current.timer !== timer) return;
    clearSsGmBurstRuler(tokenDoc, current.userId);
    delete ssGmBurstRulerState.byTokenId[tokenId];
  }, SS_PLAYER_MOVEMENT_DISPLAY_MS + 25);

  ssGmBurstRulerState.byTokenId[tokenId] = {
    lastAt: now,
    origin: withinBurst ? prior.origin : dedupedPoints[0],
    points: dedupedPoints,
    totalFeet,
    color,
    moverUserId,
    timer,
    userId: game.user.id
  };
  drawSsGmBurstRulerOverlay(tokenDoc, dedupedPoints, totalFeet, color);
  emitSsSocketMessage({
    type: "ssBurstRuler",
    action: "show",
    sceneId: String(sceneDoc?.id ?? tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim(),
    tokenId,
    points: dedupedPoints,
    totalFeet,
    color,
    userId: moverUserId,
    hideAt: now + SS_PLAYER_MOVEMENT_DISPLAY_MS,
    at: now,
    gmUserId: game.user?.id ?? null
  });
}

function recordSsMovementBurst(actorId = "", sceneId = "", sceneDoc = null, previous = null, next = null) {
  const aid = String(actorId ?? "").trim();
  const sid = String(sceneId ?? "").trim();
  if (!aid || !sid || !sceneDoc) return null;

  const feet = measureSsTokenMoveFeet(sceneDoc, previous, next);
  if (!(feet > 0)) return null;

  const now = Date.now();
  const prevStatus = ssPlayerMovementState.byActorId?.[aid];
  const withinBurst = prevStatus
    && (String(prevStatus.sceneId ?? "").trim() === sid)
    && ((now - Number(prevStatus.lastMovedAt ?? 0)) <= SS_PLAYER_MOVEMENT_BURST_MS);
  const points = withinBurst
    ? [...(Array.isArray(prevStatus.points) ? prevStatus.points : []), createSsMeasurementPoint(next)]
    : [createSsMeasurementPoint(previous), createSsMeasurementPoint(next)];
  const totalFeet = measureSsMovementPathFeet(sceneDoc, points) ?? feet;
  const hideAt = now + SS_PLAYER_MOVEMENT_DISPLAY_MS;

  if (prevStatus?.timer) window.clearTimeout(prevStatus.timer);
  const status = {
    lastFeet: feet,
    totalFeet,
    lastMovedAt: now,
    hideAt,
    timer: window.setTimeout(() => {
      const current = ssPlayerMovementState.byActorId?.[aid];
      if (current?.hideAt !== hideAt) return;
      delete ssPlayerMovementState.byActorId[aid];
      syncOpenSheetDpadMovementNotes();
    }, SS_PLAYER_MOVEMENT_DISPLAY_MS + 25),
    points,
    sceneId: sid
  };
  ssPlayerMovementState.byActorId[aid] = status;
  return status;
}

function noteSsPlayerMovementFromTokenUpdate(tokenDoc, changed = {}) {
  if (game.user?.isGM) return;

  const movedX = Object.prototype.hasOwnProperty.call(changed ?? {}, "x");
  const movedY = Object.prototype.hasOwnProperty.call(changed ?? {}, "y");
  if (!movedX && !movedY) {
    rememberSsTokenPosition(tokenDoc);
    return;
  }

  const sceneId = String(tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? "").trim();
  const actorId = String(tokenDoc?.actorId ?? tokenDoc?.actor?.id ?? "").trim();
  const cacheKey = getSsTokenPositionCacheKey(tokenDoc);
  const previous = cacheKey ? ssPlayerMovementState.tokenPositions?.[cacheKey] : null;
  const next = {
    x: Number(tokenDoc?.x ?? changed?.x ?? 0),
    y: Number(tokenDoc?.y ?? changed?.y ?? 0)
  };
  if (cacheKey) ssPlayerMovementState.tokenPositions[cacheKey] = next;
  if (!previous || !sceneId || !actorId) return;
  if (isSsSceneInActiveCombat(sceneId)) return;

  const actorDoc = tokenDoc?.actor ?? game.actors?.get?.(actorId) ?? null;
  const isOwner = !!actorDoc?.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
  if (!isOwner) return;

  const activeActorId = getSsCurrentActiveActorId();
  if (activeActorId && activeActorId !== actorId) return;

  const sceneDoc = tokenDoc?.parent ?? game.scenes?.get?.(sceneId) ?? null;
  const nextStatus = recordSsMovementBurst(actorId, sceneId, sceneDoc, previous, next);
  if (!nextStatus) return;
  syncOpenSheetDpadMovementNotes();
}

function emitPlayerControlsStateFromGm() {
  if (!game.user?.isGM) return;
  const enabled = game.user.getFlag("world", "dpadEnabled") ?? true;
  emitSsSocketMessage({
    type: "ssControls",
    enabled: !!enabled,
    at: Date.now(),
    gmUserId: game.user.id
  });
}

function emitSsTargetUiSyncFromGm(sceneId = "") {
  if (!game.user?.isGM) return;
  emitSsSocketMessage({
    type: "ssTargetUiSync",
    sceneId: String(sceneId ?? ""),
    at: Date.now(),
    gmUserId: game.user.id
  });
}

function getSsTokenPixelBoundsForDpadLock(tokenDoc) {
  if (!tokenDoc) return null;
  const gridSize = Number(canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100) || 100;
  const x = Number(tokenDoc.x ?? 0);
  const y = Number(tokenDoc.y ?? 0);
  const wUnits = Number(tokenDoc.width ?? 1) || 1;
  const hUnits = Number(tokenDoc.height ?? 1) || 1;
  const w = wUnits * gridSize;
  const h = hUnits * gridSize;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

function isSsTokenVisibleInGmViewport(tokenDoc) {
  if (!canvas?.ready || !tokenDoc) return false;
  const bounds = getSsTokenPixelBoundsForDpadLock(tokenDoc);
  if (!bounds) return false;

  const stage = canvas.stage;
  const wt = stage?.worldTransform ?? null;
  const renderer = canvas.app?.renderer ?? null;
  const screenW = Number(renderer?.screen?.width ?? window.innerWidth ?? 0);
  const screenH = Number(renderer?.screen?.height ?? window.innerHeight ?? 0);
  if (!wt || !(screenW > 0) || !(screenH > 0)) return false;

  const topLeft = wt.apply(new PIXI.Point(bounds.x, bounds.y));
  const bottomRight = wt.apply(new PIXI.Point(bounds.x + bounds.w, bounds.y + bounds.h));
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  const margin = 4;

  return maxX >= -margin && minX <= (screenW + margin) && maxY >= -margin && minY <= (screenH + margin);
}

function buildSsDpadViewportLockMapForGm(sceneId = "") {
  if (!game.user?.isGM) return {};
  const sid = String(sceneId ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
  const sceneDoc = sid
    ? (game.scenes?.get?.(sid) ?? (String(game.scenes?.viewed?.id ?? "") === sid ? game.scenes?.viewed : null))
    : (game.scenes?.viewed ?? null);
  if (!sceneDoc) return {};

  const tokens = getSsSceneTokenDocs(sceneDoc);
  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const actors = getSsCollectionDocuments(game.actors)
    .filter((a) => {
      if (a?.type !== "character") return false;
      const hasPlayerOwner = (typeof a.hasPlayerOwner === "function") ? a.hasPlayerOwner() : a.hasPlayerOwner;
      if (hasPlayerOwner) return true;
      return getSsCollectionDocuments(game.users).some((u) => !u?.isGM && a.testUserPermission?.(u, ownerLevel));
    });
  const byActorId = {};

  for (const actor of actors) {
    const actorId = String(actor?.id ?? "").trim();
    if (!actorId) continue;
    const actorTokens = tokens.filter((t) => String(t?.actorId ?? "") === actorId && !t?.hidden);
    if (!actorTokens.length) {
      byActorId[actorId] = {
        locked: true,
        reason: "Your token is not on the GM's currently viewed scene."
      };
      continue;
    }
    const visible = actorTokens.some((t) => isSsTokenVisibleInGmViewport(t));
    byActorId[actorId] = visible
      ? { locked: false, reason: "" }
      : { locked: true, reason: "Your token is outside the GM's current view." };
  }

  return byActorId;
}

function emitSsDpadViewportLockStateFromGm(sceneId = "") {
  if (!game.user?.isGM) return;
  const sid = String(sceneId ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
  setSsGmSceneId(sid);
  emitSsSocketMessage({
    type: "ssDpadViewportLock",
    sceneId: sid,
    byActorId: buildSsDpadViewportLockMapForGm(sid),
    at: Date.now(),
    gmUserId: game.user?.id ?? null
  });
  emitSsManualTargetListStateFromGm(sid);
}

function queueSsTargetUiSyncFromGm(sceneId = "") {
  if (!game.user?.isGM) return;
  const sid = String(
    sceneId
    ?? game.combat?.scene?.id
    ?? game.combat?.sceneId
    ?? game.scenes?.viewed?.id
    ?? ""
  ).trim();
  if (sid) ssTargetUiSyncEmitState.sceneId = sid;
  if (ssTargetUiSyncEmitState.timer) window.clearTimeout(ssTargetUiSyncEmitState.timer);
  ssTargetUiSyncEmitState.timer = window.setTimeout(() => {
    ssTargetUiSyncEmitState.timer = null;
    emitSsTargetUiSyncFromGm(ssTargetUiSyncEmitState.sceneId || sid);
  }, 60);
}

function queueSsDpadViewportLockSyncFromGm(sceneId = "") {
  if (!game.user?.isGM) return;
  const sid = String(
    sceneId
    ?? game.scenes?.viewed?.id
    ?? canvas?.scene?.id
    ?? ""
  ).trim();
  if (sid) ssDpadViewportEmitState.sceneId = sid;
  if (ssDpadViewportEmitState.timer) window.clearTimeout(ssDpadViewportEmitState.timer);
  ssDpadViewportEmitState.timer = window.setTimeout(() => {
    ssDpadViewportEmitState.timer = null;
    emitSsDpadViewportLockStateFromGm(ssDpadViewportEmitState.sceneId || sid);
  }, 90);
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

function emitSsPauseStateFromGm(paused = null) {
  if (!game.user?.isGM) return false;
  const isPaused = (typeof paused === "boolean") ? paused : !!game.paused;
  return emitSsSocketMessage({
    type: "ssPause",
    paused: isPaused,
    at: Date.now(),
    gmUserId: game.user?.id ?? null
  });
}

function getActiveCombatForViewedScene() {
  const combat = game.combat;
  if (!combat) return null;
  if (!(combat.combatants?.size > 0)) return null;

  const viewedSceneId = getSsKnownGmSceneId() || null;
  const combatSceneId = combat?.scene?.id ?? combat?.sceneId ?? null;
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
  return getSsCollectionDocuments(game.users)
    .filter((u) => u?.isGM && (u.active || u.isActive || u.isActiveGM || (u.isSelf && game.user?.isGM)))
    .map((u) => u.id);
}

const ssNoGmDialogState = globalThis.__SS_NO_GM_DIALOG_STATE__ ?? (globalThis.__SS_NO_GM_DIALOG_STATE__ = {
  lastShownAt: 0,
  overlayEl: null,
  titleEl: null,
  messageEl: null
});
const ssPendingRestDialogLabels = globalThis.__SS_PENDING_REST_DIALOG_LABELS__ ?? (globalThis.__SS_PENDING_REST_DIALOG_LABELS__ = []);

function ensureSsNoActiveGmOverlay() {
  const state = ssNoGmDialogState;
  if (state.overlayEl instanceof HTMLElement && state.titleEl instanceof HTMLElement && state.messageEl instanceof HTMLElement) {
    return state;
  }

  const overlay = document.createElement("div");
  overlay.className = "ss-no-gm-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483600",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px",
    background: "rgba(6, 10, 16, 0.88)"
  });

  const card = document.createElement("section");
  Object.assign(card.style, {
    width: "min(92vw, 420px)",
    display: "grid",
    gap: "10px",
    padding: "14px 14px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(214, 181, 109, 0.5)",
    background: "rgba(13, 19, 29, 0.98)",
    boxShadow: "0 18px 36px rgba(0,0,0,.45)",
    color: "#f2ead3"
  });

  const title = document.createElement("div");
  title.style.cssText = "font-weight:800; font-size:1.02rem; letter-spacing:.02em;";
  title.textContent = "GM Required";

  const message = document.createElement("div");
  message.style.cssText = "font-size:.95rem; line-height:1.35;";
  message.textContent = "No GM is currently connected. Please try again once a GM is online.";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  Object.assign(closeBtn.style, {
    minHeight: "2.2rem",
    borderRadius: "8px",
    border: "1px solid rgba(214, 181, 109, 0.45)",
    background: "rgba(24, 30, 43, 0.92)",
    color: "#f2ead3",
    fontWeight: "700"
  });
  closeBtn.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.style.display = "none";
  });

  card.append(title, message, closeBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  state.overlayEl = overlay;
  state.titleEl = title;
  state.messageEl = message;
  return state;
}

async function showSsNoActiveGmDialog({
  title = "GM Required",
  actionLabel = "This action"
} = {}) {
  const now = Date.now();
  if ((now - Number(ssNoGmDialogState.lastShownAt ?? 0)) < 900) return false;
  ssNoGmDialogState.lastShownAt = now;

  const safeAction = escapeHtml(String(actionLabel ?? "This action").trim() || "This action");
  const heading = String(title ?? "GM Required").trim() || "GM Required";
  const message = `No GM is currently connected. ${safeAction} needs a GM online to process changes.`;

  if (document?.body) {
    const state = ensureSsNoActiveGmOverlay();
    if (state.titleEl instanceof HTMLElement) state.titleEl.textContent = heading;
    if (state.messageEl instanceof HTMLElement) state.messageEl.textContent = message;
    if (state.overlayEl instanceof HTMLElement) state.overlayEl.style.display = "flex";
    return true;
  }

  ui.notifications?.warn?.(`${heading}: ${message}`);
  return false;
}

const SS_SOCKET_CHANNEL_PRIMARY = "module.sheet-sidekick";

function emitSsSocketMessage(payload = {}) {
  if (!game.socket?.emit) return false;
  try {
    game.socket.emit(SS_SOCKET_CHANNEL_PRIMARY, payload);
    return true;
  } catch (_errPrimary) {
    return false;
  }
}

function sendCommandToGmSocket(type, payload = {}) {
  if (!type || typeof type !== "string") return false;
  if (!getActiveGmIds().length) return false;

  return emitSsSocketMessage({
    type,
    ...payload,
    userId: payload.userId ?? game.user?.id ?? null
  });
}

function sendCommandToGmWhisper(content, options = {}) {
  const includeSelf = options.includeSelf === true;
  const noGmActionLabel = String(options.noGmActionLabel ?? "This action").trim() || "This action";
  const gms = getActiveGmIds();
  if (!gms.length) {
    showSsNoActiveGmDialog({ actionLabel: noGmActionLabel });
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

const ssJournalImageShareState = globalThis.__SS_JOURNAL_IMAGE_SHARE_STATE__ ?? (globalThis.__SS_JOURNAL_IMAGE_SHARE_STATE__ = {
  boundRoots: new WeakSet(),
  handledEvents: new WeakSet(),
  documentBound: false,
  activeViewer: null,
  activeTimer: 0
});

function getRenderableRootElement(element) {
  if (element instanceof HTMLElement) return element;
  if (element?.[0] instanceof HTMLElement) return element[0];
  return null;
}

function getSsJournalImageShareTitle(app, img) {
  const alt = String(img?.alt ?? "").trim();
  if (alt) return alt;
  const imageTitle = String(img?.title ?? "").trim();
  if (imageTitle) return imageTitle;
  const appTitle = String(app?.title ?? "").trim();
  if (appTitle) return `${appTitle} - Image`;
  const windowTitle = String(img?.closest?.(".window-app")?.querySelector?.(".window-title")?.textContent ?? "").trim();
  if (windowTitle) return `${windowTitle} - Image`;
  return "Journal Image";
}

function isJournalBodyImageElement(img) {
  if (!(img instanceof HTMLImageElement)) return false;
  const journalWindow = img.closest(".sheet.journal-entry, .journal-sheet, .journal-entry-page, .journal-entry, [data-application-class*='Journal']");
  if (!journalWindow) return false;
  if (img.closest(".window-header, .journal-sidebar, .pages-list, nav.tabs, .sheet-tabs, .header-actions")) return false;
  return true;
}

function handleJournalImageShareClick(event, app = null) {
  if (!game.user?.isGM) return;
  if (!event || event.button !== 0) return;

  const handledEvents = ssJournalImageShareState.handledEvents instanceof WeakSet
    ? ssJournalImageShareState.handledEvents
    : (ssJournalImageShareState.handledEvents = new WeakSet());
  if (handledEvents.has(event)) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  const img = target.closest("img");
  if (!(img instanceof HTMLImageElement)) return;
  if (!isJournalBodyImageElement(img)) return;

  const src = String(img.currentSrc || img.src || "").trim();
  if (!src) return;

  handledEvents.add(event);
  emitSsSocketMessage({
    type: "ssJournalImageShow",
    src,
    title: getSsJournalImageShareTitle(app, img),
    userId: game.user?.id ?? null,
    timestamp: Date.now()
  });
}

function bindGlobalJournalImageShareListener() {
  if (!game.user?.isGM) return;
  if (!isSheetSidekickModuleActive()) return;
  if (ssJournalImageShareState.documentBound) return;

  const onDocumentClick = (event) => {
    handleJournalImageShareClick(event, null);
  };
  document.addEventListener("click", onDocumentClick, true);
  ssJournalImageShareState.documentBound = true;
  ssJournalImageShareState.documentClickHandler = onDocumentClick;
}

function getSsJournalImageDisplaySeconds() {
  const raw = Number(getSheetSidekickSetting("journalImageDisplaySeconds", 20));
  if (!Number.isFinite(raw)) return 20;
  return Math.max(1, Math.min(120, Math.round(raw)));
}

function clearSsSharedJournalImageAutoHide() {
  const timer = Number(ssJournalImageShareState.activeTimer ?? 0);
  if (timer) {
    window.clearTimeout(timer);
    ssJournalImageShareState.activeTimer = 0;
  }
}

function closeSsSharedJournalImageViewer() {
  clearSsSharedJournalImageAutoHide();
  const viewer = ssJournalImageShareState.activeViewer ?? null;
  ssJournalImageShareState.activeViewer = null;
  if (!viewer) return;
  try {
    if (typeof viewer.close === "function") viewer.close();
    else if (typeof viewer.render === "function") viewer.render(false);
  } catch (_err) {
    // noop
  }
}

function scheduleSsSharedJournalImageAutoHide(viewer) {
  clearSsSharedJournalImageAutoHide();
  ssJournalImageShareState.activeViewer = viewer ?? null;
  const seconds = getSsJournalImageDisplaySeconds();
  ssJournalImageShareState.activeTimer = window.setTimeout(() => {
    closeSsSharedJournalImageViewer();
  }, seconds * 1000);
}

function showSsSharedJournalImageForPlayer(data = {}) {
  const src = String(data?.src ?? "").trim();
  if (!src) return;

  const title = String(data?.title ?? "").trim() || "Journal Image";
  closeSsSharedJournalImageViewer();
  const ImagePopoutCtor = globalThis.ImagePopout;
  if (typeof ImagePopoutCtor === "function") {
    try {
      const popout = new ImagePopoutCtor(src, { title, shareable: false });
      popout.render(true);
      scheduleSsSharedJournalImageAutoHide(popout);
      return;
    } catch (_errPrimary) {
      try {
        const popout = new ImagePopoutCtor({ src, title, shareable: false });
        popout.render(true);
        scheduleSsSharedJournalImageAutoHide(popout);
        return;
      } catch (_errFallback) {
        // fall through to dialog fallback below
      }
    }
  }

  if (globalThis.Dialog) {
    const safeSrc = escapeHtml(src);
    const safeTitle = escapeHtml(title);
    const dlg = new Dialog({
      title: safeTitle,
      content: `<div class="ss-shared-journal-image"><img src="${safeSrc}" alt="${safeTitle}" style="max-width:100%;height:auto;" /></div>`,
      buttons: {
        close: {
          label: "Close"
        }
      },
      default: "close"
    });
    dlg.render(true);
    scheduleSsSharedJournalImageAutoHide(dlg);
  }
}

function bindVanillaJournalImageShare(app, element) {
  try {
    if (!game.user?.isGM) return;
    if (!isSheetSidekickModuleActive()) return;

    const root = getRenderableRootElement(element);
    if (!(root instanceof HTMLElement)) return;
    if (ssJournalImageShareState.boundRoots.has(root)) return;

    const onClick = (event) => {
      handleJournalImageShareClick(event, app);
    };

    const iframeClick = (event) => {
      handleJournalImageShareClick(event, app);
    };

    const iframeDocs = [];
    root.querySelectorAll("iframe").forEach((frame) => {
      const frameDoc = frame?.contentDocument;
      if (!(frameDoc instanceof Document)) return;
      frameDoc.addEventListener("click", iframeClick, true);
      iframeDocs.push(frameDoc);
    });

    bindGlobalJournalImageShareListener();

    root.addEventListener("click", onClick, true);
    ssJournalImageShareState.boundRoots.add(root);
    app.once?.("close", () => {
      root.removeEventListener("click", onClick, true);
      iframeDocs.forEach((frameDoc) => frameDoc.removeEventListener("click", iframeClick, true));
      ssJournalImageShareState.boundRoots.delete(root);
    });
  } catch (err) {
    console.error("Sheet Sidekick journal image share bind failed:", err);
  }
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

const ssSpellPrepQueueByKey = globalThis.__SS_SPELL_PREP_QUEUE_BY_KEY__ ?? (globalThis.__SS_SPELL_PREP_QUEUE_BY_KEY__ = new Map());
const ssEquipPendingByKey = globalThis.__SS_EQUIP_PENDING_BY_KEY__ ?? (globalThis.__SS_EQUIP_PENDING_BY_KEY__ = new Map());

function getSsSpellPrepQueueKey(actorId, itemId) {
  return `${String(actorId ?? "").trim()}::${String(itemId ?? "").trim()}`;
}

function getSsItemActionButtons(actorId, itemId, action) {
  const aid = String(actorId ?? "").trim();
  const iid = String(itemId ?? "").trim();
  const act = String(action ?? "").trim();
  if (!aid || !iid || !act) return [];
  const escapedId = globalThis.CSS?.escape ? CSS.escape(iid) : iid.replace(/["\\]/g, "\\$&");
  const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR))
    .filter((form) => String(form?.dataset?.actorId ?? "") === aid);
  const buttons = [];
  forms.forEach((form) => {
    form.querySelectorAll(`li.item[data-item-id="${escapedId}"] .item-action[data-action="${act}"]`).forEach((btn) => {
      if (btn instanceof HTMLElement) buttons.push(btn);
    });
  });
  return buttons;
}

function getSsPrepareButtons(actorId, itemId) {
  const all = [
    ...getSsItemActionButtons(actorId, itemId, "prepare"),
    ...getSsItemActionButtons(actorId, itemId, "ssPrepareToggle")
  ];
  return Array.from(new Set(all));
}

function getSpellPreparationMethod(item) {
  const method = String(foundry.utils.getProperty(item, "system.method") ?? "").toLowerCase();
  if (method) return method;
  // Legacy/raw fallback without touching deprecated SpellData#preparation getter.
  const sourceMode = String(foundry.utils.getProperty(item, "_source.system.preparation.mode") ?? "").toLowerCase();
  if (sourceMode) return sourceMode;
  const snap = (typeof item?.toObject === "function") ? item.toObject(false) : null;
  return String(foundry.utils.getProperty(snap, "system.preparation.mode") ?? "").toLowerCase();
}

function getSpellPreparedState(item) {
  if (!item) return NaN;
  const direct = Number(foundry.utils.getProperty(item, "system.prepared"));
  if (Number.isFinite(direct)) return direct;
  const source = Number(foundry.utils.getProperty(item, "_source.system.prepared"));
  if (Number.isFinite(source)) return source;
  const snap = (typeof item?.toObject === "function") ? item.toObject(false) : null;
  return Number(foundry.utils.getProperty(snap, "system.prepared"));
}

function isAlwaysPreparedSpellItem(item) {
  if (!item || item.type !== "spell") return false;
  const alwaysState = Number(foundry.utils.getProperty(CONFIG, "DND5E.spellPreparationStates.always.value"));
  const fallbackAlwaysState = Number.isFinite(alwaysState) ? alwaysState : 2;
  const preparedState = getSpellPreparedState(item);
  if (Number.isFinite(preparedState) && preparedState === fallbackAlwaysState) return true;
  const prepMethod = getSpellPreparationMethod(item);
  return prepMethod === "always";
}

function isSpellPrepared(item) {
  if (foundry.utils.hasProperty(item, "system.prepared")) {
    return !!foundry.utils.getProperty(item, "system.prepared");
  }
  if (foundry.utils.hasProperty(item, "_source.system.preparation.prepared")) {
    return !!foundry.utils.getProperty(item, "_source.system.preparation.prepared");
  }
  const snap = (typeof item?.toObject === "function") ? item.toObject(false) : null;
  return !!foundry.utils.getProperty(snap, "system.preparation.prepared");
}

function setSsPrepareVisualState(actorId, itemId, prepared, pending = true) {
  getSsPrepareButtons(actorId, itemId).forEach((btn) => {
    btn.setAttribute("aria-pressed", String(!!prepared));
    btn.classList.toggle("active", !!prepared);
    btn.classList.toggle("ss-prepare-pending", !!pending);
    btn.classList.toggle("ss-action-pending", !!pending);
  });
}

function setSsEquipVisualPending(actorId, itemId, pending = true) {
  getSsItemActionButtons(actorId, itemId, "equip").forEach((btn) => {
    btn.classList.toggle("ss-equip-pending", !!pending);
    btn.classList.toggle("ss-action-pending", !!pending);
  });
}

function markSsEquipPending(actorId, itemId) {
  const aid = String(actorId ?? "").trim();
  const iid = String(itemId ?? "").trim();
  if (!aid || !iid) return;
  const key = getSsSpellPrepQueueKey(aid, iid);
  const existingTimer = ssEquipPendingByKey.get(key);
  if (existingTimer) window.clearTimeout(existingTimer);
  setSsEquipVisualPending(aid, iid, true);
  const timer = window.setTimeout(() => {
    ssEquipPendingByKey.delete(key);
    setSsEquipVisualPending(aid, iid, false);
  }, 2800);
  ssEquipPendingByKey.set(key, timer);
}

function clearSsEquipPending(actorId, itemId) {
  const aid = String(actorId ?? "").trim();
  const iid = String(itemId ?? "").trim();
  if (!aid || !iid) return;
  const key = getSsSpellPrepQueueKey(aid, iid);
  const existingTimer = ssEquipPendingByKey.get(key);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    ssEquipPendingByKey.delete(key);
  }
  setSsEquipVisualPending(aid, iid, false);
}

function queueSsSpellPrepareToggle({ actor, item, desiredPrepared }) {
  const actorId = String(actor?.id ?? "").trim();
  const itemId = String(item?.id ?? "").trim();
  if (!actorId || !itemId) return false;
  if (!getActiveGmIds().length) {
    showSsNoActiveGmDialog({ actionLabel: "Preparing/unpreparing spells" });
    return false;
  }
  const nextPrepared = !!desiredPrepared;
  const key = getSsSpellPrepQueueKey(actorId, itemId);
  const existing = ssSpellPrepQueueByKey.get(key) ?? { timer: null, clearTimer: null, desiredPrepared: null };
  existing.desiredPrepared = nextPrepared;
  if (existing.timer) window.clearTimeout(existing.timer);
  setSsPrepareVisualState(actorId, itemId, nextPrepared, true);
  restoreOpenSheetScrollForActor(actorId);

  existing.timer = window.setTimeout(() => {
    const state = ssSpellPrepQueueByKey.get(key);
    if (!state) return;
    const desired = !!state.desiredPrepared;
    const ts = Date.now();
    const sent = sendCommandToGmSocket("ssPrep", {
      actorId,
      itemId,
      prepared: desired,
      timestamp: ts,
      userId: game.user?.id ?? null
    });
    if (!sent) {
      sendCommandToGmWhisper(
        `!ss-prep ${actorId} ${itemId} ${desired ? "1" : "0"} ${ts} ${game.user?.id ?? ""}`,
        { includeSelf: true }
      );
    }
    state.timer = null;
    if (state.clearTimer) window.clearTimeout(state.clearTimer);
    state.clearTimer = window.setTimeout(() => {
      setSsPrepareVisualState(actorId, itemId, desired, false);
      restoreOpenSheetScrollForActor(actorId);
      const latest = ssSpellPrepQueueByKey.get(key);
      if (!latest) return;
      if (!latest.timer) ssSpellPrepQueueByKey.delete(key);
    }, 1100);
    ssSpellPrepQueueByKey.set(key, state);
  }, 25);

  ssSpellPrepQueueByKey.set(key, existing);
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

function formatSignedModifier(value) {
  const numeric = parseNumericValue(value);
  if (numeric === null) return "";
  return numeric >= 0 ? `+${numeric}` : `${numeric}`;
}

function resolveRollRequestModifier(actor, rollRequest) {
  if (!actor || !rollRequest) return { label: "Roll", kindLabel: "Roll", modifier: null };
  const kind = String(rollRequest.kind ?? "").trim().toLowerCase();
  const key = String(rollRequest.key ?? "").trim().toLowerCase();
  const rollData = actor?.getRollData?.() ?? {};
  const fallbackLabel = String(rollRequest.label ?? "Roll").trim() || "Roll";

  if (kind === "initiative") {
    return {
      label: "Initiative",
      kindLabel: "Initiative",
      modifier: pickFirstNumeric(
        actor?.system?.attributes?.init?.total,
        actor?.system?.attributes?.init?.mod,
        actor?.system?.attributes?.init?.value,
        rollData?.attributes?.init?.total,
        rollData?.attributes?.init?.mod,
        rollData?.attributes?.init?.value
      )
    };
  }

  if (kind === "skill") {
    const skill = actor?.system?.skills?.[key] ?? null;
    const label = String(skill?.label ?? fallbackLabel).trim() || fallbackLabel;
    return {
      label,
      kindLabel: "Check",
      modifier: pickFirstNumeric(
        skill?.total,
        skill?.mod,
        skill?.value,
        rollData?.skills?.[key]?.total,
        rollData?.skills?.[key]?.mod,
        rollData?.skills?.[key]?.value
      )
    };
  }

  if (kind === "tool") {
    const tool = actor?.system?.tools?.[key] ?? null;
    const toolItem = actor?.items?.get?.(String(rollRequest.key ?? "").trim()) ?? null;
    const label = String(toolItem?.name ?? fallbackLabel).trim() || fallbackLabel;
    return {
      label,
      kindLabel: "Check",
      modifier: pickFirstNumeric(
        tool?.total,
        tool?.mod,
        tool?.value,
        rollData?.tools?.[key]?.total,
        rollData?.tools?.[key]?.mod,
        rollData?.tools?.[key]?.value
      )
    };
  }

  if (kind === "abilitycheck" || kind === "abilitysave") {
    const ability = actor?.system?.abilities?.[key] ?? null;
    const abilityLabel = SS_ABILITY_LABELS[key] ?? fallbackLabel;
    if (kind === "abilitysave") {
      const saveTotal = pickFirstNumeric(ability?.save, rollData?.abilities?.[key]?.save);
      const saveBonus = pickFirstNumeric(ability?.saveBonus, rollData?.abilities?.[key]?.saveBonus);
      const baseMod = pickFirstNumeric(ability?.mod, rollData?.abilities?.[key]?.mod);
      return {
        label: `${abilityLabel} Save`,
        kindLabel: "Save",
        modifier: saveTotal ?? ((baseMod !== null || saveBonus !== null) ? ((baseMod ?? 0) + (saveBonus ?? 0)) : null)
      };
    }
    return {
      label: `${abilityLabel} Check`,
      kindLabel: "Check",
      modifier: pickFirstNumeric(ability?.mod, rollData?.abilities?.[key]?.mod)
    };
  }

  return { label: fallbackLabel, kindLabel: "Roll", modifier: null };
}

function buildRollRequestHint(actor, rollRequest) {
  const meta = resolveRollRequestModifier(actor, rollRequest);
  const signedMod = formatSignedModifier(meta.modifier);
  if (signedMod) {
    return `${meta.kindLabel}: ${meta.label} (d20 ${signedMod})`;
  }
  return `${meta.kindLabel}: ${meta.label} (d20 + your normal modifier)`;
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
  const suggestedRoll = buildRollRequestHint(actor, rollRequest);
  const rollHintsHtml = buildRollHintsHtml([suggestedRoll], {
    title: "Suggested Roll Check",
    helperText: "This is a prompt only. Roll the check below and add the shown modifier."
  });
  const title = "Roll Check?";
  const content = `
    <section class="ss-use-confirm">
      <header class="ss-use-confirm-header">
        <span class="ss-hint-icon-wrap"><img class="ss-hint-icon" src="${escapeHtml(SS_HINT_ICONS.save)}" alt=""></span>
        <p class="ss-use-confirm-title">Roll <strong>${escapeHtml(label)}</strong> for <strong>${escapeHtml(actor.name ?? "Actor")}</strong>?</p>
      </header>
      <div class="ss-roll-hints-wrap">${rollHintsHtml}</div>
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

  return { confirmed: !!globalThis.confirm?.(`Roll ${label}?\n${suggestedRoll}`) };
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

function getSsShortRestHitDiceData(actor) {
  const hd = actor?.system?.attributes?.hd ?? null;
  if (!hd) return { total: 0, entries: [], summary: "No hit dice available." };

  const entries = [];
  if (hd?.bySize && typeof hd.bySize === "object") {
    Object.entries(hd.bySize).forEach(([denom, amount]) => {
      const count = Number(amount ?? 0);
      const label = String(denom ?? "").trim();
      if (!label || !Number.isFinite(count) || count <= 0) return;
      entries.push({ denomination: label, count, label: `${label} x${count}` });
    });
  }

  if (!entries.length) {
    const total = Number(hd?.value ?? 0);
    const denomNumber = Number(hd?.denomination ?? 0);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(denomNumber) && denomNumber > 0) {
      const label = `d${denomNumber}`;
      entries.push({ denomination: label, count: total, label: `${label} x${total}` });
    }
  }

  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return {
    total,
    entries,
    summary: entries.length ? entries.map((entry) => entry.label).join(", ") : "No hit dice available."
  };
}

function getSsRestButtonLabel(restType) {
  return String(restType ?? "").trim().toLowerCase() === "long" ? "Long Rest" : "Short Rest";
}

function buildSsRestButtonHtml(restType) {
  const normalized = String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short";
  const iconClass = normalized === "long" ? "fa-tent" : "fa-campfire";
  const label = getSsRestButtonLabel(normalized);
  return `
    <button
      type="button"
      class="ss-rest-trigger"
      data-ss-rest="${escapeHtml(normalized)}"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
    >
      <i class="fas ${escapeHtml(iconClass)}" aria-hidden="true"></i>
      <span class="ss-rest-trigger-label">${escapeHtml(label)}</span>
    </button>
  `;
}

function ensureSheetSidekickRestButtons(scope, actor) {
  if (!(scope instanceof HTMLElement) || !actor || actor.type !== "character") return;

  const buttonsBar = scope.querySelector(".sheet-header .sheet-header-buttons");
  if (!(buttonsBar instanceof HTMLElement)) return;

  const nativeShort = buttonsBar.querySelector("button[data-action='shortRest'], button[aria-label*='Short Rest']");
  const nativeLong = buttonsBar.querySelector("button[data-action='longRest'], button[aria-label*='Long Rest']");
  const wrap = buttonsBar.querySelector(".ss-rest-actions");

  if (!(nativeShort instanceof HTMLElement) && !(nativeLong instanceof HTMLElement)) {
    wrap?.remove();
    return;
  }

  [nativeShort, nativeLong].forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    btn.classList.add("ss-native-rest-btn");
    btn.setAttribute("aria-hidden", "true");
    btn.tabIndex = -1;
  });

  const targetWrap = wrap instanceof HTMLElement ? wrap : document.createElement("div");
  targetWrap.className = "ss-rest-actions";
  targetWrap.innerHTML = [
    nativeShort instanceof HTMLElement ? buildSsRestButtonHtml("short") : "",
    nativeLong instanceof HTMLElement ? buildSsRestButtonHtml("long") : ""
  ].join("");

  const logoutBtn = buttonsBar.querySelector("button.ss-header-logout-btn");
  if (!targetWrap.parentElement) {
    if (logoutBtn instanceof HTMLElement) buttonsBar.insertBefore(targetWrap, logoutBtn);
    else buttonsBar.appendChild(targetWrap);
  } else if (logoutBtn instanceof HTMLElement && targetWrap.nextElementSibling !== logoutBtn) {
    buttonsBar.insertBefore(targetWrap, logoutBtn);
  }
}

function buildSsRestPrompt(actor, restType) {
  const normalized = String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short";
  const label = getSsRestButtonLabel(normalized);
  const actorName = String(actor?.name ?? "Actor").trim() || "Actor";
  const dialogKey = `${actor?.id ?? "actor"}:${normalized}:${Date.now()}`;
  const conMod = pickFirstNumeric(
    actor?.system?.abilities?.con?.mod,
    actor?.getRollData?.()?.abilities?.con?.mod
  );
  const signedCon = formatSignedModifier(conMod);
  const hitDice = getSsShortRestHitDiceData(actor);
  const iconClass = normalized === "long" ? "fa-tent" : "fa-campfire";

  const overviewLines = normalized === "long"
    ? [
      "The GM will run the normal D&D5e long-rest workflow for this character.",
      "Hit points, spell slots, hit dice, and other resources recover according to your world's configured rest rules."
    ]
    : [
      "The GM will run the normal D&D5e short-rest workflow for this character.",
      hitDice.total > 0
        ? `You can spend hit dice to heal during that workflow. Available hit dice: ${hitDice.summary}.`
        : "You currently do not have any hit dice available to spend during the short rest workflow."
    ];

  const hintCards = normalized === "long"
    ? [
      "Workflow: Long-rest recovery uses your world's configured D&D5e rules.",
      "Resources: Spell slots, hit points, and long-rest features recover if allowed by those rules."
    ]
    : [
      `Hit Dice: ${hitDice.summary}`,
      `Healing: Each hit die spent adds Constitution ${signedCon || "+0"} to the roll.`,
      "Resources: Short-rest features and item uses recover if your world rules allow it."
    ];

  const helperText = normalized === "long"
    ? "This sends a rest request to the GM for this character."
    : "This sends a short-rest request to the GM, then the normal short-rest workflow handles hit dice.";
  const rollHintsHtml = buildRollHintsHtml(hintCards, {
    title: `${label} Summary`,
    helperText
  });
  const bodyHtml = overviewLines.map((line) => `<p class="ss-rest-confirm-copy">${escapeHtml(line)}</p>`).join("");

  const content = `
    <section class="ss-use-confirm ss-rest-confirm" data-ss-hints-key="${escapeHtml(dialogKey)}">
      <header class="ss-use-confirm-header">
        <span class="ss-rest-confirm-icon" aria-hidden="true"><i class="fas ${escapeHtml(iconClass)}"></i></span>
        <div class="ss-use-confirm-title-row">
          <p class="ss-use-confirm-title">Start <strong>${escapeHtml(label)}</strong> for <strong>${escapeHtml(actorName)}</strong>?</p>
        </div>
      </header>
      <div class="ss-use-confirm-body">
        <div class="ss-rest-confirm-copy-wrap">${bodyHtml}</div>
        <div class="ss-roll-hints-wrap">${rollHintsHtml}</div>
      </div>
    </section>
  `;

  return { dialogKey, label, content };
}

async function confirmSsRest(actor, restType) {
  if (!actor) return { confirmed: false, restType: "short" };
  const normalized = String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short";
  const prompt = buildSsRestPrompt(actor, normalized);
  const fallbackText = normalized === "long"
    ? "The GM will run the normal long-rest workflow for this character."
    : "The GM will run the normal short-rest workflow for this character, including hit-die spending if available.";

  if (globalThis.Dialog?.confirm) {
    const resultPromise = Dialog.confirm({
      title: prompt.label,
      content: prompt.content,
      yes: () => ({ confirmed: true, restType: normalized }),
      no: () => ({ confirmed: false, restType: normalized }),
      defaultYes: false
    }, {
      width: 560,
      classes: ["ss-use-confirm-dialog", "ss-rest-confirm-dialog"]
    });

    window.setTimeout(() => {
      const scope = document.querySelector(`.ss-rest-confirm[data-ss-hints-key='${prompt.dialogKey}']`);
      const dialogRoot = scope?.closest?.(".app.window-app.dialog, dialog.application");
      if (dialogRoot instanceof HTMLElement) dialogRoot.classList.add("ss-use-confirm-dialog", "ss-rest-confirm-dialog");
      setupUseConfirmScrollCue(prompt.dialogKey);
    }, 40);

    const result = await resultPromise;
    const openScope = document.querySelector(`.ss-rest-confirm[data-ss-hints-key='${prompt.dialogKey}']`);
    const openRoot = openScope?.closest?.(".app.window-app.dialog, dialog.application");
    if (openRoot?.__ssUseConfirmScrollCueCleanup instanceof Function) {
      try { openRoot.__ssUseConfirmScrollCueCleanup(); } catch (_err) { /* noop */ }
      delete openRoot.__ssUseConfirmScrollCueCleanup;
    }
    if (result && typeof result === "object" && "confirmed" in result) return result;
    return { confirmed: !!result, restType: normalized };
  }

  return {
    confirmed: !!globalThis.confirm?.(`${prompt.label}?\n${fallbackText}`),
    restType: normalized
  };
}

function sendRestInfoToGmWhisper(actor, restType) {
  const gms = getActiveGmIds();
  if (!gms.length) return false;
  if (!actor) return false;

  const normalized = String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short";
  const label = getSsRestButtonLabel(normalized);
  const hitDice = normalized === "short" ? getSsShortRestHitDiceData(actor) : null;
  const detailLine = normalized === "short"
    ? `<p><strong>Available Hit Dice:</strong> ${escapeHtml(hitDice?.summary ?? "None")}</p>`
    : "";
  const content = `
    <section class="ss-use-gm-whisper">
      <p><strong>[Sheet Sidekick REST]</strong> ${escapeHtml(String(actor.name ?? "Actor"))} requested <strong>${escapeHtml(label)}</strong></p>
      ${detailLine}
    </section>
  `;
  ChatMessage.create({ content, whisper: gms }).catch((err) => {
    console.error("Sheet Sidekick rest info whisper failed:", err);
  });
  return true;
}

function queueSsPendingRestDialogLabel(actor, restType) {
  const actorId = String(actor?.id ?? "").trim();
  if (!actorId) return;
  ssPendingRestDialogLabels.push({
    actorId,
    actorName: String(actor?.name ?? "Actor").trim() || "Actor",
    restType: String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short",
    expiresAt: Date.now() + 15000
  });
  while (ssPendingRestDialogLabels.length > 8) ssPendingRestDialogLabels.shift();
}

function consumeSsPendingRestDialogLabel(actorId, restType) {
  const now = Date.now();
  for (let i = ssPendingRestDialogLabels.length - 1; i >= 0; i -= 1) {
    if (Number(ssPendingRestDialogLabels[i]?.expiresAt ?? 0) <= now) {
      ssPendingRestDialogLabels.splice(i, 1);
    }
  }
  const aid = String(actorId ?? "").trim();
  const normalized = String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short";
  const idx = ssPendingRestDialogLabels.findIndex((entry) => entry.actorId === aid && entry.restType === normalized);
  if (idx < 0) return null;
  return ssPendingRestDialogLabels.splice(idx, 1)[0] ?? null;
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

function extractPlainTextFromHtml(html) {
  const raw = String(html ?? "").trim();
  if (!raw) return "";
  const root = document.createElement("div");
  root.innerHTML = raw;
  return String(root.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pickFirstMeaningfulHtml(candidates = []) {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw) continue;
    if (extractPlainTextFromHtml(raw).length > 0) return raw;
  }
  return "";
}

async function getFallbackItemDescriptionHtml(uuid = "") {
  const id = String(uuid ?? "").trim();
  if (!id) return "";

  let item = null;
  try {
    item = await fromUuid(id);
  } catch (_err) {
    item = null;
  }
  if (!item || item.documentName !== "Item") return "";

  const system = item.system?.toObject?.() ?? item.system ?? {};
  const desc = system?.description ?? {};
  const candidates = [];
  if (typeof desc === "string") candidates.push(desc);
  else if (desc && typeof desc === "object") {
    candidates.push(
      desc.value,
      desc.chat,
      desc.unidentified,
      desc.public,
      desc.publicNotes,
      desc.gm,
      desc.gmNotes
    );
  }

  const activities = getSsItemActivities(item);
  for (const activity of activities) {
    const a = activity?.toObject?.() ?? activity ?? {};
    const ad = a?.description ?? {};
    if (typeof ad === "string") candidates.push(ad);
    else if (ad && typeof ad === "object") candidates.push(ad.value, ad.chat);
  }

  const raw = pickFirstMeaningfulHtml(candidates);
  if (!raw) return "";

  let enriched = raw;
  try {
    enriched = await TextEditor.enrichHTML(raw, {
      async: true,
      secrets: false,
      rollData: item?.parent?.getRollData?.() ?? {}
    });
  } catch (_err) {
    enriched = raw;
  }

  return `
    <section class="ss-fallback-item-description">
      <h3>Description</h3>
      <div class="description">${enriched}</div>
    </section>
  `;
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

function setupUseConfirmScrollCue(dialogKey) {
  const scope = document.querySelector(`.ss-use-confirm[data-ss-hints-key='${dialogKey}']`);
  if (!(scope instanceof HTMLElement)) return;

  const root = scope.closest(".app.window-app.dialog, dialog.application");
  if (!(root instanceof HTMLElement)) return;

  const scroller = root.querySelector("section.window-content > .dialog-content")
    ?? root.querySelector(".window-content > .dialog-content")
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

  if (root.__ssUseConfirmScrollCueCleanup instanceof Function) {
    try { root.__ssUseConfirmScrollCueCleanup(); } catch (_err) { /* noop */ }
  }
  root.__ssUseConfirmScrollCueCleanup = () => {
    scroller.removeEventListener("scroll", update);
    root.classList.remove("ss-has-scroll-more");
  };

  window.setTimeout(update, 80);
  window.setTimeout(update, 180);
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
  let bodyHtml = renderedContent?.innerHTML?.trim()
    ? renderedContent.innerHTML
    : "<p>No details available.</p>";
  const fallbackDescriptionHtml = await getFallbackItemDescriptionHtml(uuid);
  if (fallbackDescriptionHtml) {
    const probe = document.createElement("div");
    probe.innerHTML = bodyHtml;
    const descNode = probe.querySelector(".description, .item-description, .details .description");
    const descText = String(descNode?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!descNode || descText.length < 6 || /no details available/i.test(extractPlainTextFromHtml(bodyHtml))) {
      bodyHtml = `${bodyHtml}${fallbackDescriptionHtml}`;
    }
  }
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
  const prepMode = getSpellPreparationMethod(item);
  const isAlwaysPrepared = isAlwaysPreparedSpellItem(item);
  const isPrepared = isSpellPrepared(item);
  if (isAlwaysPrepared || prepMode === "always") return true; // include Always Prepared
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
const ssTargetUiSyncEmitState = globalThis.__SS_TARGET_UI_SYNC_EMIT_STATE__ ?? (globalThis.__SS_TARGET_UI_SYNC_EMIT_STATE__ = {
  timer: null,
  sceneId: ""
});
const ssDpadViewportEmitState = globalThis.__SS_DPAD_VIEWPORT_EMIT_STATE__ ?? (globalThis.__SS_DPAD_VIEWPORT_EMIT_STATE__ = {
  timer: null,
  sceneId: ""
});
const ssActorScrollRestoreQueue = globalThis.__SS_ACTOR_SCROLL_RESTORE_QUEUE__ ?? (globalThis.__SS_ACTOR_SCROLL_RESTORE_QUEUE__ = new Map());
const ssActorScrollRestoreEpoch = globalThis.__SS_ACTOR_SCROLL_RESTORE_EPOCH__ ?? (globalThis.__SS_ACTOR_SCROLL_RESTORE_EPOCH__ = new Map());
const ssScrollTraceState = globalThis.__SS_SCROLL_TRACE_STATE__ ?? (globalThis.__SS_SCROLL_TRACE_STATE__ = {
  enabled: false,
  max: 300,
  events: []
});
const ssSheetAnchorState = globalThis.__SS_SHEET_ANCHOR_STATE__ ?? (globalThis.__SS_SHEET_ANCHOR_STATE__ = new Map());
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

function applyTargetsForCurrentGmUser(tokenIds, { sceneId = "" } = {}) {
  if (!game.user?.isGM) return [];
  if (!canvas?.ready) return [];

  const validIds = Array.from(new Set(
    (Array.isArray(tokenIds) ? tokenIds : [])
      .map((id) => String(id))
      .filter((id) => !!canvas.tokens?.get?.(id))
  ));

  try {
    if (typeof game.user.updateTokenTargets === "function") game.user.updateTokenTargets(validIds);
    else if (typeof game.user._onUpdateTokenTargets === "function") game.user._onUpdateTokenTargets(validIds);
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
    const sid = String(sceneId ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
    game.user.broadcastActivity?.({
      targets: validIds,
      scene: sid || undefined,
      sceneId: sid || undefined
    });
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

function describeSsElementForTrace(el) {
  if (!(el instanceof HTMLElement)) return "";
  const bits = [el.tagName.toLowerCase()];
  if (el.id) bits.push(`#${el.id}`);
  const cls = String(el.className ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
  if (cls.length) bits.push(`.${cls.join(".")}`);
  return bits.join("");
}

function recordSsScrollTrace(type, details = {}) {
  if (!ssScrollTraceState.enabled) return;
  const ae = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const entry = {
    t: new Date().toISOString(),
    type: String(type ?? ""),
    winY: Number(window.scrollY ?? window.pageYOffset ?? 0),
    winX: Number(window.scrollX ?? window.pageXOffset ?? 0),
    active: describeSsElementForTrace(ae),
    ...details
  };
  ssScrollTraceState.events.push(entry);
  if (ssScrollTraceState.events.length > ssScrollTraceState.max) {
    ssScrollTraceState.events.splice(0, ssScrollTraceState.events.length - ssScrollTraceState.max);
  }
}

function getSsScrollTraceSnapshotForScope(scope) {
  if (!(scope instanceof HTMLElement)) return null;
  const map = getSheetScrollElementMap(scope);
  const out = {};
  for (const [key, el] of Object.entries(map)) {
    if (!el) continue;
    out[key] = Number(el.scrollTop ?? 0);
  }
  return {
    actorId: String(scope.dataset?.actorId ?? ""),
    scope: describeSsElementForTrace(scope),
    tabs: scope.querySelector(".tab.active")?.getAttribute?.("data-tab") ?? "",
    tops: out
  };
}

globalThis.ssEnableScrollTrace = (enabled = true) => {
  ssScrollTraceState.enabled = !!enabled;
  if (enabled) ssScrollTraceState.events = [];
  console.info(`[Sheet Sidekick] scroll trace ${enabled ? "enabled" : "disabled"}.`);
  return ssScrollTraceState.enabled;
};

globalThis.ssGetScrollTrace = () => ssScrollTraceState.events.slice();
globalThis.ssPrintScrollTrace = (limit = 80) => {
  const n = Math.max(1, Number(limit) || 80);
  const rows = ssScrollTraceState.events.slice(-n);
  try {
    console.table(rows);
  } catch (_err) {
    console.log(rows);
  }
  return rows;
};
globalThis.ssScrollTraceToJson = (limit = 200) => {
  const n = Math.max(1, Number(limit) || 200);
  return JSON.stringify(ssScrollTraceState.events.slice(-n), null, 2);
};

function findSsScrollableAncestor(start, scope) {
  let el = start instanceof HTMLElement ? start : null;
  const stop = scope instanceof HTMLElement ? scope : null;
  while (el && el !== stop) {
    const cs = window.getComputedStyle(el);
    const overflowY = String(cs.overflowY ?? "").toLowerCase();
    const scrollableY = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (scrollableY && (el.scrollHeight - el.clientHeight > 2)) return el;
    el = el.parentElement;
  }
  return stop;
}

function saveSheetAnchor(scope, actor) {
  if (!(scope instanceof HTMLElement) || !actor) return;
  const key = getSheetScrollKey(actor);
  const activeTab = scope.querySelector(".tab.active");
  if (!(activeTab instanceof HTMLElement)) {
    ssSheetAnchorState.delete(key);
    return;
  }

  const rows = Array.from(activeTab.querySelectorAll("li.item[data-item-id]"));
  if (!rows.length) {
    ssSheetAnchorState.delete(key);
    return;
  }

  const viewport = scope.querySelector(".window-content") ?? scope;
  const vpRect = viewport.getBoundingClientRect();
  const topEdge = vpRect.top + 6;
  const bottomEdge = vpRect.bottom - 6;
  const row = rows.find((r) => {
    const rect = r.getBoundingClientRect();
    return rect.bottom > topEdge && rect.top < bottomEdge;
  }) ?? rows[0];
  if (!(row instanceof HTMLElement)) {
    ssSheetAnchorState.delete(key);
    return;
  }

  const container = findSsScrollableAncestor(row, scope);
  const cRect = (container instanceof HTMLElement ? container : viewport).getBoundingClientRect();
  const rRect = row.getBoundingClientRect();
  const offsetTop = rRect.top - cRect.top;
  const anchor = {
    tab: String(activeTab.dataset?.tab ?? ""),
    itemId: String(row.dataset?.itemId ?? ""),
    offsetTop: Number(offsetTop) || 0
  };
  ssSheetAnchorState.set(key, anchor);
  recordSsScrollTrace("saveSheetAnchor", {
    actorId: String(actor?.id ?? ""),
    anchor
  });
}

function restoreSheetAnchor(scope, actor) {
  if (!(scope instanceof HTMLElement) || !actor) return;
  const key = getSheetScrollKey(actor);
  const anchor = ssSheetAnchorState.get(key);
  if (!anchor) return;

  const activeTab = scope.querySelector(".tab.active");
  if (!(activeTab instanceof HTMLElement)) return;
  const anchorTab = String(anchor.tab ?? "");
  if (anchorTab && String(activeTab.dataset?.tab ?? "") !== anchorTab) return;

  const itemId = String(anchor.itemId ?? "").trim();
  if (!itemId) return;
  const escaped = globalThis.CSS?.escape ? CSS.escape(itemId) : itemId.replace(/["\\]/g, "\\$&");
  const row = activeTab.querySelector(`li.item[data-item-id="${escaped}"]`);
  if (!(row instanceof HTMLElement)) return;

  const container = findSsScrollableAncestor(row, scope);
  if (!(container instanceof HTMLElement)) return;

  const cRect = container.getBoundingClientRect();
  const rRect = row.getBoundingClientRect();
  const currentOffset = rRect.top - cRect.top;
  const desiredOffset = Number(anchor.offsetTop ?? currentOffset);
  const delta = currentOffset - desiredOffset;
  if (Math.abs(delta) < 1) return;

  container.scrollTop += delta;
  recordSsScrollTrace("restoreSheetAnchor", {
    actorId: String(actor?.id ?? ""),
    itemId,
    delta
  });
}

function getSheetScrollElementMap(scope) {
  return {
    windowContent: scope.querySelector(".window-content"),
    tabBody: scope.querySelector(".sheet-body .tab-body"),
    sheetBody: scope.querySelector(".sheet-body"),
    activeTab: scope.querySelector(".tab.active"),
    itemsList: scope.querySelector(".items-list"),
    scope
  };
}

function resolveActorFromSheetScope(scope, app = null) {
  const appActor = app?.actor ?? null;
  if (appActor) return appActor;
  if (!(scope instanceof HTMLElement)) return null;

  const directId = String(
    scope.dataset?.actorId
    ?? scope.getAttribute?.("data-actor-id")
    ?? scope.querySelector?.("[data-actor-id]")?.getAttribute?.("data-actor-id")
    ?? scope.querySelector?.("input[name='actorId']")?.value
    ?? ""
  ).trim();
  if (directId) {
    const actor = game.actors?.get?.(directId) ?? null;
    if (actor) return actor;
  }

  const windows = Object.values(ui.windows ?? {});
  for (const win of windows) {
    const actor = win?.actor ?? null;
    if (!actor) continue;
    const el = win?.element?.[0] ?? null;
    if (!(el instanceof HTMLElement)) continue;
    if (el === scope || el.contains(scope) || scope.contains(el)) return actor;
  }
  return null;
}

function getSheetScrollElements(scope) {
  const elements = Object.values(getSheetScrollElementMap(scope)).filter(Boolean);

  // De-duplicate while preserving order.
  return Array.from(new Set(elements));
}

function saveSheetScroll(scope, actor) {
  const elementMap = getSheetScrollElementMap(scope);
  const positions = {};
  for (const [key, el] of Object.entries(elementMap)) {
    if (!el) continue;
    positions[key] = {
      top: Number(el.scrollTop ?? 0),
      left: Number(el.scrollLeft ?? 0)
    };
  }
  ssSheetScrollState.set(getSheetScrollKey(actor), {
    positions,
    viewport: {
      x: Number(window.scrollX ?? window.pageXOffset ?? 0),
      y: Number(window.scrollY ?? window.pageYOffset ?? 0)
    }
  });
  saveSheetAnchor(scope, actor);
  recordSsScrollTrace("saveSheetScroll", {
    actorId: String(actor?.id ?? ""),
    snap: getSsScrollTraceSnapshotForScope(scope)
  });
}

function restoreSheetScroll(scope, actor) {
  const state = ssSheetScrollState.get(getSheetScrollKey(actor));
  if (!state) return;

  const elementMap = getSheetScrollElementMap(scope);
  const hasMapped = state.positions && typeof state.positions === "object";
  const elements = getSheetScrollElements(scope);
  if (!hasMapped && !elements.length) return;

  const apply = () => {
    if (hasMapped) {
      for (const [key, snap] of Object.entries(state.positions)) {
        const el = elementMap[key];
        if (!el || !snap) continue;
        el.scrollTop = Number(snap.top ?? 0);
        el.scrollLeft = Number(snap.left ?? 0);
      }
      if (state.viewport) {
        try {
          window.scrollTo(Number(state.viewport.x ?? 0), Number(state.viewport.y ?? 0));
        } catch (_err) {
          // noop
        }
      }
    } else {
      // Legacy fallback for old shape.
      elements.forEach((el, i) => {
        const snap = state.elements?.[i];
        if (!snap) return;
        el.scrollTop = Number(snap.top ?? 0);
        el.scrollLeft = Number(snap.left ?? 0);
      });
    }
    recordSsScrollTrace("restoreSheetScroll.apply", {
      actorId: String(actor?.id ?? ""),
      snap: getSsScrollTraceSnapshotForScope(scope)
    });
    restoreSheetAnchor(scope, actor);
  };

  requestAnimationFrame(() => {
    apply();
  });
  recordSsScrollTrace("restoreSheetScroll.schedule", {
    actorId: String(actor?.id ?? ""),
    snap: getSsScrollTraceSnapshotForScope(scope)
  });
}

function restoreOpenSheetScrollForActor(actorId) {
  const aid = String(actorId ?? "").trim();
  if (!aid) return;
  const actor = game.actors?.get?.(aid) ?? null;
  if (!actor) return;
  const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR))
    .filter((form) => String(form?.dataset?.actorId ?? "") === aid);
  forms.forEach((form) => restoreSheetScroll(form, actor));
}

function saveOpenSheetScrollForActor(actorId) {
  const aid = String(actorId ?? "").trim();
  if (!aid) return;
  const actor = game.actors?.get?.(aid) ?? null;
  if (!actor) return;
  const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR))
    .filter((form) => String(form?.dataset?.actorId ?? "") === aid);
  forms.forEach((form) => saveSheetScroll(form, actor));
}

function scheduleOpenSheetScrollRestore(actorId, delays = [0, 120], epoch = null) {
  const aid = String(actorId ?? "").trim();
  if (!aid) return;
  const actor = game.actors?.get?.(aid) ?? null;
  if (!actor) return;

  const run = () => {
    if (epoch !== null && ssActorScrollRestoreEpoch.get(aid) !== epoch) return;
    const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR))
      .filter((form) => String(form?.dataset?.actorId ?? "") === aid);
    forms.forEach((form) => {
      restoreSheetScroll(form, actor);
      restoreSheetAnchor(form, actor);
    });
  };

  for (const delay of delays) {
    window.setTimeout(run, Number(delay) || 0);
  }
}

function queueOpenSheetScrollRestore(actorId, delayMs = 40) {
  const aid = String(actorId ?? "").trim();
  if (!aid) return;
  const prior = ssActorScrollRestoreQueue.get(aid);
  if (prior) window.clearTimeout(prior);
  const nextEpoch = Number(ssActorScrollRestoreEpoch.get(aid) ?? 0) + 1;
  ssActorScrollRestoreEpoch.set(aid, nextEpoch);
  recordSsScrollTrace("queueOpenSheetScrollRestore", { actorId: aid, delayMs: Number(delayMs) || 0 });
  const timer = window.setTimeout(() => {
    ssActorScrollRestoreQueue.delete(aid);
    if (ssActorScrollRestoreEpoch.get(aid) !== nextEpoch) return;
    recordSsScrollTrace("queueOpenSheetScrollRestore.fire", { actorId: aid, epoch: nextEpoch });
    scheduleOpenSheetScrollRestore(aid, [0, 120], nextEpoch);
  }, Math.max(0, Number(delayMs) || 0));
  ssActorScrollRestoreQueue.set(aid, timer);
}

function saveAllOpenSheetScrolls() {
  const forms = Array.from(document.querySelectorAll(SS_SHEET_FORM_SELECTOR));
  for (const form of forms) {
    if (!(form instanceof HTMLElement)) continue;
    const actor = resolveActorFromSheetScope(form, null);
    if (!actor) continue;
    if (!form.dataset.actorId) form.dataset.actorId = String(actor.id ?? "");
    saveSheetScroll(form, actor);
  }
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

    if (Date.now() >= ssUiEnsureState.stopAt || ssUiEnsureState.stableTicks >= 3) {
      window.clearInterval(ssUiEnsureState.timer);
      ssUiEnsureState.timer = null;
      ssUiEnsureState.stableTicks = 0;
    }
  }, 900);
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

function getSsTokenLinkAction(anchor) {
  if (!(anchor instanceof HTMLElement)) return "";

  const explicit = String(
    anchor.dataset.ssAction
    ?? anchor.dataset.ssTokenAction
    ?? ""
  ).trim().toLowerCase();

  if (["show", "reveal", "enable", "unhide", "visible"].includes(explicit)) return "show";
  if (["hide", "conceal", "disable", "hidden"].includes(explicit)) return "hide";
  if (explicit === "toggle") return "toggle";

  const label = String(anchor.textContent ?? "").trim().toLowerCase();
  if (/^(show|reveal|enable|unhide)\b/.test(label)) return "show";
  if (/^(hide|conceal|disable)\b/.test(label)) return "hide";
  if (/^toggle\b/.test(label)) return "toggle";

  return "";
}

function findSsTokenDocOnScene(sceneDoc, tokenId = "") {
  const tid = String(tokenId ?? "").trim();
  if (!sceneDoc || !tid) return null;
  if (typeof sceneDoc.tokens?.get === "function") return sceneDoc.tokens.get(tid) ?? null;
  return Array.from(sceneDoc.tokens?.contents ?? sceneDoc.tokens ?? [])
    .find((tokenDoc) => String(tokenDoc?.id ?? "").trim() === tid) ?? null;
}

function findSsTokenDocById(tokenId = "", sceneId = "") {
  const tid = String(tokenId ?? "").trim();
  const sid = String(sceneId ?? "").trim();
  if (!tid) return { tokenDoc: null, ambiguous: false };

  if (sid) {
    const sceneDoc = game.scenes?.get?.(sid)
      ?? (String(game.scenes?.viewed?.id ?? "").trim() === sid ? game.scenes?.viewed ?? null : null);
    return { tokenDoc: findSsTokenDocOnScene(sceneDoc, tid), ambiguous: false };
  }

  const matches = [];
  for (const sceneDoc of (game.scenes ?? [])) {
    const tokenDoc = findSsTokenDocOnScene(sceneDoc, tid);
    if (!tokenDoc) continue;
    matches.push(tokenDoc);
    if (matches.length > 1) break;
  }

  return {
    tokenDoc: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1
  };
}

function getSsSceneTokenUuidParts(uuid = "") {
  const raw = String(uuid ?? "").trim();
  const match = raw.match(/^(Scene\.[^.]+\.Token\.[^.]+)(?:\.|$)/);
  if (!match) return null;

  const parts = match[1].split(".");
  return {
    rootUuid: match[1],
    sceneId: String(parts[1] ?? "").trim(),
    tokenId: String(parts[3] ?? "").trim()
  };
}

function getSsTokenVisibilityLinkRequest(anchor) {
  if (!(anchor instanceof HTMLElement)) return null;

  const action = getSsTokenLinkAction(anchor);
  if (!action) return null;

  const tokenUuid = String(
    anchor.dataset.ssTokenUuid
    ?? anchor.dataset.uuid
    ?? anchor.getAttribute("data-uuid")
    ?? ""
  ).trim();
  const tokenUuidParts = getSsSceneTokenUuidParts(tokenUuid);
  if (tokenUuidParts) {
    return {
      action,
      requested: true,
      tokenUuid: tokenUuidParts.rootUuid,
      tokenId: tokenUuidParts.tokenId,
      sceneId: tokenUuidParts.sceneId
    };
  }

  const tokenId = String(anchor.dataset.ssTokenId ?? "").trim();
  if (!tokenId) return null;

  return {
    action,
    requested: true,
    tokenUuid: "",
    tokenId,
    sceneId: String(anchor.dataset.ssSceneId ?? "").trim()
  };
}

async function resolveSsTokenVisibilityLink(request) {
  if (!request?.requested) {
    return { tokenDoc: null, ambiguous: false, requested: false };
  }

  if (request.tokenUuid) {
    const tokenDoc = await fromUuid(request.tokenUuid);
    const isTokenDoc = tokenDoc instanceof TokenDocument || tokenDoc?.documentName === "Token";
    return {
      tokenDoc: isTokenDoc ? tokenDoc : null,
      ambiguous: false,
      requested: true
    };
  }

  const resolved = findSsTokenDocById(request.tokenId, request.sceneId);
  return {
    ...resolved,
    requested: true
  };
}

async function handleSsTokenVisibilityLink(event) {
  const anchor = event.target?.closest?.("a.entity-link, a.content-link, a[data-ss-token-id], a[data-ss-token-uuid]");
  if (!(anchor instanceof HTMLElement)) return false;

  const request = getSsTokenVisibilityLinkRequest(anchor);
  if (!request) return false;

  // Cancel the journal/entity-link click immediately so Foundry does not
  // open the token actor sheet before our visibility action runs.
  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();

  const { tokenDoc, ambiguous, requested } = await resolveSsTokenVisibilityLink(request);
  if (!requested) return false;

  if (ambiguous) {
    ui.notifications.warn("Multiple tokens matched that ID. Add data-ss-scene-id or use a full token UUID link.");
    return true;
  }

  if (!tokenDoc) {
    ui.notifications.warn("Could not find that token.");
    return true;
  }

  const isHidden = !!tokenDoc.hidden;
  const nextHidden = request.action === "toggle" ? !isHidden : request.action === "hide";
  if (nextHidden === isHidden) return true;

  await tokenDoc.update({ hidden: nextHidden });
  debugLog(`${nextHidden ? "🙈 Hid" : "👁️ Revealed"} token: ${tokenDoc.name ?? tokenDoc.id}`);
  return true;
}

// Shows/hides scene tokens from journal quick links.
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  document.body.addEventListener("click", async (event) => {
    try {
      await handleSsTokenVisibilityLink(event);
    } catch (err) {
      console.error("Token visibility link error:", err);
      ui.notifications.error("Failed to change the token visibility.");
    }
  }, true);
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
  if (!globalThis.Sound?.prototype?.play) return;
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

// Intercept client audio for Sheet Sidekick player/monitor clients across Foundry audio APIs.
function logBlockedSheetSidekickAudio(source = "") {
  debugLog("Sheet Sidekick blocked client audio:", source || "unknown source");
}

function stopSheetSidekickBlockedAudio() {
  if (!shouldBlockClientAudio()) return;
  try {
    for (const sound of (game.audio?.playing?.values?.() ?? [])) {
      try { sound?.stop?.({ fade: 0 }); } catch (_err) { /* noop */ }
    }
  } catch (_err) {
    // noop
  }

  try {
    document.querySelectorAll("audio").forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_err) {
        // noop
      }
    });
  } catch (_err) {
    // noop
  }
}

function patchSheetSidekickAudioMethod(target, methodName, handler) {
  if (!target || typeof target[methodName] !== "function") return false;
  const flag = `__ssAudioGuard_${methodName}`;
  if (target[flag] === true) return true;
  const original = target[methodName];
  target[methodName] = function (...args) {
    return handler.call(this, original, args);
  };
  target[flag] = true;
  return true;
}

function getSheetSidekickSoundClasses() {
  return Array.from(new Set([
    globalThis.Sound,
    globalThis.foundry?.audio?.Sound
  ].filter(Boolean)));
}

function getSheetSidekickPlaylistSoundClasses() {
  return Array.from(new Set([
    globalThis.PlaylistSound,
    globalThis.foundry?.documents?.PlaylistSound
  ].filter(Boolean)));
}

function installSheetSidekickAudioGuard() {
  let patched = false;

  for (const SoundClass of getSheetSidekickSoundClasses()) {
    const proto = SoundClass?.prototype;
    patched = patchSheetSidekickAudioMethod(proto, "play", function (original, args) {
      if (!shouldBlockClientAudio()) return original.apply(this, args);
      logBlockedSheetSidekickAudio(this?.src || this?.path || this?.data?.path || "");
      stopSheetSidekickBlockedAudio();
      return Promise.resolve(null);
    }) || patched;
    patched = patchSheetSidekickAudioMethod(proto, "playAtPosition", function (original, args) {
      if (!shouldBlockClientAudio()) return original.apply(this, args);
      logBlockedSheetSidekickAudio(this?.src || this?.path || this?.data?.path || "");
      stopSheetSidekickBlockedAudio();
      return Promise.resolve(null);
    }) || patched;
    patched = patchSheetSidekickAudioMethod(proto, "_play", function (original, args) {
      if (!shouldBlockClientAudio()) return original.apply(this, args);
      logBlockedSheetSidekickAudio(this?.src || this?.path || this?.data?.path || "");
      stopSheetSidekickBlockedAudio();
      return undefined;
    }) || patched;
    patched = patchSheetSidekickAudioMethod(proto, "load", function (original, args) {
      if (shouldBlockClientAudio() && args?.[0]?.autoplay) {
        args = [{ ...args[0], autoplay: false }, ...args.slice(1)];
      }
      return original.apply(this, args);
    }) || patched;
  }

  for (const PlaylistSoundClass of getSheetSidekickPlaylistSoundClasses()) {
    patched = patchSheetSidekickAudioMethod(PlaylistSoundClass?.prototype, "play", function (original, args) {
      if (!shouldBlockClientAudio()) return original.apply(this, args);
      const sound = this?.sound ?? null;
      logBlockedSheetSidekickAudio(this?.path || this?.data?.path || sound?.src || "");
      try { sound?.stop?.({ fade: 0 }); } catch (_err) { /* noop */ }
      stopSheetSidekickBlockedAudio();
      return null;
    }) || patched;
  }

  const audioHelpers = Array.from(new Set([
    globalThis.AudioHelper,
    globalThis.foundry?.audio?.AudioHelper
  ].filter(Boolean)));
  for (const AudioHelperClass of audioHelpers) {
    patched = patchSheetSidekickAudioMethod(AudioHelperClass, "play", function (original, args) {
      if (!shouldBlockClientAudio()) return original.apply(this, args);
      logBlockedSheetSidekickAudio(args?.[0]?.src || args?.[0] || "");
      stopSheetSidekickBlockedAudio();
      return null;
    }) || patched;
  }

  patched = patchSheetSidekickAudioMethod(game.audio, "play", function (original, args) {
    if (!shouldBlockClientAudio()) return original.apply(this, args);
    logBlockedSheetSidekickAudio(args?.[0] || "");
    stopSheetSidekickBlockedAudio();
    return Promise.resolve(null);
  }) || patched;

  patched = patchSheetSidekickAudioMethod(globalThis.HTMLAudioElement?.prototype, "play", function (original, args) {
    if (!shouldBlockClientAudio()) return original.apply(this, args);
    logBlockedSheetSidekickAudio(this?.currentSrc || this?.src || "");
    try {
      this.pause();
      this.currentTime = 0;
    } catch (_err) {
      // noop
    }
    return Promise.resolve();
  }) || patched;

  if (patched) debugLog("Sheet Sidekick audio guard active.");
  stopSheetSidekickBlockedAudio();
}

Hooks.once("ready", installSheetSidekickAudioGuard);

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
  queueSsDpadViewportLockSyncFromGm();
  setTimeout(emitPlayerControlsStateFromGm, 400);
  setTimeout(() => queueSsDpadViewportLockSyncFromGm(), 450);

  // Click Handler
  toggleBtn.addEventListener("click", async () => {
    const current = game.user.getFlag("world", "dpadEnabled") ?? true;
    const newState = !current;
    
    await game.user.setFlag("world", "dpadEnabled", newState);
    await game.user.setFlag("world", "dpadRefreshAt", Date.now());
    emitPlayerControlsStateFromGm();
    queueSsDpadViewportLockSyncFromGm();
    updateVisuals();

    if (newState) ui.notifications.info("Player Controls: Enabled");
    else ui.notifications.warn("Player Controls: Disabled");
  });
});

Hooks.on("userConnected", () => {
  if (!game.user?.isGM) return;
  setTimeout(emitPlayerControlsStateFromGm, 250);
  setTimeout(emitPlayerControlsStateFromGm, 1000);
  setTimeout(() => queueSsDpadViewportLockSyncFromGm(), 300);
  setTimeout(() => queueSsDpadViewportLockSyncFromGm(), 1100);
  setTimeout(() => emitSsPauseStateFromGm(), 350);
  setTimeout(() => emitSsPauseStateFromGm(), 1150);
});

// 2. PLAYER UI INJECTION
function injectSheetDpad(app, element) {
  try {
    if (game.user?.isGM) return;

    const root = (element instanceof HTMLElement) ? element : (element?.[0] instanceof HTMLElement) ? element[0] : null;
    if (!root) return;

    const form = (root.tagName === "FORM") ? root : root.querySelector("form") || root.closest("form");
    const scope = form ?? root;
    if (!scope?.matches?.(SS_SHEET_FORM_SELECTOR)) return;

    const actor = resolveActorFromSheetScope(scope, app);
    if (actor && actor.type !== "character") return;
    if (actor?.id && !scope.dataset.actorId) scope.dataset.actorId = String(actor.id);

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
    let lastLockNoticeAt = 0;

    const warnTurnLocked = (fallbackMessage = "You can move and target only on your turn.") => {
      const now = Date.now();
      if ((now - lastLockNoticeAt) < 1200) return;
      lastLockNoticeAt = now;
      ui.notifications?.warn?.(fallbackMessage);
    };

    const warnViewportLocked = (fallbackMessage = "Movement is locked while your token is outside the GM view.") => {
      const now = Date.now();
      if ((now - lastLockNoticeAt) < 1200) return;
      lastLockNoticeAt = now;
      ui.notifications?.warn?.(fallbackMessage);
    };

    function dispatchDpad(direction) {
      const viewportLock = getPlayerDpadViewportLockForActor(actor?.id ?? "");
      if (viewportLock.locked) {
        warnViewportLocked(viewportLock.reason || "Movement is locked while your token is outside the GM view.");
        return;
      }

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
      if (!sent) sendCommandToGmWhisper(`!dpad ${direction} ${ts}`, { noGmActionLabel: "Moving your character" });
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
    let dpadPingBtn = overlay.querySelector(".ss-dpad-open-ping");
    if (!dpadPingBtn) {
      dpadPingBtn = document.createElement("button");
      dpadPingBtn.type = "button";
      dpadPingBtn.className = "ss-dpad-open-ping";
      dpadPingBtn.innerHTML = `<i class="fa-solid fa-crosshairs" inert></i><span>PING</span>`;
      dpadPingBtn.setAttribute("aria-label", "Open Ping");
      dpadPingBtn.setAttribute("title", "Open Ping");
      overlay.appendChild(dpadPingBtn);
    }
    let dpadMoveNote = overlay.querySelector(".ss-dpad-move-note");
    if (!dpadMoveNote) {
      dpadMoveNote = document.createElement("div");
      dpadMoveNote.className = "ss-dpad-move-note";
      dpadMoveNote.setAttribute("aria-live", "polite");
      dpadMoveNote.hidden = true;
      overlay.appendChild(dpadMoveNote);
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
        <section class="ss-target-panel" role="dialog" aria-label="Targets/Ping">
          <header class="ss-target-panel-header">Ping</header>
          <p class="ss-target-status">No active combat.</p>
          <div class="ss-target-list"></div>
          <footer class="ss-target-actions">
            <button type="button" class="ss-target-map-ping">Ping On Map</button>
            <button type="button" class="ss-target-apply">Apply</button>
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
    const targetHeader = targetOverlay.querySelector(".ss-target-panel-header");
    const mapPingBtn = targetOverlay.querySelector(".ss-target-map-ping");
    const applyTargetsBtn = targetOverlay.querySelector(".ss-target-apply");
    const closeTargetsBtn = targetOverlay.querySelector(".ss-target-close");

    const syncTargetOverlaySelectionFromLive = () => {
      const sid = String(targetOverlay.dataset.ssSceneId || getCurrentSceneId() || "");
      const refs = Array.from(getSsLiveTargetRefsForScene(sid));
      targetOverlay.dataset.ssSelectionDirty = "0";
      targetOverlay.dataset.ssSelectedTokens = refs.join(",");
      refreshAllUseConfirmLiveTargetSummaries();
    };

    const getCurrentSceneId = () => {
      return getSsEffectiveSceneId();
    };

    const getTargetTokenStateMeta = (tokenDoc) => {
      const actorDoc = tokenDoc?.actor ?? game.actors?.get?.(tokenDoc?.actorId) ?? null;
      const defeatedId = String(CONFIG?.specialStatusEffects?.DEFEATED ?? "").trim();
      const actorStatuses = new Set(Array.from(actorDoc?.statuses ?? []).map((s) => String(s ?? "").trim()).filter(Boolean));
      const tokenStatuses = new Set(Array.from(tokenDoc?.statuses ?? []).map((s) => String(s ?? "").trim()).filter(Boolean));
      const hasDeadStatus = actorStatuses.has("dead")
        || tokenStatuses.has("dead")
        || (defeatedId && (actorStatuses.has(defeatedId) || tokenStatuses.has(defeatedId)));
      const isDefeated = !!tokenDoc?.combatant?.defeated;
      const dead = hasDeadStatus || isDefeated;
      if (dead) return { dead: true, statusHtml: "" };

      const badges = [];
      const hpValue = Number(actorDoc?.system?.attributes?.hp?.value ?? NaN);
      const hpMax = Number(actorDoc?.system?.attributes?.hp?.max ?? NaN);
      const bloodied = Number.isFinite(hpValue) && Number.isFinite(hpMax) && hpMax > 0 && hpValue > 0 && hpValue <= (hpMax / 2);
      if (bloodied) {
        badges.push(`<span class="ss-target-state-badge ss-target-state-badge-fa" title="Bloodied"><i class="fa-solid fa-droplet"></i></span>`);
      }

      const effectIndex = new Map(
        Array.from(CONFIG?.statusEffects ?? [])
          .map((effect) => [String(effect?.id ?? "").trim(), effect])
          .filter(([id]) => !!id)
      );
      const statusIds = Array.from(new Set([...actorStatuses, ...tokenStatuses]))
        .filter((id) => id && id !== "dead" && (!defeatedId || id !== defeatedId));

      for (const id of statusIds) {
        const effect = effectIndex.get(id);
        const icon = String(effect?.img ?? effect?.icon ?? "").trim();
        if (!icon) continue;
        const labelKey = String(effect?.name ?? effect?.label ?? id).trim();
        const label = game.i18n?.has?.(labelKey) ? game.i18n.localize(labelKey) : labelKey;
        badges.push(`<img class="ss-target-state-badge" src="${escapeHtml(icon)}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}">`);
      }

      const statusHtml = badges.length ? `<span class="ss-target-states">${badges.join("")}</span>` : "";
      return { dead: false, statusHtml };
    };

    const getTargetRows = () => {
      const combat = getActiveCombatForViewedScene();
      if (combat) {
        const sceneId = combat.scene?.id ?? combat.sceneId ?? game.scenes?.viewed?.id ?? "";
        const rows = [];
        const combatants = Array.from(combat.combatants?.contents ?? combat.combatants ?? []);

        for (const combatant of combatants) {
          const tokenDoc = combatant.token ?? null;
          if (!tokenDoc?.id) continue;
          if (tokenDoc.hidden) continue;
          if (combatant?.defeated || combatant?.isDefeated) continue;
          const stateMeta = getTargetTokenStateMeta(tokenDoc);
          if (stateMeta.dead) continue;

          rows.push({
            tokenId: tokenDoc.id,
            actorId: String(tokenDoc.actorId ?? combatant.actor?.id ?? ""),
            name: tokenDoc.name ?? combatant.name ?? "Unknown",
            img: tokenDoc.texture?.src ?? combatant.img ?? combatant.actor?.img ?? "",
            stateHtml: stateMeta.statusHtml ?? "",
            disabled: false
          });
        }

        if (!rows.length) {
          return {
            sceneId,
            rows,
            reason: "No visible combatants.",
            title: "Combat Ping",
            inCombat: true
          };
        }
        return { sceneId, rows, reason: "", title: "Combat Ping", inCombat: true };
      }

      const sceneId = getSsEffectiveSceneId({ preferCombat: false });
      const sceneDoc = sceneId
        ? (game.scenes?.get?.(sceneId) ?? (String(game.scenes?.viewed?.id ?? "") === sceneId ? game.scenes?.viewed ?? null : null))
        : null;
      const actors = getSsCollectionDocuments(game.actors);
      const actorHasPlayerOwner = (actorDoc) => {
        if (!actorDoc) return false;
        const hasPlayerOwner = (typeof actorDoc.hasPlayerOwner === "function")
          ? actorDoc.hasPlayerOwner()
          : actorDoc.hasPlayerOwner;
        if (hasPlayerOwner) return true;
        const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        return getSsCollectionDocuments(game.users)
          .some((user) => !user?.isGM && actorDoc.testUserPermission?.(user, ownerLevel));
      };
      const partyActorIds = new Set();
      getSsCollectionDocuments(game.users).forEach((user) => {
        if (user?.isGM) return;
        const characterId = String(user?.character?.id ?? user?.characterId ?? "").trim();
        if (characterId) partyActorIds.add(characterId);
      });
      actors
        .filter((a) => a?.type === "character" && actorHasPlayerOwner(a))
        .forEach((a) => {
          const actorId = String(a?.id ?? "").trim();
          if (actorId) partyActorIds.add(actorId);
        });
      const allowedActorIds = new Set([...partyActorIds]);
      const sceneTokens = getSsSceneTokenDocs(sceneDoc);
      const rowsByKey = new Map();
      const addRow = (row) => {
        const key = row.tokenId ? `token:${row.tokenId}` : `actor:${row.actorId}`;
        if (!key || rowsByKey.has(key)) return;
        rowsByKey.set(key, row);
      };

      for (const tokenDoc of sceneTokens) {
        if (!tokenDoc?.id) continue;
        if (tokenDoc.hidden) continue;
        if (getTargetTokenStateMeta(tokenDoc).dead) continue;
        const actorDoc = tokenDoc.actor ?? game.actors?.get?.(tokenDoc.actorId) ?? null;
        const actorId = String(tokenDoc.actorId ?? actorDoc?.id ?? "").trim();
        const includedByActor = !!actorId && allowedActorIds.has(actorId);
        const includedManually = isSsManualTargetIncluded(sceneId, tokenDoc, actorId);
        if (!includedByActor && !includedManually) continue;
        const stateMeta = getTargetTokenStateMeta(tokenDoc);
        addRow({
          tokenId: tokenDoc.id ?? "",
          actorId,
          name: tokenDoc.name ?? actorDoc?.name ?? "Unknown",
          img: tokenDoc.texture?.src ?? actorDoc?.img ?? "",
          stateHtml: stateMeta.statusHtml ?? "",
          note: "",
          disabled: false
        });
      }

      const rows = Array.from(rowsByKey.values())
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

      if (!rows.length) {
        return {
          sceneId,
          rows,
          reason: "No visible player or manually added tokens on the GM's current scene.",
          title: "Targets/Ping",
          inCombat: false
        };
      }
      return { sceneId, rows, reason: "", title: "Targets/Ping", inCombat: false };
    };

    const getSelectedTargetIds = () => {
      return Array.from(targetList?.querySelectorAll?.(".ss-target-check:checked") ?? [])
        .map((el) => el.value)
        .filter(Boolean);
    };

    const getActorTokenDocForScene = (sid) => {
      const actorId = String(actor?.id ?? "");
      if (!actorId) return null;
      const sceneDoc = getSsSceneDoc(sid);
      const sceneTokens = getSsSceneTokenDocs(sceneDoc);
      return sceneTokens.find((t) => String(t?.actorId ?? "") === actorId && !t?.hidden) ?? null;
    };

    const getTokenCenterForScene = (tokenDoc, sceneDoc) => {
      if (!tokenDoc || !sceneDoc) return null;
      const gridSize = Number(sceneDoc.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
      const wUnits = Number(tokenDoc.width ?? 1) || 1;
      const hUnits = Number(tokenDoc.height ?? 1) || 1;
      const x = Number(tokenDoc.x ?? 0) + ((wUnits * gridSize) / 2);
      const y = Number(tokenDoc.y ?? 0) + ((hUnits * gridSize) / 2);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    };

    const getDistanceFeet = (sid, tokenId) => {
      if (!tokenId) return null;
      const sceneDoc = getSsSceneDoc(sid);
      const sceneTokens = getSsSceneTokenDocs(sceneDoc);
      const fromToken = getActorTokenDocForScene(sid);
      const toToken = sceneTokens.find((t) => String(t?.id ?? "") === String(tokenId)) ?? null;
      if (!fromToken || !toToken) return "";

      const from = getTokenCenterForScene(fromToken, sceneDoc);
      const to = getTokenCenterForScene(toToken, sceneDoc);
      if (!from || !to) return "";

      const gridSize = Number(sceneDoc?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
      const gridDistance = Number(sceneDoc?.grid?.distance ?? canvas?.scene?.grid?.distance ?? 5) || 5;
      const dxCells = (to.x - from.x) / gridSize;
      const dyCells = (to.y - from.y) / gridSize;
      const rawDistanceFeet = Math.hypot(dxCells, dyCells) * gridDistance;
      if (!Number.isFinite(rawDistanceFeet) || rawDistanceFeet < 0) return null;
      const snapStep = gridDistance > 0 ? gridDistance : 5;
      const snappedDistanceFeet = Math.max(0, Math.floor((rawDistanceFeet + 1e-6) / snapStep) * snapStep);
      return snappedDistanceFeet;
    };

    const getDistanceFeetLabel = (sid, tokenId) => {
      const distanceFeet = getDistanceFeet(sid, tokenId);
      if (!Number.isFinite(distanceFeet)) return "";
      return `${distanceFeet} ft`;
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

      const selectedFromUi = new Set((targetOverlay.dataset.ssSelectedTokens ?? "")
        .split(",")
        .filter(Boolean));
      const { sceneId, rows, reason, title = "Ping", inCombat = false } = getTargetRows();
      const forceTargeting = scope.dataset.ssTargetForce === "1";
      const targetLimit = Number.parseInt(String(scope.dataset.ssTargetLimit ?? "0"), 10);
      const rangeLimitFeet = Number.parseInt(String(scope.dataset.ssTargetRangeFeet ?? "0"), 10);
      const allowTargetingActions = !!forceTargeting;
      const selectedLive = getSsLiveTargetRefsForScene(sceneId);
      const selectionDirty = targetOverlay.dataset.ssSelectionDirty === "1";
      const selected = (!selectionDirty && selectedLive.size && allowTargetingActions) ? selectedLive : selectedFromUi;
      const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
        combat: getActiveCombatForViewedScene()
      });
      const targetLocked = !!(allowTargetingActions && inCombat && turnAccess.locked);

      targetOverlay.dataset.ssSceneId = sceneId ?? "";
      targetOverlay.dataset.ssSelectedTokens = allowTargetingActions ? Array.from(selected).join(",") : "";
      targetList.innerHTML = "";
      if (targetHeader) targetHeader.textContent = title;
      targetPanel?.setAttribute("aria-label", title);
      targetStatus.classList.remove("ss-turn-locked");
      targetStatus.classList.remove("ss-gm-required");
      targetPanel?.classList.remove("ss-turn-locked");
      targetPanel?.classList.remove("ss-gm-required");
      targetPanel?.classList.remove("ss-target-applied");
      targetPanel?.classList.toggle("ss-ping-only", !allowTargetingActions);
      applyTargetsBtn.classList.remove("ss-turn-locked");

      if (!rows.length) {
        targetStatus.textContent = reason || "No targets available.";
        applyTargetsBtn.hidden = true;
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
      } else if (!allowTargetingActions) {
        targetStatus.textContent = "Ping mode: select a row's Ping button to mark location. Target selection is available from Use Item.";
      } else {
        const targetText = Number.isFinite(targetLimit) && targetLimit > 0 ? `up to ${targetLimit}` : "one or more";
        const rangeText = Number.isFinite(rangeLimitFeet) && rangeLimitFeet > 0 ? ` within ${rangeLimitFeet} ft` : "";
        targetStatus.textContent = `Select (${targetText}) target(s)${rangeText} and Apply.`;
      }
      const currentActorId = String(actor?.id ?? "").trim();
      const currentCharacterId = String(game.user?.character?.id ?? "").trim();
      const isSelfRow = (row) => {
        const rowActorId = String(row?.actorId ?? "").trim();
        if (!rowActorId) return false;
        if (currentActorId && rowActorId === currentActorId) return true;
        if (currentCharacterId && rowActorId === currentCharacterId) return true;
        return false;
      };
      rows.forEach((row) => {
        const rowRef = row.tokenId ? `token:${row.tokenId}` : (row.actorId ? `actor:${row.actorId}` : "");
        const isSelected = !!(rowRef && selected.has(rowRef));
        const selfTagHtml = isSelfRow(row) ? '<span class="ss-target-you">(YOU)</span>' : "";
        const feetNum = row.tokenId ? getDistanceFeet(sceneId, row.tokenId) : null;
        const feetLabel = Number.isFinite(feetNum) ? `${feetNum} ft` : "";
        const outOfRange = !!(
          allowTargetingActions
          && Number.isFinite(rangeLimitFeet)
          && rangeLimitFeet > 0
          && Number.isFinite(feetNum)
          && feetNum > rangeLimitFeet
        );
        const rowDisabled = !!(targetLocked || row.disabled || !rowRef || outOfRange);
        const item = document.createElement("div");
        item.className = "ss-target-row";
        if (isSelected) item.classList.add("ss-is-selected");
        if (outOfRange) item.classList.add("ss-out-of-range");
        item.dataset.tokenId = row.tokenId || "";
        item.dataset.actorId = row.actorId || "";
        item.innerHTML = `
          <label class="ss-target-pick">
            ${allowTargetingActions ? `<input type="checkbox" class="ss-target-check" value="${rowRef}" ${isSelected ? "checked" : ""} ${rowDisabled ? "disabled" : ""}>` : ""}
            <span class="ss-target-avatar"${row.img ? ` style="background-image:url('${row.img}')"` : ""}></span>
            <span class="ss-target-name">
              <span class="ss-target-name-main">${escapeHtml(row.name)} ${selfTagHtml}</span>
              ${row.stateHtml || ""}
              ${feetLabel ? `<small class="ss-target-distance">${escapeHtml(feetLabel)}${outOfRange ? " - out of range" : ""}</small>` : ""}
              ${row.note ? `<small class="ss-target-distance">${escapeHtml(row.note)}</small>` : ""}
            </span>
          </label>
          <button type="button" class="ss-target-ping" ${(row.disabled || !rowRef) ? "disabled" : ""}>Ping</button>
        `;
        targetList.appendChild(item);
      });

      applyTargetsBtn.hidden = !allowTargetingActions;
      applyTargetsBtn.disabled = !allowTargetingActions || targetLocked;
      applyTargetsBtn.title = targetLocked
        ? "You can target only on your turn."
        : (!allowTargetingActions ? "" : "Apply selected targets");
      requestAnimationFrame(syncTargetListScrollCue);
    };
    scope.__ssRenderTargetPanel = renderTargetPanel;

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
      const stickyPaddingBottomPx = Math.max(0, Math.round(parseFloat(window.getComputedStyle(stickyContainer).paddingBottom || "0") || 0));
      const contentCushionPx = narrowPhoneLayout ? 0 : 6;
      const nextBottomNavPadPx = Math.max(0, navTopDistanceFromContainerBottom + contentCushionPx);
      const nextAbilityScoresBottomPx = Math.max(0, nextBottomNavPadPx - stickyPaddingBottomPx);

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

    const updateBottomNavLayout = (enabled, canTarget, hasLogout = true) => {
      const navColumns = 3;
      tabsNav.style.setProperty("grid-template-columns", `repeat(${navColumns}, minmax(0, 1fr))`, "important");
      const { narrowPhoneLayout } = getBottomNavLayoutFlags();

      // Deterministic expected rows for quick fallback.
      const expectedCount = 4 + (enabled ? 1 : 0) + (hasLogout ? 1 : 0);
      const rows = Math.max(2, Math.ceil(expectedCount / navColumns));
      const fallbackRowHeightRem = narrowPhoneLayout ? 2.72 : 3.05;
      const fallbackGapRem = narrowPhoneLayout ? 0.2 : 0.32;
      const fallbackChromeRem = narrowPhoneLayout ? 0.55 : 0.8;
      const fallbackRem = (rows * fallbackRowHeightRem) + ((rows - 1) * fallbackGapRem) + fallbackChromeRem;
      if (!hasMeasuredBottomNavOffsets) {
        scope.style.setProperty("--ss-bottom-nav-pad", `calc(${fallbackRem.toFixed(2)}rem + env(safe-area-inset-bottom, 0px))`);
        const fallbackAbilityRem = Math.max(0, fallbackRem - (narrowPhoneLayout ? 0.9 : 0));
        scope.style.setProperty(
          "--ss-ability-scores-bottom",
          `calc(${fallbackAbilityRem.toFixed(2)}rem + env(safe-area-inset-bottom, 0px))`
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

    tabsNav.querySelectorAll(".ss-target-fs-toggle").forEach((el) => el.remove());

    let logoutTab = tabsNav.querySelector(".ss-logout-fs-toggle");
    if (!logoutTab) {
      logoutTab = document.createElement("a");
      logoutTab.href = "#";
      logoutTab.className = "item control ss-logout-fs-toggle ss-nav-tab ss-tab-logout";
      logoutTab.setAttribute("aria-label", "Logout");
      logoutTab.setAttribute("title", "Logout");
      logoutTab.innerHTML = `<i class="fa-solid fa-sign-out-alt" inert></i><span class="ss-tab-label">Logout</span>`;
      tabsNav.appendChild(logoutTab);
    }

    decorateSheetSidekickTabs(scope);

    const baseTabSet = new Set(["details", "inventory", "features", "spells"]);
    const enforceBottomNavVisibility = (enabled, canTarget) => {
      tabsNav.querySelectorAll("a.item.control").forEach((el) => {
        const dataTab = String(el.dataset?.tab ?? "");
        const isBase = baseTabSet.has(dataTab);
        const isDpad = el === dpadTab || el.classList.contains("ss-dpad-fs-toggle");
        const isLogout = el === logoutTab || el.classList.contains("ss-logout-fs-toggle");
        const visible = isBase || (isDpad && enabled) || isLogout;
        if (visible) el.style.removeProperty("display");
        else el.style.setProperty("display", "none", "important");
      });
    };

    const sync = () => {
      const blockedTabs = ["effects", "biography", "specialTraits"];
      tabsNav.querySelectorAll(blockedTabs.map((t) => `a[data-tab='${t}']`).join(","))
        .forEach((el) => el.remove());
      // Keep logout consistently as the final bottom-nav control.
      if (logoutTab?.parentElement === tabsNav) tabsNav.appendChild(logoutTab);

      const enabled = isDpadEnabledByGm();
      const canTarget = enabled;
      if (!enabled) {
        scope.classList.remove("ss-dpad-fs-open");
      }
      if (!canTarget) {
        scope.classList.remove("ss-target-panel-open");
        restoreSsSheetZIndex(scope);
      }
      scope.classList.toggle("ss-dpad-available", enabled);
      scope.classList.toggle("ss-target-available", canTarget);
      dpadTab.classList.toggle("ss-dpad-hidden", !enabled);
      if (dpadPingBtn instanceof HTMLButtonElement) {
        dpadPingBtn.disabled = !canTarget;
        dpadPingBtn.title = canTarget ? "Open Ping" : "Ping unavailable";
      }

      const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
        combat: getActiveCombatForViewedScene()
      });
      const viewportLock = getPlayerDpadViewportLockForActor(actor?.id ?? "");
      const dpadTurnLocked = !!(enabled && turnAccess.locked);
      const dpadViewLocked = !!(enabled && viewportLock.locked);
      const dpadLocked = dpadTurnLocked || dpadViewLocked;
      overlay.classList.toggle("ss-turn-locked", dpadLocked);
      dpadLockNote.hidden = !dpadLocked;
      if (dpadTurnLocked) {
        const currentName = escapeHtml(turnAccess.currentCombatantName || "another combatant");
        dpadLockNote.innerHTML = `
          <div class="ss-dpad-lock-title">Movement Locked</div>
          <div class="ss-dpad-lock-text">Please wait for your turn.</div>
        `;
      } else if (dpadViewLocked) {
        dpadLockNote.innerHTML = `
          <div class="ss-dpad-lock-title">Movement Locked</div>
          <div class="ss-dpad-lock-text">${escapeHtml(viewportLock.reason || "Your token is outside the GM's current view.")}</div>
        `;
      } else {
        dpadLockNote.textContent = "";
      }
      const movementStatus = getSsPlayerMovementStatus(actor?.id ?? "");
      if (movementStatus && !getActiveCombatForViewedScene()) {
        dpadMoveNote.hidden = false;
        dpadMoveNote.textContent = movementStatus.text;
      } else {
        dpadMoveNote.hidden = true;
        dpadMoveNote.textContent = "";
      }
      overlay.querySelectorAll(".ss-dpad-dir-btn").forEach((btn) => {
        if (!(btn instanceof HTMLButtonElement)) return;
        btn.disabled = dpadLocked;
        btn.classList.toggle("ss-turn-locked", dpadLocked);
        const baseTitle = String(btn.dataset.ssBaseTitle ?? btn.getAttribute("aria-label") ?? "Move");
        const suffix = dpadTurnLocked
          ? " (Wait for your turn)"
          : (dpadViewLocked ? " (Token not in GM view)" : "");
        btn.setAttribute("title", `${baseTitle}${suffix}`);
      });

      dpadTab.classList.remove("active");
      logoutTab.classList.remove("active");
      dpadTab.setAttribute("aria-pressed", String(enabled && scope.classList.contains("ss-dpad-fs-open")));
      logoutTab.setAttribute("aria-pressed", "false");
      if (canTarget && scope.classList.contains("ss-target-panel-open")) renderTargetPanel();
      enforceBottomNavVisibility(enabled, canTarget);

      const hasVisibleControlTab = !dpadTab.classList.contains("ss-dpad-hidden")
        || (logoutTab instanceof HTMLElement && getComputedStyle(logoutTab).display !== "none");
      scope.classList.toggle("ss-dpad-available", hasVisibleControlTab);
      updateBottomNavLayout(enabled, canTarget, true);
      queueMeasuredBottomNavOffsets();
    };
    scope.__ssSyncDpad = sync;
    scope.__ssRenderDpadMoveNote = sync;

    const openTargetPanel = ({ openFromUse = false } = {}) => {
      const enabled = isDpadEnabledByGm();
      const canTarget = enabled;
      if (!canTarget) return false;
      if (!openFromUse) {
        scope.dataset.ssTargetForce = "0";
        scope.dataset.ssTargetLimit = "0";
        scope.dataset.ssTargetRangeFeet = "0";
      }
      bringSsSheetToFront(scope);
      scope.classList.remove("ss-dpad-fs-open");
      targetOverlay.dataset.ssSelectionDirty = "0";
      targetOverlay.dataset.ssSelectedTokens = "";
      renderTargetPanel();
      scope.classList.add("ss-target-panel-open");
      sync();
      return true;
    };
    scope.__ssOpenTargetPanel = openTargetPanel;

    if (dpadTab.dataset.ssBound !== "1") {
      dpadTab.dataset.ssBound = "1";
      dpadTab.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        scope.classList.remove("ss-target-panel-open");
        restoreSsSheetZIndex(scope);
        scope.classList.toggle("ss-dpad-fs-open");
        sync();
      });
    }

    if (dpadPingBtn instanceof HTMLButtonElement && dpadPingBtn.dataset.ssBound !== "1") {
      dpadPingBtn.dataset.ssBound = "1";
      dpadPingBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openTargetPanel({ openFromUse: false });
      });
    }

    if (logoutTab.dataset.ssBound !== "1") {
      logoutTab.dataset.ssBound = "1";
      logoutTab.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          ui?.menu?.items?.logout?.onClick?.();
        } catch (_err) {
          foundry.utils.debouncedReload?.();
        }
      });
    }

    if (tabsNav.dataset.ssDpadCloseBound !== "1") {
      tabsNav.dataset.ssDpadCloseBound = "1";
      tabsNav.addEventListener("click", (ev) => {
        const tab = ev.target?.closest?.("a.item, a.control");
        if (!tab) return;
        if (tab.classList.contains("ss-dpad-fs-toggle")) return;
        if (tab.classList.contains("ss-logout-fs-toggle")) return;
        scope.classList.remove("ss-dpad-fs-open");
        scope.classList.remove("ss-target-panel-open");
        restoreSsSheetZIndex(scope);
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
      targetOverlay.addEventListener("pointerdown", () => bringSsSheetToFront(scope), true);

      targetOverlay.addEventListener("click", (ev) => {
        if (ev.target !== targetOverlay) return;
        syncTargetOverlaySelectionFromLive();
        scope.classList.remove("ss-target-panel-open");
        restoreSsSheetZIndex(scope);
        sync();
      });

      targetList?.addEventListener("click", (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const pingBtn = target.closest(".ss-target-ping");
        if (!pingBtn) return;

        const row = pingBtn.closest(".ss-target-row");
        const tokenId = row?.dataset?.tokenId;
        const actorId = row?.dataset?.actorId;
        const sceneId = targetOverlay.dataset.ssSceneId || getCurrentSceneId();
        const targetRef = tokenId ? `token:${tokenId}` : (actorId ? `actor:${actorId}` : "");
        if (!targetRef) return;

        const ts = Date.now();
        const sent = sendCommandToGmSocket("ssTarget", {
          mode: "ping",
          sceneId,
          payload: targetRef,
          timestamp: ts,
          userId: game.user?.id ?? null
        });
        if (!sent) {
          sendCommandToGmWhisper(`!ss-target ping ${sceneId} ${targetRef} ${ts} ${game.user.id}`, {
            includeSelf: true,
            noGmActionLabel: "Pinging targets"
          });
        }
      });

      targetList?.addEventListener("change", (ev) => {
        const changed = ev?.target instanceof HTMLElement ? ev.target.closest(".ss-target-check") : null;
        const targetLimit = Number.parseInt(String(scope.dataset.ssTargetLimit ?? "0"), 10);
        if (changed instanceof HTMLInputElement && changed.checked && Number.isFinite(targetLimit) && targetLimit > 0) {
          const checked = Array.from(targetList.querySelectorAll(".ss-target-check:checked"));
          if (checked.length > targetLimit) {
            changed.checked = false;
            ui.notifications?.warn?.(`You can select up to ${targetLimit} target${targetLimit === 1 ? "" : "s"} for this item.`);
          }
        }
        targetOverlay.dataset.ssSelectionDirty = "1";
        targetOverlay.dataset.ssSelectedTokens = getSelectedTargetIds().join(",");
        targetList.querySelectorAll(".ss-target-row").forEach((rowEl) => {
          const check = rowEl.querySelector(".ss-target-check");
          rowEl.classList.toggle("ss-is-selected", !!check?.checked);
        });
      });
      targetList?.addEventListener("scroll", () => {
        syncTargetListScrollCue();
      }, { passive: true });

      closeTargetsBtn?.addEventListener("click", () => {
        syncTargetOverlaySelectionFromLive();
        scope.classList.remove("ss-target-panel-open");
        restoreSsSheetZIndex(scope);
        sync();
      });

      mapPingBtn?.addEventListener("click", () => {
        const sceneId = targetOverlay.dataset.ssSceneId || getCurrentSceneId();
        requestSsMapPingSnapshot({
          actorName: actor?.name ?? "",
          actorId: actor?.id ?? "",
          sceneId
        });
      });

      applyTargetsBtn?.addEventListener("click", () => {
        const sceneId = targetOverlay.dataset.ssSceneId || getCurrentSceneId();
        if (!sceneId) return;
        const forceTargeting = scope.dataset.ssTargetForce === "1";
        if (!forceTargeting) return;
        if (!getActiveGmIds().length) {
          targetStatus.classList.add("ss-gm-required");
          targetPanel?.classList.add("ss-gm-required");
          targetStatus.textContent = "GM Required: No GM is currently active. Apply will work once a GM is logged in.";
          return;
        }
        const turnAccess = getCombatTurnAccessForUser(game.user?.id ?? null, {
          combat: getActiveCombatForViewedScene()
        });
        if (turnAccess.locked) {
          warnTurnLocked(turnAccess.message || "You cannot target until it is your turn.");
          renderTargetPanel();
          return;
        }
        const selectedRefs = getSelectedTargetIds();
        targetOverlay.dataset.ssSelectionDirty = "0";
        targetOverlay.dataset.ssSelectedTokens = selectedRefs.join(",");
        const tokenIds = selectedRefs;
        const proxyTokenIds = selectedRefs
          .map((ref) => String(ref ?? ""))
          .map((ref) => (ref.includes(":") ? ref.slice(ref.indexOf(":") + 1).trim() : ref.trim()))
          .filter(Boolean);
        setProxyTargetsForUser(game.user?.id, sceneId, proxyTokenIds);

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
        targetPanel?.classList.add("ss-target-applied");
        targetStatus.textContent = tokenIds.length
          ? `Applied ${tokenIds.length} target${tokenIds.length === 1 ? "" : "s"}.`
          : "Targets cleared.";
        window.setTimeout(() => {
          if (!document.body.contains(targetOverlay)) return;
          targetPanel?.classList.remove("ss-target-applied");
          renderTargetPanel();
        }, 1800);
        scope.classList.remove("ss-target-panel-open");
        scope.dataset.ssTargetForce = "0";
        scope.dataset.ssTargetLimit = "0";
        scope.dataset.ssTargetRangeFeet = "0";
        restoreSsSheetZIndex(scope);
        sync();
      });
    }

    sync();
    app.once?.("close", () => {
      restoreSsSheetZIndex(scope);
      overlay.remove();
      targetOverlay?.remove();
      delete scope.__ssSyncDpad;
      delete scope.__ssRenderDpadMoveNote;
      delete scope.__ssRenderTargetPanel;
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
  const pausedArg = args.find((a) => typeof a === "boolean");
  const paused = (typeof pausedArg === "boolean") ? pausedArg : !!game.paused;
  if (game.user?.isGM) {
    emitSsPauseStateFromGm(paused);
    return;
  }
  syncPlayerPauseBanner(paused);
});

function syncOpenSheetDpadLocks() {
  if (game.user?.isGM) return;
  const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
  forms.forEach((form) => {
    const syncFn = form?.__ssSyncDpad;
    if (typeof syncFn === "function") {
      try { syncFn(); } catch (_err) { /* noop */ }
      return;
    }
    try {
      injectSheetDpad({ actor: resolveActorFromSheetScope(form, null), once: () => {} }, form);
    } catch (_err) {
      // noop
    }
  });
}

function refreshSheetSidekickForms() {
  if (game.user?.isGM) return;
  const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
  const enabled = isDpadEnabledByGm();
  const restoreList = [];
  forms.forEach((form) => {
    const actor = resolveActorFromSheetScope(form, null);
    if (actor) {
      if (!form.dataset.actorId) form.dataset.actorId = String(actor.id ?? "");
      saveSheetScroll(form, actor);
      restoreList.push({ form, actor });
    }

    if (!enabled) {
      form.classList.remove("ss-dpad-available");
      form.classList.remove("ss-dpad-fs-open");
      form.classList.remove("ss-target-available");
      form.classList.remove("ss-target-panel-open");
      form.style.setProperty("--ss-bottom-nav-pad", "calc(6.2rem + env(safe-area-inset-bottom, 0px))");
      const nav = form.querySelector("nav.tabs-right, nav.tabs");
      nav?.style?.setProperty?.("grid-template-columns", "repeat(3, minmax(0, 1fr))", "important");
    }

    try {
      injectSheetDpad({ actor, once: () => {} }, form);
    } catch (_err) {
      // noop
    }
  });
  if (restoreList.length) {
    requestAnimationFrame(() => {
      restoreList.forEach(({ form, actor }) => restoreSheetScroll(form, actor));
    });
  }
}
globalThis.ssRefreshSheetSidekickForms = refreshSheetSidekickForms;

function queueSheetSidekickFormRefresh(delayMs = 120) {
  if (game.user?.isGM) return;
  saveAllOpenSheetScrolls();
  if (ssFormRefreshState.timer) window.clearTimeout(ssFormRefreshState.timer);
  ssFormRefreshState.timer = window.setTimeout(() => {
    ssFormRefreshState.timer = null;
    refreshSheetSidekickForms();
  }, delayMs);
}
globalThis.ssQueueSheetSidekickFormRefresh = queueSheetSidekickFormRefresh;

// Fallback for clients where sheet nav renders after hooks (common on mobile Safari).
Hooks.on("ready", () => {
  if (game.user?.isGM) {
    setTimeout(() => emitSsPauseStateFromGm(), 500);
    return;
  }
  setDpadEnabledOverride(isDpadEnabledByGm());
  syncPlayerPauseBanner(!!game.paused);
  seedSsViewedSceneTokenPositions();

  const run = () => {
    const forms = document.querySelectorAll(SS_SHEET_FORM_SELECTOR);
    forms.forEach((form) => injectSheetDpad({ actor: resolveActorFromSheetScope(form, null), once: () => {} }, form));
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
          nav?.style?.setProperty?.("grid-template-columns", "repeat(3, minmax(0, 1fr))", "important");
        });
      }
    }
  }

  refreshSheetSidekickForms();
  queueSheetSidekickFormRefresh(180);
});

// Keep player-side targeting UIs in sync when user target activity changes.
Hooks.on("updateUser", (_user, changed) => {
  if (game.user?.isGM) return;
  const hasTargetsChange =
    foundry.utils.hasProperty(changed, "targets")
    || foundry.utils.hasProperty(changed, "activity.targets")
    || Array.isArray(changed?.targets);
  if (!hasTargetsChange) return;

  syncOpenTargetPanelsWithLiveTargets();
  refreshAllUseConfirmLiveTargetSummaries();
});

// GM pushes lightweight target-sync events to players when GM targets change.
Hooks.on("updateUser", (user, changed) => {
  if (!game.user?.isGM) return;
  if (String(user?.id ?? "") !== String(game.user?.id ?? "")) return;
  const hasTargetsChange =
    foundry.utils.hasProperty(changed, "targets")
    || foundry.utils.hasProperty(changed, "activity.targets")
    || Array.isArray(changed?.targets);
  if (!hasTargetsChange) return;
  const sceneId = String(
    user?.activity?.scene
    ?? user?.activity?.sceneId
    ?? game.combat?.scene?.id
    ?? game.combat?.sceneId
    ?? game.scenes?.viewed?.id
    ?? ""
  ).trim();
  queueSsTargetUiSyncFromGm(sceneId);
});

Hooks.on("canvasReady", () => {
  if (game.user?.isGM) {
    queueSsDpadViewportLockSyncFromGm();
    return;
  }
  seedSsViewedSceneTokenPositions();
});

Hooks.on("canvasPan", (_canvas, panData) => {
  if (!game.user?.isGM) return;
  const sid = String(panData?.scene?.id ?? panData?.sceneId ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
  queueSsDpadViewportLockSyncFromGm(sid);
});

Hooks.on("createToken", (tokenDoc) => {
  if (game.user?.isGM) {
    const sid = String(tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
    queueSsDpadViewportLockSyncFromGm(sid);
    return;
  }
  rememberSsTokenPosition(tokenDoc);
});

Hooks.on("updateToken", (tokenDoc, changed) => {
  if (game.user?.isGM) {
    const sid = String(tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
    queueSsDpadViewportLockSyncFromGm(sid);
    return;
  }
  noteSsPlayerMovementFromTokenUpdate(tokenDoc, changed);
  const changedTargetListFlag =
    foundry.utils.hasProperty(changed, `flags.${SS_MODULE_ID}.${SS_TARGET_LIST_FLAG_KEY}`)
    || foundry.utils.hasProperty(changed, "flags.custom-js.ssTargetListInclude");
  if (changedTargetListFlag) queueSheetSidekickFormRefresh(80);
});

Hooks.on("deleteToken", (tokenDoc) => {
  if (game.user?.isGM) {
    const sid = String(tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? "").trim();
    queueSsDpadViewportLockSyncFromGm(sid);
    return;
  }
  forgetSsTokenPosition(tokenDoc);
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

Hooks.on("preUpdateActor", (actor) => {
  if (game.user?.isGM) return;
  const actorId = String(actor?.id ?? "");
  if (!actorId) return;
  recordSsScrollTrace("preUpdateActor", { actorId });
  saveOpenSheetScrollForActor(actorId);
});

Hooks.on("updateActor", (actor) => {
  if (game.user?.isGM) return;
  const actorId = String(actor?.id ?? "");
  if (!actorId) return;
  recordSsScrollTrace("updateActor", { actorId });
  queueOpenSheetScrollRestore(actorId, 20);
});

Hooks.on("updateActor", (actor, changed) => {
  const changedFlag =
    foundry.utils.hasProperty(changed, `flags.${SS_MODULE_ID}.${SS_TARGET_LIST_FLAG_KEY}`)
    || foundry.utils.hasProperty(changed, "flags.custom-js.ssTargetListInclude");
  if (!changedFlag) return;
  queueSheetSidekickFormRefresh(80);
});

Hooks.on("preUpdateItem", (item) => {
  if (game.user?.isGM) return;
  const actorId = String(item?.parent?.id ?? "");
  if (!actorId) return;
  recordSsScrollTrace("preUpdateItem", {
    actorId,
    itemId: String(item?.id ?? ""),
    itemName: String(item?.name ?? "")
  });
  saveOpenSheetScrollForActor(actorId);
});

Hooks.on("preCreateItem", (item, data) => {
  if (game.user?.isGM) return;
  const actorId = String(item?.parent?.id ?? data?.parent?.id ?? data?.parentId ?? "");
  if (!actorId) return;
  recordSsScrollTrace("preCreateItem", {
    actorId,
    itemId: String(item?.id ?? data?._id ?? ""),
    itemName: String(item?.name ?? data?.name ?? "")
  });
  saveOpenSheetScrollForActor(actorId);
});

Hooks.on("preDeleteItem", (item) => {
  if (game.user?.isGM) return;
  const actorId = String(item?.parent?.id ?? "");
  if (!actorId) return;
  recordSsScrollTrace("preDeleteItem", {
    actorId,
    itemId: String(item?.id ?? ""),
    itemName: String(item?.name ?? "")
  });
  saveOpenSheetScrollForActor(actorId);
});

Hooks.on("updateItem", (item, changed) => {
  if (game.user?.isGM) return;
  const actorId = String(item?.parent?.id ?? "");
  if (!actorId) return;
  clearSsEquipPending(actorId, String(item?.id ?? ""));
  const itemMutationLikely =
    Object.keys(changed ?? {}).length > 0
    || foundry.utils.hasProperty(changed, "sort")
    || foundry.utils.hasProperty(changed, "system.equipped")
    || foundry.utils.hasProperty(changed, "system.quantity")
    || foundry.utils.hasProperty(changed, "system.prepared")
    || foundry.utils.hasProperty(changed, "system.method")
    || foundry.utils.hasProperty(changed, "system.preparation.prepared")
    || foundry.utils.hasProperty(changed, "system.preparation.mode");
  if (!itemMutationLikely) return;
  recordSsScrollTrace("updateItem", {
    actorId,
    itemId: String(item?.id ?? ""),
    itemName: String(item?.name ?? ""),
    changedKeys: Object.keys(changed ?? {})
  });
  queueOpenSheetScrollRestore(actorId, 20);
});

Hooks.on("renderTokenHUD", (app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!(root instanceof HTMLElement)) return;

  const token = app?.object ?? app?.token ?? canvas?.tokens?.hud?.object ?? null;
  const tokenDoc = token?.document ?? token ?? null;
  const actorId = String(tokenDoc?.actorId ?? token?.actor?.id ?? "");
  if (!actorId) return;
  const actor = token?.actor ?? tokenDoc?.actor ?? game.actors?.get?.(actorId) ?? null;
  const worldActor = game.actors?.get?.(actorId) ?? actor ?? null;
  if (!worldActor) return;

  let btn = root.querySelector(".control-icon.ss-targetlist-toggle");
  if (!(btn instanceof HTMLElement)) {
    const $btn = $(`
      <div class="control-icon ss-targetlist-toggle" role="button">
        <i class="fa-solid fa-crosshairs"></i>
      </div>
    `);
    const rightCol = root.querySelector(".col.right");
    if (rightCol) rightCol.prepend($btn[0]);
    else root.append($btn[0]);
    btn = $btn[0];
  }
  if (!(btn instanceof HTMLElement)) return;

  const sync = () => {
    const sceneId = String(tokenDoc?.parent?.id ?? getSsEffectiveSceneId({ preferCombat: false }) ?? "").trim();
    const enabled = isSsManualTargetIncluded(sceneId, tokenDoc, actorId);
    btn.classList.toggle("active", enabled);
    const icon = btn.querySelector("i");
    if (icon instanceof HTMLElement) icon.className = enabled ? "fa-solid fa-user-check" : "fa-solid fa-user-plus";
    const hint = enabled
      ? "Included in Sheet Sidekick Targets/Ping list for this scene (click to remove)"
      : "Add this token to Sheet Sidekick Targets/Ping list for this scene";
    btn.setAttribute("title", hint);
    btn.setAttribute("aria-label", hint);
    btn.setAttribute("data-tooltip", hint);
    btn.dataset.tooltip = hint;
  };
  sync();

  btn.onclick = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const sceneId = String(tokenDoc?.parent?.id ?? getSsEffectiveSceneId({ preferCombat: false }) ?? "").trim();
    const enabled = isSsManualTargetIncluded(sceneId, tokenDoc, actorId);
    setSsGmSceneId(sceneId, { resetManualTargets: false });
    setSsManualTargetMembership({
      sceneId,
      actorId,
      tokenId: String(tokenDoc?.id ?? ""),
      enabled: !enabled
    });
    emitSsManualTargetListStateFromGm(sceneId);
    queueSsTargetUiSyncFromGm(sceneId);
    sync();
  };
});

async function executeSsTargetCommand({ mode, sceneId, payload, timestamp, userId }) {
  if (!game.user?.isGM) return;
  if (!mode) return;
  if (Number.isFinite(timestamp) && (Date.now() - timestamp > 20000)) return;

  const combat = getActiveCombatForViewedScene();
  const combatSceneId = combat?.scene?.id ?? combat?.sceneId ?? null;
  const effectiveSceneId = sceneId || combatSceneId || game.scenes?.viewed?.id || null;
  const sceneDoc = effectiveSceneId ? game.scenes?.get?.(effectiveSceneId) ?? null : null;

  const getSceneTokenDoc = (tokenId) => {
    if (!tokenId) return null;
    if (sceneDoc?.tokens?.get) return sceneDoc.tokens.get(tokenId) ?? null;
    const sceneTokens = getSsSceneTokenDocs(sceneDoc);
    return sceneTokens.find((t) => String(t?.id ?? "") === String(tokenId)) ?? null;
    return null;
  };

  const getCombatTokenDoc = (tokenId) => {
    const combatant = combat?.combatants?.find?.((c) => c.tokenId === tokenId);
    if (combatant?.token) return combatant.token;
    return getSceneTokenDoc(tokenId);
  };

  const isTargetableToken = (tokenId) => {
    const tokenDoc = (combat && (combat.combatants?.size > 0))
      ? getCombatTokenDoc(tokenId)
      : getSceneTokenDoc(tokenId);
    if (!tokenDoc?.id) return false;
    if (tokenDoc.hidden) return false;
    return true;
  };

  const resolveTokenIdFromReference = (ref) => {
    const raw = String(ref ?? "").trim();
    if (!raw) return "";

    let mode = "token";
    let value = raw;
    if (raw.includes(":")) {
      const idx = raw.indexOf(":");
      mode = raw.slice(0, idx).toLowerCase();
      value = raw.slice(idx + 1).trim();
    }
    if (!value) return "";

    if (mode === "token" || mode === "t") {
      return isTargetableToken(value) ? value : "";
    }

    if (mode === "actor" || mode === "a") {
      const sceneTokens = getSsSceneTokenDocs(sceneDoc);
      const tokenDoc = sceneTokens.find((t) => String(t?.actorId ?? "") === value && !t.hidden)
        ?? null;
      const tokenId = String(tokenDoc?.id ?? "");
      return tokenId && isTargetableToken(tokenId) ? tokenId : "";
    }

    return isTargetableToken(raw) ? raw : "";
  };

  if (mode === "ping") {
    const tokenId = resolveTokenIdFromReference(payload);
    if (!tokenId || !isTargetableToken(tokenId)) return;

    const token = canvas?.tokens?.get(tokenId) ?? null;
    if (!token || !canvas?.ready) return;

    const x = token.center?.x ?? (token.document.x + ((token.w ?? canvas.grid.size) / 2));
    const y = token.center?.y ?? (token.document.y + ((token.h ?? canvas.grid.size) / 2));

    const pingUserId = String(userId ?? "") || game.user.id;
    const pingSceneId = String(effectiveSceneId ?? sceneId ?? canvas.scene?.id ?? "");
    const pingUser = game.users?.get?.(pingUserId) ?? null;
    const pingColor = pingUser?.color?.css ?? pingUser?.color ?? null;
    const pingZoom = Number(canvas?.stage?.scale?.x ?? canvas?.stage?.worldTransform?.a ?? 1) || 1;
    const broadcasted = await broadcastSsPingForAllClients({
      x,
      y,
      sceneId: pingSceneId,
      zoom: pingZoom,
      style: "pulse",
      pull: false
    });
    if (!broadcasted) {
      drawSsPingLocallyForGm({ x, y, sceneId: pingSceneId, userId: pingUserId, color: pingColor });
    } else {
      // GM sender often does not receive its own broadcast ping render; draw locally too.
      drawSsPingLocallyForGm({ x, y, sceneId: pingSceneId, userId: pingUserId, color: pingColor });
    }
    return;
  }

  if (mode === "set") {
    const targetUserId = String(userId ?? "");
    if (!targetUserId) return;
    if (combat && getCombatTurnAccessForUser(targetUserId, { combat }).locked) return;

    const requested = (payload === "-" ? [] : String(payload).split(",").filter(Boolean));
    const tokenIds = Array.from(new Set(
      requested
        .map((ref) => resolveTokenIdFromReference(ref))
        .filter((id) => isTargetableToken(id))
    ));
    setProxyTargetsForUser(targetUserId, effectiveSceneId, tokenIds);

    try {
      // Immediate GM-side proxy targeting so no player canvas is required.
      const viewedSceneId = getSsKnownGmSceneId() || null;
      if (!effectiveSceneId || !viewedSceneId || viewedSceneId === effectiveSceneId) {
        applyTargetsForCurrentGmUser(tokenIds, { sceneId: effectiveSceneId ?? "" });
      }
    } catch (err) {
      console.warn("Target apply failed:", err);
    }
    queueSsTargetUiSyncFromGm(effectiveSceneId ?? sceneId ?? "");
  }
}

async function broadcastSsPingForAllClients({ x, y, sceneId, zoom, style = "pulse", pull = false }) {
  if (!game.user?.isGM) return false;
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

  const activity = {
    cursor: { x: px, y: py },
    ping: {
      scene: String(sceneId ?? "") || (game.scenes?.viewed?.id ?? canvas?.scene?.id ?? ""),
      pull: !!pull,
      style: String(style || "pulse") || "pulse"
    }
  };
  const z = Number(zoom);
  if (Number.isFinite(z) && z > 0) activity.ping.zoom = z;

  try {
    await game.user?.broadcastActivity?.(activity);
    return true;
  } catch (err) {
    console.warn("GM ping broadcast failed:", err);
    return false;
  }
}

function drawSsPingLocallyForGm({ x, y, sceneId, userId, color }) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  try {
    canvas.controls?.drawPing?.(
      { x: px, y: py },
      {
        scene: String(sceneId ?? "") || (game.scenes?.viewed?.id ?? canvas?.scene?.id ?? null),
        user: (String(userId ?? "") || game.user?.id || null),
        ...(color ? { color } : {})
      }
    );
    return true;
  } catch (_err) {
    try {
      canvas.ping?.({ x: px, y: py });
      return true;
    } catch (__err) {
      return false;
    }
  }
}

const ssMapPingSnapshotPlayerState = globalThis.__SS_MAP_PING_SNAPSHOT_PLAYER__ ?? (globalThis.__SS_MAP_PING_SNAPSHOT_PLAYER__ = {
  overlay: null,
  statusEl: null,
  hintEl: null,
  imageWrapEl: null,
  imageEl: null,
  requestBtn: null,
  closeBtn: null,
  requestId: "",
  sceneId: "",
  actorName: "",
  actorId: "",
  waiting: false,
  snapshotReady: false,
  view: {
    zoom: 1,
    panX: 0,
    panY: 0,
    pointers: new Map(),
    dragPointerId: null,
    pointerStartX: 0,
    pointerStartY: 0,
    pointerMoved: false,
    dragging: false,
    startPanX: 0,
    startPanY: 0,
    pinchDistance: 0,
    pinchZoom: 1,
    pinchCenterX: 0,
    pinchCenterY: 0,
    pinchPanX: 0,
    pinchPanY: 0
  }
});

function refreshSsMapPingSnapshotRequestButtonForPlayer() {
  const state = ssMapPingSnapshotPlayerState;
  const btn = state?.requestBtn;
  if (!(btn instanceof HTMLElement)) return;
  const hasActiveGm = getActiveGmIds().length > 0;
  btn.style.display = hasActiveGm ? "" : "none";
  if (!hasActiveGm) btn.disabled = true;
}

const ssMapPingSnapshotGmState = globalThis.__SS_MAP_PING_SNAPSHOT_GM__ ?? (globalThis.__SS_MAP_PING_SNAPSHOT_GM__ = {
  pending: new Map()
});

function makeSsMapPingSnapshotRequestId() {
  try {
    return foundry?.utils?.randomID?.() ?? `ssmps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  } catch (_err) {
    return `ssmps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function getSsMapPingViewMetrics(state) {
  const wrap = state?.imageWrapEl;
  const image = state?.imageEl;
  if (!(wrap instanceof HTMLElement) || !(image instanceof HTMLImageElement)) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const cw = Number(wrapRect.width ?? 0);
  const ch = Number(wrapRect.height ?? 0);
  if (!(cw > 0) || !(ch > 0)) return null;

  const naturalW = Number(image.naturalWidth ?? 0);
  const naturalH = Number(image.naturalHeight ?? 0);
  if (!(naturalW > 0) || !(naturalH > 0)) {
    return { wrapRect, cw, ch, baseW: cw, baseH: ch };
  }
  const fit = Math.min(cw / naturalW, ch / naturalH);
  const baseW = naturalW * fit;
  const baseH = naturalH * fit;
  return { wrapRect, cw, ch, baseW, baseH };
}

function clampSsMapPingView(state) {
  const view = state?.view;
  if (!view) return;
  const zoom = Number(view.zoom ?? 1);
  view.zoom = Math.min(4, Math.max(1, Number.isFinite(zoom) ? zoom : 1));

  const metrics = getSsMapPingViewMetrics(state);
  if (!metrics) return;
  const { cw, ch, baseW, baseH } = metrics;
  const extentX = Math.max(0, ((baseW * view.zoom) - cw) / 2);
  const extentY = Math.max(0, ((baseH * view.zoom) - ch) / 2);
  view.panX = Math.min(extentX, Math.max(-extentX, Number(view.panX ?? 0) || 0));
  view.panY = Math.min(extentY, Math.max(-extentY, Number(view.panY ?? 0) || 0));
}

function applySsMapPingViewTransform(state) {
  const image = state?.imageEl;
  const wrap = state?.imageWrapEl;
  const view = state?.view;
  if (!(image instanceof HTMLImageElement) || !view) return;
  clampSsMapPingView(state);
  image.style.transformOrigin = "50% 50%";
  image.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  const cursor = view.dragging ? "grabbing" : (view.zoom > 1.01 ? "grab" : "crosshair");
  image.style.cursor = cursor;
  if (wrap instanceof HTMLElement) wrap.style.cursor = cursor;
}

function resetSsMapPingViewTransform(state) {
  const view = state?.view;
  if (!view) return;
  view.zoom = 1;
  view.panX = 0;
  view.panY = 0;
  view.dragPointerId = null;
  view.pointerStartX = 0;
  view.pointerStartY = 0;
  view.pointerMoved = false;
  view.dragging = false;
  view.startPanX = 0;
  view.startPanY = 0;
  view.pinchDistance = 0;
  view.pinchZoom = 1;
  view.pinchCenterX = 0;
  view.pinchCenterY = 0;
  view.pinchPanX = 0;
  view.pinchPanY = 0;
  if (view.pointers instanceof Map) view.pointers.clear();
  applySsMapPingViewTransform(state);
}

function mapSsMapPingClientToNormalized(state, clientX, clientY) {
  const view = state?.view;
  if (!view) return null;
  const metrics = getSsMapPingViewMetrics(state);
  if (!metrics) return null;
  const { wrapRect, cw, ch, baseW, baseH } = metrics;
  const px = Number(clientX) - wrapRect.left;
  const py = Number(clientY) - wrapRect.top;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

  const xFromCenter = (px - (cw / 2) - view.panX) / view.zoom;
  const yFromCenter = (py - (ch / 2) - view.panY) / view.zoom;
  const ix = xFromCenter + (baseW / 2);
  const iy = yFromCenter + (baseH / 2);
  if (!(ix >= 0 && ix <= baseW && iy >= 0 && iy <= baseH)) return null;

  const nx = ix / baseW;
  const ny = iy / baseH;
  if (!(nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) return null;
  return { nx, ny };
}

function zoomSsMapPingAtClient(state, clientX, clientY, factor) {
  const view = state?.view;
  if (!view) return false;
  const metrics = getSsMapPingViewMetrics(state);
  if (!metrics) return false;
  const { wrapRect, cw, ch } = metrics;

  const px = Number(clientX) - wrapRect.left;
  const py = Number(clientY) - wrapRect.top;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

  const currentZoom = Number(view.zoom ?? 1);
  const nextZoom = Math.min(4, Math.max(1, currentZoom * factor));
  if (Math.abs(nextZoom - currentZoom) < 0.001) return false;

  const worldX = (px - (cw / 2) - view.panX) / currentZoom;
  const worldY = (py - (ch / 2) - view.panY) / currentZoom;
  view.zoom = nextZoom;
  view.panX = px - (cw / 2) - (worldX * nextZoom);
  view.panY = py - (ch / 2) - (worldY * nextZoom);
  applySsMapPingViewTransform(state);
  return true;
}

function ensureSsMapPingSnapshotOverlay() {
  const state = ssMapPingSnapshotPlayerState;
  if (state.overlay instanceof HTMLElement) return state.overlay;

  const overlay = document.createElement("div");
  overlay.className = "ss-map-ping-snapshot-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px",
    background: "rgba(5, 9, 14, 0.9)"
  });

  const card = document.createElement("section");
  Object.assign(card.style, {
    width: "min(96vw, 780px)",
    maxHeight: "96vh",
    display: "grid",
    gridTemplateRows: "auto auto auto minmax(260px, 1fr) auto",
    gap: "6px",
    padding: "10px",
    borderRadius: "10px",
    border: "1px solid rgba(214, 181, 109, 0.55)",
    background: "rgba(13, 19, 29, 0.97)",
    boxShadow: "0 14px 32px rgba(0,0,0,.45)",
    color: "#f2ead3"
  });

  const title = document.createElement("div");
  title.textContent = "Ping On Map";
  title.style.cssText = "font-weight:800; letter-spacing:.04em; text-align:center;";

  const status = document.createElement("div");
  status.style.cssText = "text-align:center; font-weight:700; font-size:.95rem;";
  status.textContent = "Please wait for the GM...";

  const hint = document.createElement("div");
  hint.style.cssText = "text-align:center; font-size:.82rem; opacity:.9; line-height:1.25;";
  hint.textContent = "The GM is preparing a low-quality map snapshot for a general placement ping.";

  const imageWrap = document.createElement("div");
  Object.assign(imageWrap.style, {
    minHeight: "clamp(240px, 52vh, 620px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "8px",
    border: "1px solid rgba(214, 181, 109, 0.28)",
    background: "rgba(0, 0, 0, 0.55)",
    overflow: "hidden",
    touchAction: "none",
    cursor: "crosshair"
  });

  const image = document.createElement("img");
  Object.assign(image.style, {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "none",
    touchAction: "none",
    cursor: "crosshair",
    background: "rgb(0,0,0)",
    userSelect: "none",
    webkitUserDrag: "none"
  });
  image.draggable = false;
  imageWrap.appendChild(image);

  const actions = document.createElement("div");
  actions.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
  const requestBtn = document.createElement("button");
  requestBtn.type = "button";
  requestBtn.innerHTML = '<i class="fas fa-camera"></i> Request Snapshot';
  Object.assign(requestBtn.style, {
    minHeight: "2.2rem",
    borderRadius: "8px",
    border: "1px solid rgba(109, 172, 214, 0.65)",
    background: "rgba(18, 44, 62, 0.95)",
    color: "#d6edff",
    fontWeight: "700"
  });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  Object.assign(closeBtn.style, {
    minHeight: "2.2rem",
    borderRadius: "8px",
    border: "1px solid rgba(214, 181, 109, 0.45)",
    background: "rgba(24, 30, 43, 0.92)",
    color: "#f2ead3",
    fontWeight: "700"
  });
  actions.append(requestBtn, closeBtn);

  requestBtn.addEventListener("click", () => {
    if (game.user?.isGM) return;
    if (state.waiting) return;
    requestSsMapPingSnapshot({
      actorName: String(state.actorName ?? ""),
      actorId: String(state.actorId ?? ""),
      sceneId: String(state.sceneId ?? game.scenes?.viewed?.id ?? "")
    });
  });

  closeBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    state.requestId = "";
    state.sceneId = "";
    state.waiting = false;
    state.snapshotReady = false;
    resetSsMapPingViewTransform(state);
  });

  const pingAtClientPoint = (clientX, clientY) => {
    if (game.user?.isGM) return false;
    if (!state.snapshotReady || !state.requestId) return false;
    const mapped = mapSsMapPingClientToNormalized(state, clientX, clientY);
    if (!mapped) return false;

    const sent = sendCommandToGmSocket("ssMapPingSnapshot", {
      mode: "tap",
      requestId: state.requestId,
      sceneId: state.sceneId || "",
      nx: mapped.nx,
      ny: mapped.ny,
      timestamp: Date.now(),
      userId: game.user?.id ?? null
    });
    if (!sent) {
      showSsNoActiveGmDialog({ actionLabel: "Ping On Map" });
      status.textContent = "GM Required: Ping unavailable until a GM is online.";
      return false;
    }
    status.textContent = "Ping sent to GM.";
    hint.textContent = "Tap/click to ping. Drag to pan. Pinch or mouse-wheel to zoom. Be mindful of placement when zoomed.";
    return true;
  };

  imageWrap.addEventListener("wheel", (ev) => {
    if (game.user?.isGM) return;
    if (!state.snapshotReady) return;
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.12 : (1 / 1.12);
    zoomSsMapPingAtClient(state, ev.clientX, ev.clientY, factor);
  }, { passive: false });

  const onPointerDown = (ev) => {
    if (game.user?.isGM) return;
    if (!state.snapshotReady) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const view = state.view;
    if (!(view?.pointers instanceof Map)) return;

    imageWrap.setPointerCapture?.(ev.pointerId);
    view.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, pointerType: ev.pointerType });
    view.pointerMoved = false;

    if (view.pointers.size === 1) {
      view.dragPointerId = ev.pointerId;
      view.pointerStartX = ev.clientX;
      view.pointerStartY = ev.clientY;
      view.startPanX = view.panX;
      view.startPanY = view.panY;
      view.dragging = false;
    } else if (view.pointers.size >= 2) {
      const pts = Array.from(view.pointers.values());
      const p1 = pts[0];
      const p2 = pts[1];
      view.pinchDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      view.pinchZoom = view.zoom;
      view.pinchCenterX = (p1.x + p2.x) / 2;
      view.pinchCenterY = (p1.y + p2.y) / 2;
      view.pinchPanX = view.panX;
      view.pinchPanY = view.panY;
      view.dragging = true;
      view.pointerMoved = true;
      applySsMapPingViewTransform(state);
    }
    ev.preventDefault();
  };

  const onPointerMove = (ev) => {
    if (game.user?.isGM) return;
    if (!state.snapshotReady) return;
    const view = state.view;
    if (!(view?.pointers instanceof Map) || !view.pointers.has(ev.pointerId)) return;

    view.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, pointerType: ev.pointerType });

    if (view.pointers.size >= 2) {
      const pts = Array.from(view.pointers.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const centerX = (p1.x + p2.x) / 2;
      const centerY = (p1.y + p2.y) / 2;
      view.zoom = Math.min(4, Math.max(1, view.pinchZoom * (dist / (view.pinchDistance || 1))));
      view.panX = view.pinchPanX + (centerX - view.pinchCenterX);
      view.panY = view.pinchPanY + (centerY - view.pinchCenterY);
      view.dragging = true;
      view.pointerMoved = true;
      applySsMapPingViewTransform(state);
      ev.preventDefault();
      return;
    }

    if (view.dragPointerId !== ev.pointerId) return;
    const dx = ev.clientX - view.pointerStartX;
    const dy = ev.clientY - view.pointerStartY;
    const movedSq = (dx * dx) + (dy * dy);
    if ((view.zoom > 1.01) || (movedSq > 64)) view.dragging = true;
    if (view.dragging) {
      view.panX = view.startPanX + dx;
      view.panY = view.startPanY + dy;
      if (movedSq > 16) view.pointerMoved = true;
      applySsMapPingViewTransform(state);
      ev.preventDefault();
    }
  };

  const onPointerUpOrCancel = (ev) => {
    const view = state.view;
    if (!(view?.pointers instanceof Map)) return;
    const tracked = view.pointers.has(ev.pointerId);
    if (tracked) view.pointers.delete(ev.pointerId);
    const shouldPing = tracked
      && !game.user?.isGM
      && state.snapshotReady
      && !!state.requestId
      && !view.pointerMoved
      && view.pointers.size === 0;

    if (view.pointers.size === 0) {
      view.dragPointerId = null;
      view.dragging = false;
      view.pinchDistance = 0;
      view.pinchZoom = view.zoom;
      applySsMapPingViewTransform(state);
    }

    if (shouldPing) {
      pingAtClientPoint(ev.clientX, ev.clientY);
    }
    imageWrap.releasePointerCapture?.(ev.pointerId);
  };

  imageWrap.addEventListener("pointerdown", onPointerDown);
  imageWrap.addEventListener("pointermove", onPointerMove);
  imageWrap.addEventListener("pointerup", onPointerUpOrCancel);
  imageWrap.addEventListener("pointercancel", onPointerUpOrCancel);

  card.append(title, status, hint, imageWrap, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  state.overlay = overlay;
  state.statusEl = status;
  state.hintEl = hint;
  state.imageWrapEl = imageWrap;
  state.imageEl = image;
  state.requestBtn = requestBtn;
  refreshSsMapPingSnapshotRequestButtonForPlayer();
  state.closeBtn = closeBtn;
  return overlay;
}

function openSsMapPingSnapshotWaiting({ requestId, sceneId = "" } = {}) {
  const state = ssMapPingSnapshotPlayerState;
  const overlay = ensureSsMapPingSnapshotOverlay();
  state.requestId = String(requestId ?? "");
  state.sceneId = String(sceneId ?? "");
  state.waiting = true;
  state.snapshotReady = false;

  if (state.imageEl) {
    state.imageEl.removeAttribute("src");
    state.imageEl.style.display = "none";
  }
  if (state.imageWrapEl) state.imageWrapEl.style.display = "flex";
  if (state.statusEl) {
    state.statusEl.textContent = "Please wait for the GM...";
    state.statusEl.style.color = "";
  }
  if (state.hintEl) {
    state.hintEl.textContent = "The GM is preparing a low-quality map snapshot for a general placement ping.";
    state.hintEl.style.color = "";
  }
  if (state.requestBtn) {
    state.requestBtn.disabled = true;
    state.requestBtn.innerHTML = '<i class="fas fa-hourglass-half"></i> Request Pending...';
  }
  refreshSsMapPingSnapshotRequestButtonForPlayer();
  resetSsMapPingViewTransform(state);
  overlay.style.display = "flex";
}

function showSsMapPingSnapshotImage({ requestId, sceneId = "", image = "" } = {}) {
  const state = ssMapPingSnapshotPlayerState;
  const overlay = ensureSsMapPingSnapshotOverlay();
  state.requestId = String(requestId ?? state.requestId ?? "");
  state.sceneId = String(sceneId ?? state.sceneId ?? "");
  state.waiting = false;
  state.snapshotReady = true;

  if (state.imageEl) {
    state.imageEl.src = String(image ?? "");
    state.imageEl.style.display = "block";
  }
  if (state.imageWrapEl) state.imageWrapEl.style.display = "flex";
  if (state.statusEl) {
    state.statusEl.textContent = "Tap/click to ping. Drag to pan. Pinch or mouse-wheel to zoom.";
    state.statusEl.style.color = "";
  }
  if (state.hintEl) {
    state.hintEl.textContent = "Low-quality reference only. Be mindful of placement when zoomed or panned.";
    state.hintEl.style.color = "";
  }
  if (state.requestBtn) {
    state.requestBtn.disabled = false;
    state.requestBtn.innerHTML = '<i class="fas fa-camera"></i> Request Snapshot';
  }
  refreshSsMapPingSnapshotRequestButtonForPlayer();
  resetSsMapPingViewTransform(state);
  overlay.style.display = "flex";
}

function showSsMapPingSnapshotCancelled(message = "GM cancelled the map ping request.") {
  const state = ssMapPingSnapshotPlayerState;
  const overlay = ensureSsMapPingSnapshotOverlay();
  state.waiting = false;
  state.snapshotReady = false;
  if (state.imageEl) {
    state.imageEl.removeAttribute("src");
    state.imageEl.style.display = "none";
  }
  if (state.imageWrapEl) state.imageWrapEl.style.display = "flex";
  if (state.statusEl) state.statusEl.textContent = "Map ping request not completed.";
  if (state.hintEl) state.hintEl.textContent = String(message || "GM cancelled the map ping request.");
  if (state.closeBtn) state.closeBtn.textContent = "Close";
  if (state.requestBtn) {
    state.requestBtn.disabled = false;
    state.requestBtn.innerHTML = '<i class="fas fa-camera"></i> Request Snapshot';
  }
  refreshSsMapPingSnapshotRequestButtonForPlayer();
  if (state.statusEl) state.statusEl.style.color = "";
  if (state.hintEl) state.hintEl.style.color = "";
  resetSsMapPingViewTransform(state);
  overlay.style.display = "flex";
}

function showSsMapPingSnapshotNoGm() {
  const state = ssMapPingSnapshotPlayerState;
  const overlay = ensureSsMapPingSnapshotOverlay();
  state.waiting = false;
  state.snapshotReady = false;
  state.requestId = "";
  if (state.imageEl) {
    state.imageEl.removeAttribute("src");
    state.imageEl.style.display = "none";
  }
  if (state.imageWrapEl) state.imageWrapEl.style.display = "none";
  if (state.statusEl) {
    state.statusEl.textContent = "GM Not Connected";
    state.statusEl.style.color = "#ffb3a6";
  }
  if (state.hintEl) {
    state.hintEl.textContent = "Ping On Map needs a GM online. Please wait for your GM to log in, then try again.";
    state.hintEl.style.color = "#ffd2c7";
  }
  if (state.requestBtn) {
    state.requestBtn.disabled = true;
    state.requestBtn.innerHTML = '<i class="fas fa-camera"></i> Request Snapshot';
  }
  refreshSsMapPingSnapshotRequestButtonForPlayer();
  if (state.closeBtn) state.closeBtn.textContent = "Close";
  resetSsMapPingViewTransform(state);
  overlay.style.display = "flex";
}

function requestSsMapPingSnapshot({ actorName = "", actorId = "", sceneId = "" } = {}) {
  if (game.user?.isGM) return false;
  const state = ssMapPingSnapshotPlayerState;
  const nextActorName = String(actorName ?? "").trim();
  const nextActorId = String(actorId ?? "").trim();
  const nextSceneId = String(sceneId ?? "").trim();
  if (nextActorName) state.actorName = nextActorName;
  if (nextActorId) state.actorId = nextActorId;
  if (nextSceneId) {
    state.sceneId = nextSceneId;
  } else if (!String(state.sceneId ?? "").trim()) {
    state.sceneId = String(game.scenes?.viewed?.id ?? "");
  }

  const requestId = makeSsMapPingSnapshotRequestId();
  openSsMapPingSnapshotWaiting({ requestId, sceneId: state.sceneId });

  const sent = sendCommandToGmSocket("ssMapPingSnapshot", {
    mode: "request",
    requestId,
    sceneId: String(state.sceneId ?? ""),
    actorName: String(state.actorName ?? ""),
    actorId: String(state.actorId ?? ""),
    timestamp: Date.now(),
    userId: game.user?.id ?? null
  });

  if (!sent) {
    showSsMapPingSnapshotNoGm();
    ui.notifications?.warn?.("No GM is active. Ping On Map requires a GM to be connected.");
    return false;
  }

  ui.notifications?.info?.("Ping-on-map request sent. Please wait for the GM.");
  return true;
}

async function captureSsMapPingSnapshotForGm({ scale = 0.34, quality = 0.45 } = {}) {
  if (!game.user?.isGM) throw new Error("GM only");
  if (!canvas?.ready) throw new Error("Canvas not ready");

  const renderer = canvas.app?.renderer;
  const ex = renderer?.extract ?? renderer?.plugins?.extract;
  if (!renderer || !ex?.canvas) throw new Error("PIXI extract API unavailable");

  const stage = canvas.stage ?? canvas.app?.stage ?? null;
  if (!stage) throw new Error("Canvas stage unavailable");

  const screenW = Math.max(1, Math.round(renderer.screen?.width || window.innerWidth || 1));
  const screenH = Math.max(1, Math.round(renderer.screen?.height || window.innerHeight || 1));

  // Hide nonessential layers so players only get a general actor+map reference.
  const hiddenTargets = [
    canvas.notes,
    canvas.drawings,
    canvas.templates,
    canvas.controls,
    canvas.interface,
    canvas.hud
  ].filter((x) => x && typeof x.visible === "boolean");
  const visibilitySnapshot = hiddenTargets.map((target) => [target, target.visible]);
  const hiddenRenderTargets = [];
  const seenHiddenRenderTargets = new Set();
  const collectHiddenRenderTarget = (target) => {
    if (!target || typeof target !== "object") return;
    if (seenHiddenRenderTargets.has(target)) return;
    const hasVisible = typeof target.visible === "boolean";
    const hasRenderable = typeof target.renderable === "boolean";
    const hasAlpha = typeof target.alpha === "number";
    if (!hasVisible && !hasRenderable && !hasAlpha) return;

    seenHiddenRenderTargets.add(target);
    hiddenRenderTargets.push({
      target,
      hasVisible,
      hasRenderable,
      hasAlpha,
      visible: hasVisible ? !!target.visible : false,
      renderable: hasRenderable ? !!target.renderable : false,
      alpha: hasAlpha ? Number(target.alpha) : 1
    });
  };

  const collectHiddenRenderSubtree = (root) => {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      collectHiddenRenderTarget(node);
      const children = Array.from(node?.children ?? []);
      children.forEach((child) => walk(child));
    };
    walk(root);
  };

  const hiddenPlaceableTiles = Array.from(canvas.tiles?.placeables ?? [])
    .filter((tile) => !!tile?.document?.hidden);
  hiddenPlaceableTiles.forEach((tile) => {
    collectHiddenRenderSubtree(tile);
    collectHiddenRenderSubtree(tile?.mesh);
    collectHiddenRenderSubtree(tile?.object);
    collectHiddenRenderSubtree(tile?.object?.mesh);
    collectHiddenRenderSubtree(tile?.bg);
    collectHiddenRenderSubtree(tile?.frame);
    collectHiddenRenderSubtree(tile?.texture);
  });

  const hiddenPlaceableTokens = Array.from(canvas.tokens?.placeables ?? [])
    .filter((token) => !!token?.document?.hidden);
  hiddenPlaceableTokens.forEach((token) => {
    collectHiddenRenderSubtree(token);
    collectHiddenRenderSubtree(token?.mesh);
    collectHiddenRenderSubtree(token?.object);
    collectHiddenRenderSubtree(token?.object?.mesh);
    collectHiddenRenderSubtree(token?.bars);
    collectHiddenRenderSubtree(token?.effects);
    collectHiddenRenderSubtree(token?.tooltip);
    collectHiddenRenderSubtree(token?.target);
    collectHiddenRenderSubtree(token?.nameplate);
  });

  let rt = null;
  let extracted = null;
  try {
    for (const [target] of visibilitySnapshot) target.visible = false;
    for (const entry of hiddenRenderTargets) {
      try {
        if (entry.hasVisible) entry.target.visible = false;
        if (entry.hasRenderable) entry.target.renderable = false;
        if (entry.hasAlpha) entry.target.alpha = 0;
      } catch (_err) {
        // noop
      }
    }

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    rt = PIXI.RenderTexture.create({ width: screenW, height: screenH });
    try {
      renderer.render(stage, { renderTexture: rt, clear: true });
    } catch (_err) {
      renderer.render({ container: stage, target: rt, clear: true });
    }
    extracted = ex.canvas(rt);
  } finally {
    for (const [target, wasVisible] of visibilitySnapshot) {
      try { target.visible = wasVisible; } catch (_err) { /* noop */ }
    }
    for (const entry of hiddenRenderTargets) {
      try {
        if (entry.hasVisible) entry.target.visible = entry.visible;
        if (entry.hasRenderable) entry.target.renderable = entry.renderable;
        if (entry.hasAlpha) entry.target.alpha = entry.alpha;
      } catch (_err) {
        // noop
      }
    }
    try { rt?.destroy?.(true); } catch (_err) { /* noop */ }
  }

  if (!(extracted instanceof HTMLCanvasElement)) throw new Error("Snapshot capture returned no canvas.");

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(screenW * scale));
  out.height = Math.max(1, Math.round(screenH * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable.");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(extracted, 0, 0, out.width, out.height);

  const wt = canvas.stage.worldTransform;
  return {
    image: out.toDataURL("image/webp", quality),
    capture: {
      a: wt.a,
      b: wt.b,
      c: wt.c,
      d: wt.d,
      tx: wt.tx,
      ty: wt.ty,
      screenW,
      screenH,
      sceneId: canvas.scene?.id ?? game.scenes?.viewed?.id ?? ""
    }
  };
}

async function sendSsMapPingSnapshotToPlayer(requestId) {
  const request = ssMapPingSnapshotGmState.pending.get(String(requestId ?? ""));
  if (!request) return false;

  const sceneId = String(request.sceneId || canvas.scene?.id || game.scenes?.viewed?.id || "");
  const viewedSceneId = String(game.scenes?.viewed?.id ?? canvas.scene?.id ?? "");
  if (sceneId && viewedSceneId && sceneId !== viewedSceneId) {
    ui.notifications?.warn?.("Open the requested scene before sending the map snapshot.");
    return false;
  }

  const snap = await captureSsMapPingSnapshotForGm();
  request.capture = snap.capture;
  request.updatedAt = Date.now();

  emitSsSocketMessage({
    type: "ssMapPingSnapshot",
    mode: "snapshot",
    toUserId: request.userId,
    requestId: request.requestId,
    sceneId: request.capture.sceneId,
    image: snap.image,
    timestamp: Date.now(),
    userId: game.user?.id ?? null
  });

  ui.notifications?.info?.(`Sent map snapshot to ${request.requesterName}.`);
  return true;
}

function getSsSceneForMapPing(sceneId = "") {
  const sid = String(sceneId ?? "").trim();
  if (sid) {
    return game.scenes?.get?.(sid)
      ?? (String(game.scenes?.viewed?.id ?? "") === sid ? game.scenes.viewed : null)
      ?? null;
  }
  return game.scenes?.viewed ?? null;
}

function getSsSceneTokensForMapPing(sceneId = "") {
  const scene = getSsSceneForMapPing(sceneId);
  return Array.from(scene?.tokens?.contents ?? scene?.tokens ?? []);
}

function getSsMapPingRequesterOwnedTokens(sceneId = "", userId = "") {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];
  const ownerLevel = Number(CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
  return getSsSceneTokensForMapPing(sceneId).filter((tokenDoc) => {
    const actor = tokenDoc?.actor ?? game.actors?.get?.(tokenDoc?.actorId) ?? null;
    const level = Number(actor?.ownership?.[uid] ?? 0);
    return Number.isFinite(level) && level >= ownerLevel;
  });
}

function findSsMapPingRequesterToken({ sceneId = "", userId = "", actorId = "", actorName = "" } = {}) {
  const cleanActorId = String(actorId ?? "").trim();
  const cleanActorName = String(actorName ?? "").trim().toLowerCase();
  const allTokens = getSsSceneTokensForMapPing(sceneId);
  const ownedTokens = getSsMapPingRequesterOwnedTokens(sceneId, userId);

  if (cleanActorId) {
    const byActorId = allTokens.find((tokenDoc) => String(tokenDoc?.actorId ?? "") === cleanActorId && !tokenDoc?.hidden)
      ?? ownedTokens.find((tokenDoc) => String(tokenDoc?.actorId ?? "") === cleanActorId && !tokenDoc?.hidden)
      ?? null;
    if (byActorId) return byActorId;
  }

  if (cleanActorName) {
    const byName = allTokens.find((tokenDoc) => {
      if (tokenDoc?.hidden) return false;
      const tokenName = String(tokenDoc?.name ?? "").trim().toLowerCase();
      const actorNameText = String(tokenDoc?.actor?.name ?? game.actors?.get?.(tokenDoc?.actorId)?.name ?? "").trim().toLowerCase();
      return tokenName === cleanActorName || actorNameText === cleanActorName;
    })
      ?? ownedTokens.find((tokenDoc) => {
        const tokenName = String(tokenDoc?.name ?? "").trim().toLowerCase();
        const actorNameText = String(tokenDoc?.actor?.name ?? game.actors?.get?.(tokenDoc?.actorId)?.name ?? "").trim().toLowerCase();
        return tokenName === cleanActorName || actorNameText === cleanActorName;
      })
      ?? null;
    if (byName) return byName;
  }

  const requester = game.users?.get?.(String(userId ?? "").trim()) ?? null;
  const requesterCharacterId = String(requester?.character?.id ?? "").trim();
  if (requesterCharacterId) {
    const byCharacter = ownedTokens.find((tokenDoc) => String(tokenDoc?.actorId ?? "") === requesterCharacterId && !tokenDoc?.hidden) ?? null;
    if (byCharacter) return byCharacter;
  }

  const characterOwned = ownedTokens.find((tokenDoc) => String(tokenDoc?.actor?.type ?? "") === "character" && !tokenDoc?.hidden) ?? null;
  if (characterOwned) return characterOwned;

  return ownedTokens.find((tokenDoc) => !tokenDoc?.hidden) ?? null;
}

function autoSelectSsMapPingRequesterToken(request = {}) {
  if (!game.user?.isGM) return { selected: false, reason: "not-gm", tokenDoc: null };
  if (!canvas?.ready) return { selected: false, reason: "canvas-not-ready", tokenDoc: null };

  const tokenDoc = findSsMapPingRequesterToken({
    sceneId: String(request?.sceneId ?? ""),
    userId: String(request?.userId ?? ""),
    actorId: String(request?.actorId ?? ""),
    actorName: String(request?.actorName ?? "")
  });
  if (!tokenDoc?.id) return { selected: false, reason: "not-found", tokenDoc: null };

  const viewedSceneId = String(game.scenes?.viewed?.id ?? canvas.scene?.id ?? "");
  const tokenSceneId = String(tokenDoc?.parent?.id ?? request?.sceneId ?? "");
  if (tokenSceneId && viewedSceneId && tokenSceneId !== viewedSceneId) {
    return { selected: false, reason: "wrong-scene", tokenDoc };
  }

  const tokenObj = canvas?.tokens?.get?.(tokenDoc.id) ?? tokenDoc?.object ?? null;
  if (!tokenObj) return { selected: false, reason: "not-on-canvas", tokenDoc };

  try {
    canvas.tokens?.releaseAll?.();
    tokenObj.control?.({ releaseOthers: true });
    syncSsBg3HotbarWithControlledToken();
    return { selected: !!tokenObj.controlled, reason: tokenObj.controlled ? "selected" : "control-failed", tokenDoc };
  } catch (_err) {
    return { selected: false, reason: "control-failed", tokenDoc };
  }
}

function captureSsCanvasControlState() {
  const controls = ui?.controls ?? null;
  const controlsList = Array.isArray(controls?.controls) ? controls.controls : [];
  const activeControlData = controls?.control ?? null;
  const activeControlDef = (() => {
    const byName = String(activeControlData?.name ?? "").trim().toLowerCase();
    if (byName) {
      const match = controlsList.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === byName);
      if (match) return match;
    }
    return controlsList.find((entry) => !!entry?.active) ?? activeControlData;
  })();
  const activeControl = String(
    activeControlData?.name
    ?? activeControlDef?.name
    ?? ""
  ).trim().toLowerCase();
  const activeTool = String(
    activeControlDef?.activeTool
    ?? activeControlDef?.tools?.find?.((tool) => !!tool?.active)?.name
    ?? ""
  ).trim().toLowerCase();
  return { activeControl, activeTool };
}

function isSsBg3HotbarActive() {
  return !!(game.modules?.get?.("bg3-inspired-hotbar")?.active && ui?.BG3HOTBAR);
}

function syncSsBg3HotbarWithControlledToken() {
  if (!isSsBg3HotbarActive()) return false;
  const hotbar = ui?.BG3HOTBAR ?? null;
  if (typeof hotbar?.generate !== "function") return false;

  const controlled = Array.from(canvas?.tokens?.controlled ?? []).filter(Boolean);
  const token = controlled.length === 1 ? controlled[0] : null;
  try {
    void hotbar.generate(token);
    return true;
  } catch (_err) {
    return false;
  }
}

function queueSsBg3HotbarSync(delayMs = 0) {
  if (!isSsBg3HotbarActive()) return false;
  const delay = Math.max(0, Number(delayMs) || 0);
  window.setTimeout(() => {
    syncSsBg3HotbarWithControlledToken();
  }, delay);
  return true;
}

function activateSsCanvasControlMode(controlName = "", toolName = "") {
  const control = String(controlName ?? "").trim().toLowerCase();
  if (!control) return false;
  const normalizedTool = String(toolName ?? "").trim().toLowerCase();

  let activated = false;
  const layerMap = {
    token: canvas?.tokens,
    templates: canvas?.templates,
    measuredtemplates: canvas?.templates,
    tiles: canvas?.tiles,
    drawings: canvas?.drawings,
    walls: canvas?.walls,
    lighting: canvas?.lighting,
    sounds: canvas?.sounds,
    notes: canvas?.notes
  };
  const layer = layerMap[control] ?? null;
  if (layer?.activate) {
    try {
      layer.activate();
      activated = true;
    } catch (_err) {
      // noop
    }
  }

  if (typeof ui?.controls?.activateControl === "function") {
    try {
      ui.controls.activateControl(control);
      activated = true;
    } catch (_err) {
      // noop
    }
  }

  if (normalizedTool && typeof ui?.controls?.activateTool === "function") {
    try {
      ui.controls.activateTool(normalizedTool);
      activated = true;
    } catch (_err) {
      // noop
    }
  }

  return activated;
}

function ensureSsTokenControlModeForMapPing() {
  return activateSsCanvasControlMode("token", "select");
}

function restoreSsCanvasControlState(state) {
  const control = String(state?.activeControl ?? "").trim().toLowerCase();
  if (!control) return false;
  const tool = String(state?.activeTool ?? "").trim().toLowerCase();
  return activateSsCanvasControlMode(control, tool || "select");
}

function getSsMapPingApprovalMode() {
  const raw = String(getSheetSidekickSetting("mapPingApprovalMode", "manual") ?? "manual").trim().toLowerCase();
  return raw === "auto" ? "auto" : "manual";
}

async function promptSsMapPingSnapshotApproval({ title = "Ping On Map Request", content = "", label = "Player" } = {}) {
  if (globalThis.Dialog) {
    try {
      const approved = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(!!value);
        };

        const dlg = new Dialog({
          title,
          content,
          buttons: {
            send: {
              icon: '<i class="fas fa-camera"></i>',
              label: "Send Snapshot",
              callback: () => finish(true)
            },
            cancel: {
              icon: '<i class="fas fa-times" style="color:#d94848;"></i>',
              label: "Cancel",
              callback: () => finish(false)
            }
          },
          default: "send",
          close: () => finish(false)
        });
        dlg.render(true);
      });
      return approved;
    } catch (_err) {
      // fall through to native confirm
    }
  }

  return !!globalThis.confirm?.(`${label} requested a ping-on-map snapshot. Pan/zoom to the desired area and click OK to send.`);
}

async function executeSsMapPingSnapshotCommand(data = {}) {
  const mode = String(data.mode ?? "").toLowerCase();
  if (!mode) return;

  if (mode === "request") {
    if (!game.user?.isGM) return;
    const ts = Number.parseInt(data.timestamp, 10);
    if (Number.isFinite(ts) && (Date.now() - ts > 45000)) return;

    const requestId = String(data.requestId ?? makeSsMapPingSnapshotRequestId());
    const requesterUserId = String(data.userId ?? "");
    if (!requesterUserId) return;

    const requester = game.users?.get?.(requesterUserId) ?? null;
    const requesterName = requester?.name ?? "Player";
    const actorName = String(data.actorName ?? "").trim();
    const actorId = String(data.actorId ?? "").trim();
    const sceneId = String(data.sceneId ?? "");
    const label = actorName ? `${requesterName} (${actorName})` : requesterName;

    ssMapPingSnapshotGmState.pending.set(requestId, {
      requestId,
      userId: requesterUserId,
      requesterName,
      actorName,
      actorId,
      sceneId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      capture: null
    });

    const approvalMode = getSsMapPingApprovalMode();
    ui.notifications?.info?.(`${label} requested a Ping on Map snapshot.${approvalMode === "auto" ? " Auto-send is enabled." : ""}`);

    const priorControlState = captureSsCanvasControlState();
    ensureSsTokenControlModeForMapPing();
    const viewedSceneId = String(game.scenes?.viewed?.id ?? canvas.scene?.id ?? "");
    const wrongSceneOpen = !!(sceneId && viewedSceneId && sceneId !== viewedSceneId);
    const tokenSelection = autoSelectSsMapPingRequesterToken({
      sceneId,
      userId: requesterUserId,
      actorId,
      actorName
    });
    const restoreControlMode = () => {
      const keepTokenModeForBg3 = isSsBg3HotbarActive() && (canvas?.tokens?.controlled?.length === 1);
      if (keepTokenModeForBg3) {
        activateSsCanvasControlMode("token", "select");
        syncSsBg3HotbarWithControlledToken();
        return;
      }
      restoreSsCanvasControlState(priorControlState);
      syncSsBg3HotbarWithControlledToken();
    };
    const selectedTokenName = String(tokenSelection?.tokenDoc?.name ?? actorName ?? "requesting token").trim() || "requesting token";
    const selectionHintHtml = tokenSelection?.selected
      ? `<p><strong>Token selected:</strong> ${escapeHtml(selectedTokenName)} was auto-selected for FOV/FOW capture.</p>`
      : `<p><strong>Important:</strong> Select that player's token first so the snapshot uses the correct FOV/FOW view before sending.</p>`;
    const content = `
      <div class="ss-map-ping-gm-request">
        <p><strong>${escapeHtml(label)}</strong> requested a low-quality map snapshot for a general ping.</p>
        ${selectionHintHtml}
        <p>Pan/zoom to the area you want them to reference, then click <strong>Send Snapshot</strong>.</p>
        <p>The snapshot hides hidden tiles, journal notes, drawings/templates, and canvas controls.</p>
        <p><em>Player taps are approximate pings only (no zoom).</em></p>
        ${wrongSceneOpen ? `<p style="color:#ffcf7d"><strong>Warning:</strong> Open the requested scene before sending.</p>` : ""}
      </div>
    `;

    const approved = approvalMode === "auto"
      ? true
      : await promptSsMapPingSnapshotApproval({
        title: "Ping On Map Request",
        content,
        label
      });

    if (!approved) {
      restoreControlMode();
      emitSsSocketMessage({
        type: "ssMapPingSnapshot",
        mode: "cancel",
        toUserId: requesterUserId,
        requestId,
        message: "GM cancelled the ping-on-map request.",
        timestamp: Date.now(),
        userId: game.user?.id ?? null
      });
      return;
    }

    try {
      const sent = await sendSsMapPingSnapshotToPlayer(requestId);
      if (!sent) {
        emitSsSocketMessage({
          type: "ssMapPingSnapshot",
          mode: "cancel",
          toUserId: requesterUserId,
          requestId,
          message: wrongSceneOpen
            ? "GM must open your requested scene before sending the map snapshot."
            : "GM could not send the map snapshot.",
          timestamp: Date.now(),
          userId: game.user?.id ?? null
        });
      }
    } catch (err) {
      console.error("Map ping snapshot send failed:", err);
      ui.notifications?.error?.("Failed to send map snapshot.");
      emitSsSocketMessage({
        type: "ssMapPingSnapshot",
        mode: "cancel",
        toUserId: requesterUserId,
        requestId,
        message: "GM could not send the map snapshot.",
        timestamp: Date.now(),
        userId: game.user?.id ?? null
      });
    } finally {
      restoreControlMode();
    }
    return;
  }

  if (mode === "tap") {
    if (!game.user?.isGM) return;
    const requestId = String(data.requestId ?? "");
    const req = ssMapPingSnapshotGmState.pending.get(requestId);
    if (!req?.capture) return;

    const requesterUserId = String(data.userId ?? "");
    if (!requesterUserId || requesterUserId !== String(req.userId ?? "")) return;
    const ts = Number.parseInt(data.timestamp, 10);
    if (Number.isFinite(ts) && (Date.now() - ts > 45000)) return;

    const nx = Number(data.nx);
    const ny = Number(data.ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    const viewedSceneId = String(game.scenes?.viewed?.id ?? canvas.scene?.id ?? "");
    if (req.capture.sceneId && viewedSceneId && req.capture.sceneId !== viewedSceneId) {
      ui.notifications?.warn?.("Map ping tap ignored because the GM is on a different scene now.");
      return;
    }

    try {
      const sx = nx * Number(req.capture.screenW || 0);
      const sy = ny * Number(req.capture.screenH || 0);
      const mat = new PIXI.Matrix(
        Number(req.capture.a || 1),
        Number(req.capture.b || 0),
        Number(req.capture.c || 0),
        Number(req.capture.d || 1),
        Number(req.capture.tx || 0),
        Number(req.capture.ty || 0)
      );
      const inv = mat.clone().invert();
      const point = inv.apply(new PIXI.Point(sx, sy));

      const pingUserId = String(req.userId ?? "");
      const pingSceneId = String(req.capture.sceneId || viewedSceneId || "");
      const pingUser = game.users?.get?.(pingUserId) ?? null;
      const pingColor = pingUser?.color?.css ?? pingUser?.color ?? null;
      const pingZoom = Number(req.capture.d || req.capture.a || canvas?.stage?.scale?.x || 1) || 1;
      const broadcasted = await broadcastSsPingForAllClients({
        x: point.x,
        y: point.y,
        sceneId: pingSceneId,
        zoom: pingZoom,
        style: "pulse",
        pull: false
      });
      if (!broadcasted) {
        drawSsPingLocallyForGm({ x: point.x, y: point.y, sceneId: pingSceneId, userId: pingUserId || game.user.id, color: pingColor });
      } else {
        drawSsPingLocallyForGm({ x: point.x, y: point.y, sceneId: pingSceneId, userId: pingUserId || game.user.id, color: pingColor });
      }
      ui.notifications?.info?.(`Map ping from ${req.requesterName}${req.actorName ? ` (${req.actorName})` : ""}.`);
    } catch (err) {
      console.warn("Map ping tap mapping failed:", err);
      ui.notifications?.warn?.("Could not place the map ping.");
    }
    return;
  }
}

function handleSsMapPingSnapshotSocketForPlayer(data = {}) {
  if (game.user?.isGM) return;
  const toUserId = String(data.toUserId ?? "");
  if (!toUserId || toUserId !== String(game.user?.id ?? "")) return;

  const mode = String(data.mode ?? "").toLowerCase();
  if (mode === "snapshot") {
    showSsMapPingSnapshotImage({
      requestId: String(data.requestId ?? ""),
      sceneId: String(data.sceneId ?? ""),
      image: String(data.image ?? "")
    });
    return;
  }

  if (mode === "cancel") {
    showSsMapPingSnapshotCancelled(String(data.message ?? "GM cancelled the ping-on-map request."));
  }
}

Hooks.once("ready", () => {
  if (globalThis.__SS_SHEET_SIDEKICK_SOCKET_BOUND__ || globalThis.__SS_CUSTOM_JS_SOCKET_BOUND__) return;
  globalThis.__SS_SHEET_SIDEKICK_SOCKET_BOUND__ = true;
  globalThis.__SS_CUSTOM_JS_SOCKET_BOUND__ = true; // keep legacy guard key for compatibility

  const handleSsSocketMessage = async (data) => {
    if (!data || typeof data !== "object") return;

    if (data.type === "ssControls" && !game.user?.isGM) {
      const enabled = !!data.enabled;
      setDpadEnabledOverride(enabled);
      refreshSheetSidekickForms();
      queueSheetSidekickFormRefresh(180);
      return;
    }

    if (data.type === "ssDpadViewportLock" && !game.user?.isGM) {
      setPlayerDpadViewportLockState(data);
      syncOpenSheetDpadLocks();
      syncOpenTargetPanelsWithLiveTargets();
      refreshAllUseConfirmLiveTargetSummaries();
      return;
    }

    if (data.type === "ssTargetListState" && !game.user?.isGM) {
      const sceneId = String(data.sceneId ?? "").trim();
      setSsGmSceneId(sceneId, { resetManualTargets: false });
      setSsManualTargetList(sceneId, {
        actorIds: Array.isArray(data.actorIds) ? data.actorIds : [],
        tokenIds: Array.isArray(data.tokenIds) ? data.tokenIds : []
      });
      refreshSheetSidekickForms();
      syncOpenTargetPanelsWithLiveTargets();
      refreshAllUseConfirmLiveTargetSummaries();
      return;
    }

    if (data.type === "ssPause" && !game.user?.isGM) {
      syncPlayerPauseBanner(!!data.paused);
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

    if (data.type === "ssRest" && game.user?.isGM) {
      const exec = globalThis.__SS_EXECUTE_REST_COMMAND__;
      if (typeof exec === "function") {
        await exec({
          actorId: data.actorId ?? "",
          restType: String(data.restType ?? ""),
          timestamp: Number.parseInt(data.timestamp, 10),
          userId: data.userId ?? null
        });
      } else if (typeof globalThis.__SS_REST_CHAT_HOOK__ === "function") {
        await globalThis.__SS_REST_CHAT_HOOK__({
          content: `!ss-rest ${data.actorId ?? ""} ${String(data.restType ?? "")} ${Number.parseInt(data.timestamp, 10)}`,
          author: { id: data.userId ?? null },
          user: { id: data.userId ?? null }
        });
      }
      return;
    }

    if (data.type === "ssPrep" && game.user?.isGM) {
      const exec = globalThis.__SS_EXECUTE_PREP_COMMAND__;
      if (typeof exec === "function") {
        await exec({
          actorId: data.actorId ?? "",
          itemId: data.itemId ?? "",
          prepared: data.prepared,
          timestamp: Number.parseInt(data.timestamp, 10),
          userId: data.userId ?? null
        });
      } else if (typeof globalThis.__SS_PREP_CHAT_HOOK__ === "function") {
        await globalThis.__SS_PREP_CHAT_HOOK__({
          content: `!ss-prep ${data.actorId ?? ""} ${data.itemId ?? ""} ${data.prepared ? "1" : "0"} ${Number.parseInt(data.timestamp, 10)} ${data.userId ?? ""}`,
          author: { id: data.userId ?? null },
          user: { id: data.userId ?? null }
        });
      }
      return;
    }

    if (data.type === "ssTargetUiSync" && !game.user?.isGM) {
      const incomingSceneId = String(data.sceneId ?? "").trim();
      if (incomingSceneId) setSsGmSceneId(incomingSceneId, { resetManualTargets: false });
      syncOpenTargetPanelsWithLiveTargets();
      refreshAllUseConfirmLiveTargetSummaries();
      return;
    }

    if (data.type === "ssJournalImageShow" && !game.user?.isGM) {
      showSsSharedJournalImageForPlayer(data);
      return;
    }

    if (data.type === "ssBurstRuler" && !game.user?.isGM) {
      handleSsBurstRulerSocketForPlayer(data);
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

    if (data.type === "ssMapPingSnapshot") {
      if (game.user?.isGM) {
        await executeSsMapPingSnapshotCommand(data);
      } else {
        handleSsMapPingSnapshotSocketForPlayer(data);
      }
      return;
    }

    // no-op: target apply is handled via whisper chat command path
  };

  game.socket?.on?.(SS_SOCKET_CHANNEL_PRIMARY, handleSsSocketMessage);
});

function decorateAlwaysPreparedSpellRowsForGm(app, element) {
  try {
    if (!game.user?.isGM) return;
    if (!isSheetSidekickModuleActive()) return;

    const actor = app?.actor;
    if (!actor) return;

    const root = (element instanceof HTMLElement) ? element : (element?.[0] instanceof HTMLElement) ? element[0] : null;
    if (!root) return;
    const scope = (root.tagName === "FORM") ? root : (root.querySelector("form") ?? root);
    if (!(scope instanceof HTMLElement)) return;

    scope.querySelectorAll("li.item[data-item-id]").forEach((row) => {
      const itemId = String(row?.dataset?.itemId ?? "").trim();
      if (!itemId) return;
      const item = actor.items?.get?.(itemId) ?? null;
      const prepMode = getSpellPreparationMethod(item);
      const isAlwaysPreparedSpell = isAlwaysPreparedSpellItem(item) || (item?.type === "spell" && prepMode === "always");
      row.classList.toggle("ss-spell-always-prepared", isAlwaysPreparedSpell);

      const prepBtn = row.querySelector(".item-action[data-action='prepare'], .item-action[data-action='ssPrepareToggle']");
      if (!(prepBtn instanceof HTMLElement)) return;
      prepBtn.classList.toggle("ss-prepare-always", isAlwaysPreparedSpell);
    });
  } catch (err) {
    console.error("Sheet Sidekick GM always-prepared decorator failed:", err);
  }
}

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
    const isIosSafariClient = document.body.classList.contains("ss-ios-safari");
    const clearActiveActionFocus = () => {
      if (!isIosSafariClient) return;
      const ae = document.activeElement;
      if (!(ae instanceof HTMLElement)) return;
      if (ae.matches("input, textarea, select")) return;
      if (!ae.closest("li.item, .item-controls, .item-control, .item-action")) return;
      ae.blur?.();
    };

    let decorateQueued = false;
    const queueDecorate = () => {
      if (decorateQueued) return;
      decorateQueued = true;
      requestAnimationFrame(() => {
        decorateQueued = false;
        decorateInfoButtons();
      });
    };

    let queuedRestoreRaf = 0;
    let queuedRestoreTimer = 0;
    const queueRestore = (delayMs = 0) => {
      if (queuedRestoreRaf) {
        cancelAnimationFrame(queuedRestoreRaf);
        queuedRestoreRaf = 0;
      }
      if (queuedRestoreTimer) {
        window.clearTimeout(queuedRestoreTimer);
        queuedRestoreTimer = 0;
      }
      const run = () => restoreSheetScroll(scope, actor);
      const delay = Math.max(0, Number(delayMs) || 0);
      if (delay > 0) {
        queuedRestoreTimer = window.setTimeout(() => {
          queuedRestoreTimer = 0;
          queuedRestoreRaf = requestAnimationFrame(() => {
            queuedRestoreRaf = 0;
            run();
          });
        }, delay);
        return;
      }
      queuedRestoreRaf = requestAnimationFrame(() => {
        queuedRestoreRaf = 0;
        run();
      });
    };
    const queueRehydrate = () => {
      queueDecorate();
      queueRestore();
      setTimeout(() => {
        queueDecorate();
      }, 120);
    };

    const decorateInfoButtons = () => {
      ensureSheetSidekickRestButtons(scope, actor);
      ensureActionFilterBars(scope, actor);
      scope.querySelectorAll("li.item[data-item-id]").forEach(row => {
        const itemId = row.dataset?.itemId;
        if (!itemId) return;

        const item = actor.items.get(itemId);
        const prepMode = getSpellPreparationMethod(item);
        const isAlwaysPreparedSpell = isAlwaysPreparedSpellItem(item) || (item?.type === "spell" && prepMode === "always");
        const prepBtn = row.querySelector(".item-action[data-action='prepare'], .item-action[data-action='ssPrepareToggle']");
        row.classList.toggle("ss-spell-always-prepared", isAlwaysPreparedSpell);
        if (prepBtn instanceof HTMLElement) {
          if (item?.type === "spell" && prepMode !== "always") {
            if (prepBtn.dataset.ssPrepPatched !== "1") {
              prepBtn.dataset.ssOriginalAction = String(prepBtn.dataset.action ?? "prepare");
              prepBtn.dataset.action = "ssPrepareToggle";
              prepBtn.dataset.ssPrepPatched = "1";
            }
          } else if (prepBtn.dataset.ssPrepPatched === "1") {
            prepBtn.dataset.action = String(prepBtn.dataset.ssOriginalAction ?? "prepare");
            delete prepBtn.dataset.ssPrepPatched;
            delete prepBtn.dataset.ssOriginalAction;
          }
          prepBtn.classList.toggle("ss-prepare-always", isAlwaysPreparedSpell);
          prepBtn.classList.toggle("ss-prepare-locked", isAlwaysPreparedSpell);
          if (isAlwaysPreparedSpell) {
            prepBtn.setAttribute("aria-disabled", "true");
            prepBtn.setAttribute("title", "Always Prepared (locked)");
            if (prepBtn instanceof HTMLButtonElement) {
              prepBtn.disabled = true;
            } else {
              prepBtn.setAttribute("disabled", "disabled");
            }
          } else {
            prepBtn.removeAttribute("aria-disabled");
            if (prepBtn instanceof HTMLButtonElement) {
              prepBtn.disabled = false;
            } else {
              prepBtn.removeAttribute("disabled");
            }
          }
        }
        const qtyInput = row.querySelector(".item-detail.item-quantity input[data-name='system.quantity']");
        if (qtyInput instanceof HTMLInputElement) {
          qtyInput.readOnly = false;
          qtyInput.removeAttribute("aria-readonly");
          qtyInput.disabled = false;
        }
        row.querySelectorAll(".item-detail.item-quantity .adjustment-button").forEach((btn) => {
          btn.removeAttribute("aria-disabled");
          btn.removeAttribute("disabled");
          btn.classList.remove("disabled");
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
          infoBtn.style.marginLeft = "0";
          infoBtn.style.marginTop = "0";
          infoBtn.style.border = "1px solid var(--color-border-light-2, #666)";
          infoBtn.style.borderRadius = "4px";
          infoBtn.style.background = "rgba(0,0,0,0.15)";
          infoBtn.style.minWidth = "1.8rem";
          infoBtn.style.width = "1.8rem";
          infoBtn.style.height = "1.8rem";
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
          infoBtn.style.marginLeft = "0";
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

    const isActionTouchTarget = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      return !!target.closest(
        ".item-action, .item-control, .ss-tooltip-btn, .item-name[data-action='ssUseItem'], .item-name [data-action='ssUseItem'], h4[data-action='ssUseItem'], [data-action='ssUseItem']"
      );
    };

    const saveBeforeMutation = (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest(".item-action, .item-control, .ss-tooltip-btn, button, input, select, .item-name[data-action='ssUseItem'], [data-action='ssUseItem']")) return;
      recordSsScrollTrace("ui.saveBeforeMutation", {
        actorId: String(actor?.id ?? ""),
        target: describeSsElementForTrace(target)
      });
      saveSheetScroll(scope, actor);
      if (isIosSafariClient && isActionTouchTarget(target)) {
        window.setTimeout(clearActiveActionFocus, 0);
      }
    };
    const onDropRestore = () => {
      saveSheetScroll(scope, actor);
      queueRestore();
    };
    const iosTouchState = {
      candidate: false,
      moved: false,
      startX: 0,
      startY: 0
    };
    const onTouchStartTrack = (event) => {
      if (!isIosSafariClient) return;
      const target = event?.target;
      if (!isActionTouchTarget(target)) {
        iosTouchState.candidate = false;
        return;
      }
      const touch = event?.changedTouches?.[0] ?? event?.touches?.[0] ?? null;
      if (!touch) {
        iosTouchState.candidate = false;
        return;
      }
      iosTouchState.candidate = true;
      iosTouchState.moved = false;
      iosTouchState.startX = Number(touch.clientX ?? 0);
      iosTouchState.startY = Number(touch.clientY ?? 0);
    };
    const onTouchMoveTrack = (event) => {
      if (!isIosSafariClient || !iosTouchState.candidate) return;
      const touch = event?.changedTouches?.[0] ?? event?.touches?.[0] ?? null;
      if (!touch) return;
      const dx = Number(touch.clientX ?? 0) - iosTouchState.startX;
      const dy = Number(touch.clientY ?? 0) - iosTouchState.startY;
      if ((dx * dx + dy * dy) > 100) iosTouchState.moved = true; // >10px
    };
    const onTouchEndRestore = (event) => {
      if (!isIosSafariClient) return;
      const target = event?.target;
      const shouldRestore = iosTouchState.candidate && !iosTouchState.moved && isActionTouchTarget(target);
      iosTouchState.candidate = false;
      iosTouchState.moved = false;
      if (!shouldRestore) return;
      recordSsScrollTrace("ui.touchend.action", {
        actorId: String(actor?.id ?? ""),
        target: describeSsElementForTrace(target)
      });
      clearActiveActionFocus();
      queueRestore(24);
    };
    const onTouchCancelTrack = () => {
      iosTouchState.candidate = false;
      iosTouchState.moved = false;
    };
    scope.addEventListener("pointerdown", saveBeforeMutation, true);
    scope.addEventListener("change", saveBeforeMutation, true);
    scope.addEventListener("dragstart", saveBeforeMutation, true);
    scope.addEventListener("drop", onDropRestore, true);
    scope.addEventListener("touchstart", onTouchStartTrack, true);
    scope.addEventListener("touchmove", onTouchMoveTrack, true);
    scope.addEventListener("touchend", onTouchEndRestore, true);
    scope.addEventListener("touchcancel", onTouchCancelTrack, true);

    let lastTapTs = 0;
    let confirmOpen = false;

    scope.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const restTrigger = target.closest(
        ".ss-rest-trigger, .sheet-header .sheet-header-buttons > button[data-action='shortRest'], .sheet-header .sheet-header-buttons > button[data-action='longRest']"
      );
      if (restTrigger instanceof HTMLElement) {
        const restType = String(
          restTrigger.dataset?.ssRest
          ?? restTrigger.dataset?.action
          ?? ""
        ).trim().toLowerCase().includes("long") ? "long" : "short";

        saveSheetScroll(scope, actor);
        queueRestore();
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();

        if (!getActiveGmIds().length) {
          showSsNoActiveGmDialog({ actionLabel: `Taking a ${restType} rest` });
          return;
        }

        if (confirmOpen) return;
        confirmOpen = true;
        const decision = await confirmSsRest(actor, restType);
        confirmOpen = false;
        if (!decision?.confirmed) return;

        const commandTs = Date.now();
        sendRestInfoToGmWhisper(actor, restType);
        const sent = sendCommandToGmSocket("ssRest", {
          actorId: actor.id,
          restType,
          timestamp: commandTs,
          userId: game.user?.id ?? null
        });
        if (!sent) {
          sendCommandToGmWhisper(`!ss-rest ${actor.id} ${restType} ${commandTs}`, {
            noGmActionLabel: `Taking a ${restType} rest`
          });
        }
        return;
      }

      if (target.closest(".item-action[data-action='equip']")) {
        const equipBtn = target.closest(".item-action[data-action='equip']");
        if (equipBtn instanceof HTMLElement) {
          const row = equipBtn.closest("li.item[data-item-id]");
          const itemId = String(row?.dataset?.itemId ?? "").trim();
          const item = itemId ? actor.items.get(itemId) : null;
          if (item) {
            const hasGm = getActiveGmIds().length > 0;
            if (!hasGm) {
              event.preventDefault();
              event.stopPropagation();
              if (event.stopImmediatePropagation) event.stopImmediatePropagation();
              showSsNoActiveGmDialog({ actionLabel: "Equipping/unequipping items" });
              return;
            }
            markSsEquipPending(actor.id, item.id);
          }
        }
        saveSheetScroll(scope, actor);
        setTimeout(() => {
          queueDecorate();
          queueRestore();
        }, 50);
        return;
      }

      if (target.closest(".item-action[data-action='ssPrepareToggle'], .item-action[data-action='prepare']")) {
        clearActiveActionFocus();
        recordSsScrollTrace("ui.prepareClick", {
          actorId: String(actor?.id ?? ""),
          target: describeSsElementForTrace(target)
        });
        const prepareBtn = target.closest(".item-action[data-action='ssPrepareToggle'], .item-action[data-action='prepare']");
        if (prepareBtn instanceof HTMLElement) {
          const row = prepareBtn.closest("li.item[data-item-id]");
          const itemId = String(row?.dataset?.itemId ?? "").trim();
          const item = itemId ? actor.items.get(itemId) : null;
          const prepMode = getSpellPreparationMethod(item);
          const lockedAlwaysPrepared = !!(
            prepareBtn.classList.contains("ss-prepare-always")
            || row?.classList?.contains("ss-spell-always-prepared")
            || isAlwaysPreparedSpellItem(item)
            || (item?.type === "spell" && prepMode === "always")
          );
          if (lockedAlwaysPrepared) {
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
            ui.notifications?.info?.("Always Prepared spells are locked.");
            return;
          }
          if (item?.type === "spell" && prepMode !== "always") {
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
            if (!getActiveGmIds().length) {
              showSsNoActiveGmDialog({ actionLabel: "Preparing/unpreparing spells" });
              return;
            }
            const currentlyPressed = prepareBtn.getAttribute("aria-pressed") === "true" || prepareBtn.classList.contains("active");
            queueSsSpellPrepareToggle({
              actor,
              item,
              desiredPrepared: !currentlyPressed
            });
            queueRestore();
          }
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
        clearActiveActionFocus();
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
        clearActiveActionFocus();
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
          sendCommandToGmWhisper(`!ss-roll ${actor.id} ${rollRequest.kind} ${rollRequest.key} ${commandTs}`, {
            noGmActionLabel: "Rolling checks"
          });
        }
        return;
      }

      const nameTapTarget = target.closest(
        ".item-name[data-action='ssUseItem'], .item-name [data-action='ssUseItem'], h4[data-action='ssUseItem'], [data-action='ssUseItem']"
      );
      if (!nameTapTarget) return;
      clearActiveActionFocus();

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
      if (!sent && !getActiveGmIds().length) {
        showSsNoActiveGmDialog({ actionLabel: "Using items" });
        return;
      }
      if (!sent) {
        const levelPart = hasSlotLevel ? String(slotLevel) : (ammoItemId ? "0" : "");
        const levelSuffix = levelPart ? ` ${levelPart}` : "";
        const ammoSuffix = ammoItemId ? ` ${ammoItemId}` : "";
        sendCommandToGmWhisper(`!ss-use ${actor.id} ${itemId} ${commandTs}${levelSuffix}${ammoSuffix}`);
      }
      if (decision?.requestPlacementPing) {
        requestSsMapPingSnapshot({
          actorName: actor?.name ?? "",
          actorId: actor?.id ?? "",
          sceneId: game.scenes?.viewed?.id ?? ""
        });
      }
    }, { capture: true });

    app.once?.("close", () => {
      scrollEls.forEach(el => el.removeEventListener("scroll", onScroll));
      scope.removeEventListener("contextmenu", onContextMenu, true);
      scope.removeEventListener("pointerdown", saveBeforeMutation, true);
      scope.removeEventListener("change", saveBeforeMutation, true);
      scope.removeEventListener("dragstart", saveBeforeMutation, true);
      scope.removeEventListener("drop", onDropRestore, true);
      scope.removeEventListener("touchstart", onTouchStartTrack, true);
      scope.removeEventListener("touchmove", onTouchMoveTrack, true);
      scope.removeEventListener("touchend", onTouchEndRestore, true);
      scope.removeEventListener("touchcancel", onTouchCancelTrack, true);
      if (rehydrateTimer) window.clearTimeout(rehydrateTimer);
      if (queuedRestoreTimer) window.clearTimeout(queuedRestoreTimer);
      if (queuedRestoreRaf) cancelAnimationFrame(queuedRestoreRaf);
      observer.disconnect();
    });
  } catch (e) {
    console.error("Tap-to-cast inject error:", e);
  }
}

Hooks.on("renderActorSheetV2", decorateAlwaysPreparedSpellRowsForGm);
Hooks.on("renderActorSheet", decorateAlwaysPreparedSpellRowsForGm);
Hooks.on("renderActorSheetV2", bindTapToCast);
Hooks.on("renderActorSheet", bindTapToCast);
Hooks.on("renderJournalSheet", bindVanillaJournalImageShare);
Hooks.on("renderJournalPageSheet", bindVanillaJournalImageShare);
Hooks.on("renderJournalTextPageSheet", bindVanillaJournalImageShare);
Hooks.on("renderJournalImagePageSheet", bindVanillaJournalImageShare);
Hooks.once("ready", bindGlobalJournalImageShareListener);
Hooks.on("updateUser", (_user, changed) => {
  if (game.user?.isGM) return;
  const activeChanged = !!foundry?.utils?.hasProperty?.(changed, "active");
  if (!activeChanged) return;
  refreshSsMapPingSnapshotRequestButtonForPlayer();
});
Hooks.on("renderActorSheetV2", applySheetSidekickUiCleanup);
Hooks.on("renderActorSheet", applySheetSidekickUiCleanup);
Hooks.on("renderActorSheetV2", (app) => {
  if (game.user?.isGM) return;
  const actorId = String(app?.actor?.id ?? "");
  if (!actorId) return;
  recordSsScrollTrace("renderActorSheetV2", { actorId });
  queueOpenSheetScrollRestore(actorId, 0);
});
Hooks.on("renderActorSheet", (app) => {
  if (game.user?.isGM) return;
  const actorId = String(app?.actor?.id ?? "");
  if (!actorId) return;
  recordSsScrollTrace("renderActorSheet", { actorId });
  queueOpenSheetScrollRestore(actorId, 0);
});
Hooks.on("canvasReady", () => {
  if (game.user?.isGM) return;
  queueSheetSidekickFormRefresh(80);
});
Hooks.on("controlToken", () => {
  queueSsBg3HotbarSync(0);
  queueSsBg3HotbarSync(45);
});
Hooks.on("canvasReady", () => {
  queueSsBg3HotbarSync(80);
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
Hooks.on("renderApplicationV2", (app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : (html?.[0] instanceof HTMLElement ? html[0] : null);
  const rootClassList = root?.classList ?? null;
  const optionsClasses = Array.isArray(app?.options?.classes) ? app.options.classes : [];
  const isShort = !!(rootClassList?.contains?.("short-rest") || optionsClasses.includes("short-rest"));
  const isLong = !!(rootClassList?.contains?.("long-rest") || optionsClasses.includes("long-rest"));
  if (!root || (!isShort && !isLong)) return;

  const actorId = String(app?.document?.id ?? app?.actor?.id ?? app?.options?.document?.id ?? "").trim();
  const pending = consumeSsPendingRestDialogLabel(actorId, isLong ? "long" : "short")
    ?? (!actorId ? consumeSsPendingRestDialogLabel("", isLong ? "long" : "short") : null)
    ?? (() => {
      const now = Date.now();
      const idx = ssPendingRestDialogLabels.findIndex((entry) => (
        entry.restType === (isLong ? "long" : "short")
        && Number(entry?.expiresAt ?? 0) > now
      ));
      if (idx < 0) return null;
      return ssPendingRestDialogLabels.splice(idx, 1)[0] ?? null;
    })();
  if (!pending) return;

  const titleText = `${pending.actorName} - ${isLong ? "Long Rest" : "Short Rest"}`;
  const titleEl = root.querySelector(".window-title");
  if (titleEl instanceof HTMLElement) titleEl.textContent = titleText;

  let subtitleEl = root.querySelector(".window-subtitle");
  if (!(subtitleEl instanceof HTMLElement)) {
    subtitleEl = root.querySelector(".ss-rest-request-subtitle");
  }
  if (!(subtitleEl instanceof HTMLElement)) {
    subtitleEl = document.createElement("h2");
    subtitleEl.className = "window-subtitle ss-rest-request-subtitle";
    subtitleEl.style.cssText = "font-size:.82rem; font-weight:600; color:rgba(240,224,185,.92); margin:0;";
    const titleNode = root.querySelector(".window-title");
    titleNode?.insertAdjacentElement("afterend", subtitleEl);
  }
  subtitleEl.textContent = `Requested for ${pending.actorName}`;
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
    if (Number.isFinite(timestamp) && (Date.now() - timestamp > 10000)) {
      console.warn("Dropped old DPAD command due to lag:", Date.now() - timestamp, "ms");
      return;
    }

    if (!["up", "down", "left", "right"].includes(String(dir ?? "").toLowerCase())) return;
    if (!userId) return;
    if (getCombatTurnAccessForUser(userId, { combat: getActiveCombatForViewedScene() }).locked) return;

    const tokenDoc = pickTokenForUser(userId);
    if (!tokenDoc) return ui.notifications.warn("No owned token for that user in viewed scene.");
    if (!isSsTokenVisibleInGmViewport(tokenDoc)) {
      queueSsDpadViewportLockSyncFromGm(String(tokenDoc?.parent?.id ?? game.scenes?.viewed?.id ?? canvas?.scene?.id ?? ""));
      return;
    }

    const size = canvas.grid.size;
    const dx = (dir === "left" ? -1 : dir === "right" ? 1 : 0) * size;
    const dy = (dir === "up" ? -1 : dir === "down" ? 1 : 0) * size;

    const target = snapAndClampTokenPosition(tokenDoc, tokenDoc.x + dx, tokenDoc.y + dy, size);
    if (target.x === tokenDoc.x && target.y === tokenDoc.y) return;
    resetSsGmBurstRulerIfExpired(tokenDoc);
    const previous = {x: Number(tokenDoc.x ?? 0), y: Number(tokenDoc.y ?? 0)};
    await tokenDoc.move(target, {
      method: "dragging",
      showRuler: true,
      constrainOptions: {
        ignoreWalls: true,
        ignoreCost: true
      }
    });
    recordSsGmBurstRuler(tokenDoc, previous, target, userId);
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
          const viewedSceneId = getSsKnownGmSceneId() || null;
        const sameScene = !proxyTargets.sceneId || !viewedSceneId || proxyTargets.sceneId === viewedSceneId;
        if (sameScene) {
          applyTargetsForCurrentGmUser(proxyTargets.tokenIds ?? [], { sceneId: proxyTargets.sceneId ?? "" });
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

// 6. GM EXECUTION LOGIC FOR SHEET-SIDEKICK REST REQUESTS
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const COMMAND_PREFIX = "!ss-rest";

  const executeSsRestCommand = async ({ actorId, restType, timestamp, userId }) => {
    if (!actorId || !restType) return;
    if (Number.isFinite(timestamp) && (Date.now() - timestamp > 20000)) return;
    if (!userId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.warn("Requested rest actor not found.");

    const ownership = actor.ownership?.[userId] ?? 0;
    if (ownership < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
      return ui.notifications.warn("Player does not own that actor.");
    }

    const normalized = String(restType ?? "").trim().toLowerCase() === "long" ? "long" : "short";
    try {
      queueSsPendingRestDialogLabel(actor, normalized);
      if (normalized === "long") {
        await actor.longRest({ dialog: true, chat: true });
      } else {
        await actor.shortRest({ dialog: true, chat: true });
      }
    } catch (err) {
      console.error("Sheet Sidekick rest execution error:", err);
      ui.notifications.error(`Failed to start ${getSsRestButtonLabel(normalized)}.`);
    }
  };
  globalThis.__SS_EXECUTE_REST_COMMAND__ = executeSsRestCommand;

  if (globalThis.__SS_REST_CHAT_HOOK__) Hooks.off("createChatMessage", globalThis.__SS_REST_CHAT_HOOK__);

  globalThis.__SS_REST_CHAT_HOOK__ = async (msg) => {
    const text = normalizeChatCommandText(msg.content);
    if (!text.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const parts = text.split(/\s+/);
    const actorId = parts[1] ?? "";
    const restType = String(parts[2] ?? "").trim();
    const timestamp = Number.parseInt(parts[3], 10);
    const userId = msg.author?.id ?? msg.user?.id;
    await executeSsRestCommand({ actorId, restType, timestamp, userId });
  };

  Hooks.on("createChatMessage", globalThis.__SS_REST_CHAT_HOOK__);
});

// 7. GM EXECUTION LOGIC FOR SHEET-SIDEKICK SPELL PREP TOGGLE
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const COMMAND_PREFIX = "!ss-prep";

  const executeSsPrepCommand = async ({ actorId, itemId, prepared, timestamp, userId }) => {
    if (!actorId || !itemId) return;
    if (Number.isFinite(timestamp) && (Date.now() - timestamp > 20000)) return;
    if (!userId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;
    const ownership = actor.ownership?.[userId] ?? 0;
    if (ownership < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) return;

    const item = actor.items.get(itemId);
    if (!item || item.type !== "spell") return;
    if (isAlwaysPreparedSpellItem(item)) return;
    const prepMode = getSpellPreparationMethod(item);
    if (prepMode === "always") return;

    const nextPrepared = (prepared === true) || String(prepared ?? "").trim() === "1" || String(prepared ?? "").toLowerCase() === "true";
    const currentPrepared = isSpellPrepared(item);
    if (nextPrepared === currentPrepared) return;

    try {
      await item.update({ "system.prepared": nextPrepared });
    } catch (err) {
      console.error("Sheet Sidekick prep toggle failed:", err);
    }
  };
  globalThis.__SS_EXECUTE_PREP_COMMAND__ = executeSsPrepCommand;

  if (globalThis.__SS_PREP_CHAT_HOOK__) Hooks.off("createChatMessage", globalThis.__SS_PREP_CHAT_HOOK__);

  globalThis.__SS_PREP_CHAT_HOOK__ = async (msg) => {
    const text = normalizeChatCommandText(msg.content);
    if (!text.toLowerCase().startsWith(COMMAND_PREFIX)) return;

    const parts = text.split(/\s+/);
    const actorId = parts[1] ?? "";
    const itemId = parts[2] ?? "";
    const prepared = parts[3] ?? "0";
    const timestamp = Number.parseInt(parts[4], 10);
    const explicitUserId = parts[5] ?? null;
    const userId = explicitUserId ?? msg.author?.id ?? msg.user?.id ?? null;
    await executeSsPrepCommand({ actorId, itemId, prepared, timestamp, userId });
  };

  Hooks.on("createChatMessage", globalThis.__SS_PREP_CHAT_HOOK__);
});

// 8. GM EXECUTION LOGIC FOR SHEET-SIDEKICK TARGETING
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
