function ssL10n(key) {
  return game.i18n.localize(key);
}
const SS_CORE_CLASS = {
  sheet: "ss-sheet",
  container: "ss-container",
  actorList: "ss-actor-list",
  hide: "ss-hide"
};
const SS_CORE_SELECTOR = {
  sheet: ".ss-sheet",
  container: ".ss-container",
  actorList: ".ss-actor-list"
};
function getCurrentUserSidekickData() {
  let playerdata = game.settings.get(moduleId, "playerdata");
  return playerdata[game.user.id];
}
function shouldUseSidekickMode() {
  let userData = getCurrentUserSidekickData();
  return !!userData?.display;
}
const actorStorage = {
  current: null
};
function saveLastActorId(actorId) {
  game.settings.set(moduleId, "lastActorId", actorId);
}
function getLastActorId() {
  return game.settings.get(moduleId, "lastActorId");
}
function dnd5eReadyHook() {
  if (!isDnd5e()) {
    return;
  }
  document.body.addEventListener("click", activateTooltipFromEvent, true);
}
function isDnd5e() {
  return game.system.id === "dnd5e";
}
function activateTooltipFromEvent(event) {
  let element = event.target;
  while (element) {
    if (element.hasAttribute("data-tooltip-class")) {
      game.tooltip.activate(element);
      break;
    }
    element = element.parentElement;
  }
}
function syncActiveActorAfterTransform(fromActor, toActor) {
  if (!shouldUseSidekickMode()) {
    return;
  }
  if (actorStorage.current?.id === fromActor.id) {
    actorStorage.current = toActor;
  }
}
const moduleId = "sheet-sidekick";
const registerSettings = () => {
  game.settings.registerMenu(moduleId, "settingsMenu", {
    name: ssL10n("Sheet-Sidekick.access-panel.name"),
    label: ssL10n("Sheet-Sidekick.access-panel.label"),
    hint: ssL10n("Sheet-Sidekick.access-panel.hint"),
    icon: "fas fa-users",
    type: SidekickAccessPanelApp,
    restricted: true
  });
  game.settings.register(moduleId, "lastActorId", {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(moduleId, "playerdata", {
    scope: "world",
    config: false,
    default: {},
    type: Object
  });
  game.settings.register(moduleId, "mapPingApprovalMode", {
    name: "Ping On Map Approval Mode",
    hint: "Manual asks the GM before sending a snapshot. Auto sends immediately without prompting.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      manual: "Manual (Ask GM)",
      auto: "Auto (No Prompt)"
    },
    default: "manual"
  });
  game.settings.register(moduleId, "journalImageDisplaySeconds", {
    name: "Journal Image Display Duration",
    hint: "How many seconds a shared journal image stays visible for Sheet Sidekick players before auto-hiding.",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    range: {
      min: 1,
      max: 120,
      step: 1
    },
    default: 20
  });
};
class SidekickAccessPanelApp extends FormApplication {
  constructor(options = {}) {
    super(options);
  }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "sheet-sidekick",
      title: "Sheet Sidekick",
      template: "./modules/sheet-sidekick/templates/player-access-panel.html",
      width: 500,
      height: "auto",
      popOut: true
    });
  }
  getData(options) {
    let playerdata = game.settings.get(moduleId, "playerdata");
    let players = game.users.filter((u) => !u.isGM).map((u) => {
      let data = playerdata[u.id] || {};
      return foundry.utils.mergeObject({
        id: u.id,
        name: u.name,
        display: false
      }, data);
    });
    return {
      players
    };
  }
  saveData() {
    let playerdata = game.settings.get(moduleId, "playerdata");
    $(".item-list .item", this.element).each(function() {
      let id = this.dataset.itemId;
      let data = playerdata[id] || {};
      data.display = $(".display", this).is(":checked");
      delete data.allowObserver;
      delete data.screenwidth;
      delete data.mobile;
      delete data.mirror;
      delete data.selection;
      playerdata[id] = data;
    });
    game.settings.set(moduleId, "playerdata", playerdata);
    this.close();
  }
  activateListeners(html) {
    super.activateListeners(html);
    $(".dialog-buttons.save", html).click($.proxy(this.saveData, this));
  }
}
function initializeCoreRuntime() {
  registerSettings();
}
function registerModuleApi() {
  game.modules.get(moduleId).api = {
    // This sheet-sidekick version is compatible with the following sheet-sidekick-plus version
    plusCompatibility: "1.3.0",
    getCurrentActor: function() {
      return actorStorage.current;
    },
    isSheetSidekick: function() {
      return shouldUseSidekickMode();
    }
  };
}
async function setupCoreRuntime() {
  if (!shouldUseSidekickMode()) {
    return;
  }
  await enforceNoCanvasForSidekickPlayer();
  registerModuleApi();
}
async function enforceNoCanvasForSidekickPlayer() {
  const coreIsDisabled = game.settings.get("core", "noCanvas");
  if (!coreIsDisabled) {
    game.settings.set("core", "noCanvas", true);
    foundry.utils.debouncedReload();
  }
}
function rebuildOwnedActorRoster() {
  let actorList = $(SS_CORE_SELECTOR.actorList);
  actorList.empty();
  let actorElements = buildActorRosterEntries();
  actorList.show();
  actorElements.forEach((elem) => actorList.append(elem));
}
function getOwnedActors() {
  return game.actors.filter((actor) => isActorOwnedByUser(actor));
}
function isActorOwnedByUser(actor) {
  return actor.ownership[game.user.id] === 3;
}
function buildActorRosterEntries() {
  let actors = getOwnedActors();
  return actors.map(
    (actor) => {
      return $("<div>").append($("<img>").attr("src", actor.img)).click(async () => {
        await switchActiveActor(actor);
        toggleActorRosterPanel();
      });
    }
  );
}
async function switchActiveActor(actor, render = true) {
  actorStorage.current = actor;
  if (render) await actor.sheet.render(true);
  controlCurrentActorToken();
  saveLastActorId(actorStorage.current.id);
}
function controlCurrentActorToken() {
  if (actorStorage.current) {
    const activeTokens = actorStorage.current.getActiveTokens();
    if (activeTokens.length > 0) {
      activeTokens[0].control({ releaseOthers: true });
    }
  }
}
function toggleActorRosterPanel() {
  $(SS_CORE_SELECTOR.actorList).toggleClass("collapse");
  if ($(`${SS_CORE_SELECTOR.actorList}.collapse`)) {
    localStorage.setItem("collapsed-actor-select", "true");
  } else {
    localStorage.setItem("collapsed-actor-select", "false");
  }
}
function positionJournalDirectoryForSidekick(app, html) {
  if (shouldUseSidekickMode()) {
    app.setPosition({
      left: window.innerWidth,
      top: 0,
      zIndex: 9999
    });
  }
}
function shouldApplyMobileLayoutFlags() {
  const maxWithForSmallDisplays = 800;
  const screenWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
  const isSmallScreen = screenWidth < maxWithForSmallDisplays;
  return isSmallScreen;
}
function applyMobileLayoutFlags() {
  if (shouldApplyMobileLayoutFlags()) {
    $(SS_CORE_SELECTOR.container).addClass("small-display");
    const observer = new MutationObserver(() => {
      if ($(SS_CORE_SELECTOR.sheet).length > 0) {
        $(SS_CORE_SELECTOR.sheet).addClass("small-display");
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
function addLogoutControl(sheetContainer) {
  sheetContainer?.find?.(".ss-logout-dock")?.remove?.();
  $(SS_CORE_SELECTOR.actorList).addClass("collapse");
  applyMobileLayoutFlags();
  syncLogoutDockPlacement();
}
async function confirmAndRunLogout() {
  let confirmed = false;
  try {
    if (typeof Dialog?.confirm === "function") {
      confirmed = await Dialog.confirm({
        title: "Log Out?",
        content: "<p>Do you want to log out of Foundry?</p>",
        yes: () => true,
        no: () => false,
        defaultYes: false
      });
    } else {
      confirmed = window.confirm("Do you want to log out of Foundry?");
    }
  } catch (_err) {
    confirmed = window.confirm("Do you want to log out of Foundry?");
  }
  if (!confirmed) return;
  ui.menu?.items?.logout?.onClick?.();
}
function ensureHeaderLogoutButton(form) {
  if (form instanceof HTMLElement) {
    form.querySelectorAll(".ss-header-logout-btn").forEach((el) => el.remove());
  }
  return true;
}
function syncLogoutDockPlacement() {
  const container = document.querySelector(SS_CORE_SELECTOR.container);
  if (!(container instanceof HTMLElement)) return;
  container.querySelectorAll(".ss-logout-dock").forEach((el) => el.remove());

  const form = document.querySelector(SS_CORE_SELECTOR.sheet);
  ensureHeaderLogoutButton(form);
  container.style.removeProperty("--ss-logout-dock-top");
}
async function openInitialOwnedActorSheet() {
  const ownedActors = getOwnedActors();
  const lastActorId = getLastActorId();
  if (lastActorId) {
    const lastActor = game.actors.get(lastActorId);
    const actorIsOwned = ownedActors.some((actor) => actor.id === lastActorId);
    if (lastActor && actorIsOwned) {
      await switchActiveActor(lastActor);
      return;
    } else {
      console.log("The saved actor could not be found, opening the first actor.");
    }
  }
  if (ownedActors?.length > 0) {
    await switchActiveActor(ownedActors[0]);
  } else {
    console.error("No actor for user found.");
  }
}
let currentSheet;
async function handleActorSheetRender(app, _sheet, actor) {
  if (currentSheet?.id === app.id || !shouldUseSidekickMode()) {
    return;
  }
  currentSheet?.close();
  currentSheet = app;
  app?.setPosition({
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight
  });
  if (app.classList) {
    app.classList.add(SS_CORE_CLASS.sheet);
  } else {
    _sheet.addClass(SS_CORE_CLASS.sheet);
  }
  $(".window-resizable-handle").hide();
  refreshTokenizerPortraitFallback();
  syncLogoutDockPlacement();
}
async function handleContainerSheetRender(app, html) {
  if (!shouldUseSidekickMode()) {
    return;
  }
  app.setPosition({
    left: window.innerWidth,
    top: 0,
    width: 1,
    // It will adjust to its minimum width
    height: window.innerHeight
    // It will adjust to its minimum height
  });
  html.css("z-index", "99999");
}
function refreshTokenizerPortraitFallback() {
  let actors = getOwnedActors();
  actors.map((actor) => {
    let actorImg = actor.img;
    let sheet = $("#ActorSheet5eCharacter-Actor-" + actor._id)[0];
    if (sheet !== void 0) {
      if (actorImg.includes("tokenizer") && actorImg.includes("Avatar")) {
        actorImg = actorImg.replace("Avatar", "Token");
        $(`${SS_CORE_SELECTOR.container} .sheet-header img.profile`)[0].src = actorImg;
      }
    }
  });
}
async function handleReadyOnce() {
  if (!shouldUseSidekickMode()) {
    return;
  }
  await waitForOwnedActorInitialization();
  mountSidekickShell();
  rebuildOwnedActorRoster();
  await openInitialOwnedActorSheet();
  hideSidekickUnusedUi();
  addEventListener("resize", handleWindowResize);
  dnd5eReadyHook();
}
function mountSidekickShell() {
  const sheetContainer = $("<div>").addClass(SS_CORE_CLASS.container);
  $("body").append(sheetContainer);
  sheetContainer.append(
    $("<div>").css({ "padding-top": "40px" }).addClass(SS_CORE_CLASS.actorList).attr("id", "ss-actor-list").attr("data-ss-id", "ss-actor-list")
  );
  addLogoutControl(sheetContainer);
}
function hideSidekickUnusedUi() {
  $("#interface").addClass(SS_CORE_CLASS.hide);
  $("#pause").addClass(SS_CORE_CLASS.hide);
  $("#tooltip").addClass(SS_CORE_CLASS.hide);
  $("#notifications").addClass(SS_CORE_CLASS.hide);
}
function waitForOwnedActorInitialization() {
  return new Promise((resolve, reject) => {
    let count = 0;
    const checkApiInterval = setInterval(() => {
      const ownedActors = getOwnedActors();
      if (ownedActors && ownedActors.length > 0) {
        clearInterval(checkApiInterval);
        resolve();
      } else if (count >= 500) {
        clearInterval(checkApiInterval);
        reject(new Error("Could not initialize actor."));
      } else {
        count++;
      }
    }, 500);
  });
}
function handleWindowResize(event) {
  currentSheet?.setPosition({
    width: window.innerWidth,
    height: window.innerHeight
  });
  syncLogoutDockPlacement();
}
async function handleActorCreated(actor) {
  if (!shouldUseSidekickMode()) {
    return;
  }
  if (isActorOwnedByUser(actor)) {
    rebuildOwnedActorRoster();
    await switchActiveActor(actor);
  }
}
async function handleActorDeleted(actor) {
  if (!shouldUseSidekickMode()) {
    return;
  }
  if (isActorOwnedByUser(actor)) {
    rebuildOwnedActorRoster();
    if (actor === actorStorage.current) {
      await openInitialOwnedActorSheet();
    }
  }
}
async function handleUserConfigClosed() {
  if (!shouldUseSidekickMode()) {
    return;
  }
  await openInitialOwnedActorSheet();
}
async function handleSettingsConfigRendered(app, element, settings) {
  if (!shouldUseSidekickMode()) {
    return;
  }
  app.setPosition({ zIndex: 2e3 });
  if (window.innerWidth < 600) {
    app.setPosition({
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight
    });
    const content = element.querySelector(".window-content");
    if (content) {
      content.style.flexDirection = "column";
      content.style.overflowY = "auto";
      content.style.maxHeight = "100vh";
    }
  }
}
Hooks.on("init", async () => {
  initializeCoreRuntime();
});
Hooks.on("setup", async () => {
  await setupCoreRuntime();
});
Hooks.once("ready", async function() {
  await handleReadyOnce();
});
Hooks.on("dnd5e.transformActor", async (fromActor, toActor) => {
  syncActiveActorAfterTransform(fromActor, toActor);
});
Hooks.on("renderActorSheetV2", async (app, _sheet, { actor }) => {
  await handleActorSheetRender(app, _sheet);
});
Hooks.on("renderActorSheet", async (app, _sheet, { actor }) => {
  if (game.system.id === "pf2e") {
    if (_sheet.hasClass("spellcasting-entry") && _sheet.hasClass("preparation")) {
      
      _sheet.addClass(SS_CORE_CLASS.sheet);
      return;
    }
  }
  await handleActorSheetRender(app, _sheet);
});
Hooks.on("createActor", async function(actor) {
  await handleActorCreated(actor);
});
Hooks.on("deleteActor", async function(actor) {
  await handleActorDeleted(actor);
});
Hooks.on("renderContainerSheet", async (app, html) => {
  await handleContainerSheetRender(app, html);
});
Hooks.once("closeUserConfig", async () => {
  await handleUserConfigClosed();
});
Hooks.on("renderSettingsConfig", async (app, element, settings) => {
  await handleSettingsConfigRendered(app, element);
});
Hooks.on("renderJournalDirectory", async (app, html, data) => {
  positionJournalDirectoryForSidekick(app);
});
//# sourceMappingURL=index.js.map

