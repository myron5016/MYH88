import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const LEDGER_PAGES = ["overview", "transactions", "positions", "cashflows", "backup"];

class MockClassList {
  constructor(names = []) {
    this.names = new Set(names);
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.names.has(name) : Boolean(force);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }
}

class MockElement {
  constructor({ id = "", tagName = "div", classes = [], dataset = {} } = {}) {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.dataset = { ...dataset };
    this.classList = new MockClassList(classes);
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.queryAll = () => [];
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler.call(this, event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const simple = part.trim();
      if (simple.startsWith(".")) return this.classList.contains(simple.slice(1));
      const dataAttribute = simple.match(/^\[data-([a-z-]+)(?:=["']([^"']+)["'])?\]$/);
      if (dataAttribute) {
        const key = dataAttribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return key in this.dataset && (dataAttribute[2] === undefined || this.dataset[key] === dataAttribute[2]);
      }
      return simple.toUpperCase() === this.tagName;
    });
  }

  closest(selector) {
    return this.matches(selector) ? this : null;
  }

  querySelectorAll(selector) {
    return this.queryAll(selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  focus() {}
}

function createControllerHarness(controller, { admin = false } = {}) {
  const pageControls = LEDGER_PAGES.map((page) => new MockElement({
    tagName: "button",
    classes: ["tab"],
    dataset: { ledgerPage: page, tab: page },
  }));
  const pageDots = LEDGER_PAGES.map((page) => new MockElement({
    tagName: "button",
    classes: ["ledger-page-dot"],
    dataset: { ledgerDot: page },
  }));
  const panes = LEDGER_PAGES.map((page) => new MockElement({
    id: page === "overview" ? "ledgerOverviewPane" : `${page}Pane`,
    classes: ["ledger-page"],
    dataset: { ledgerPane: page },
  }));
  const carousel = new MockElement({ id: "ledgerCarousel", classes: ["ledger-carousel", "ledger-carousel-viewport"] });
  const track = new MockElement({ id: "ledgerCarouselTrack", classes: ["ledger-carousel-track"] });
  const elements = [carousel, track, ...pageControls, ...pageDots, ...panes];
  const byId = new Map(elements.filter((element) => element.id).map((element) => [element.id, element]));
  byId.set("ledgerCarouselViewport", carousel);

  const querySelectorAll = (selector) => elements.filter((element) => element.matches(selector));
  elements.forEach((element) => { element.queryAll = querySelectorAll; });
  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new MockElement({ id }));
      return byId.get(id);
    },
    querySelectorAll,
    querySelector(selector) {
      return querySelectorAll(selector)[0] || null;
    },
    createElement(tagName) {
      return new MockElement({ tagName });
    },
  };

  let backupRenderCount = 0;
  const context = createContext({
    console,
    document,
    Element: MockElement,
    HTMLElement: MockElement,
    isAdminMode: admin,
    activeLedgerTab: "overview",
    state: { positions: [], transactions: [], cashFlows: [], snapshots: [], settings: {} },
    $: (id) => document.getElementById(id),
    escapeHtml: (value) => String(value ?? ""),
    money: (value) => `$${Number(value) || 0}`,
    renderBackupList: () => { backupRenderCount += 1; },
    MYH88Core: {},
  });
  runInContext(controller, context, { filename: "script.part3.js" });

  return {
    context,
    elements,
    activePage: () => runInContext("activeLedgerTab", context),
    backupRenderCount: () => backupRenderCount,
    hasInterface(name) {
      return runInContext(`typeof ${name}`, context);
    },
    readValue(name) {
      return runInContext(name, context);
    },
    call(name, ...args) {
      return context[name](...args);
    },
  };
}

function extractPaneFragment(html, page) {
  const marker = `data-ledger-pane="${page}"`;
  const start = html.lastIndexOf("<", html.indexOf(marker));
  const nextPane = html.indexOf("data-ledger-pane=", start + marker.length);
  const boundary = nextPane < 0 ? html.length : html.lastIndexOf("<", nextPane);
  return html.slice(start, boundary);
}

function extractTableOpeningTag(fragment, boundary) {
  return fragment.match(new RegExp(`<table\\b(?=[^>]*data-holdings-table="${boundary}")[^>]*>`))?.[0] || "";
}

function assertTask2Interface(harness, name) {
  assert.equal(harness.hasInterface(name), "function", `Task 2 interface ${name} must be defined`);
}

function touchEvent(target, clientX, clientY) {
  const point = { clientX, clientY };
  return { target, touches: [point], changedTouches: [point], preventDefault() {} };
}

test("ledger structure declares exact navigation and pane order", async () => {
  const [html, controller, renderer, brandCss] = await Promise.all([
    read("index.html"),
    read("script.part3.js"),
    read("script.part4.js"),
    read("brand-v11.7.css"),
  ]);
  const navigationPages = [...html.matchAll(/<(?:button|a)[^>]*data-ledger-page="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  const panePages = [...html.matchAll(/<[^>]*data-ledger-pane="([^"]+)"[^>]*>/g)].map((match) => match[1]);

  assert.deepEqual(navigationPages, LEDGER_PAGES);
  assert.deepEqual(panePages, LEDGER_PAGES);
  assert.match(html, /id="ledgerCarousel"/);
  assert.match(html, /id="ledgerOverviewPane"/);
  assert.match(html, />持仓批次管理</);
  assert.match(brandCss, /\.ledger-carousel/);
  assert.match(controller, /function renderLedgerOverview\(\)/);
  assert.match(renderer, /renderLedgerOverview\(\)/);
  assert.match(renderer, /switchLedgerTab\(activeLedgerTab/);
});

test("ledger permissions and backup rendering follow the active user", async () => {
  const [html, controller] = await Promise.all([read("index.html"), read("script.part3.js")]);
  const visitor = createControllerHarness(controller);
  const administrator = createControllerHarness(controller, { admin: true });

  assertTask2Interface(visitor, "switchLedgerTab");
  visitor.call("switchLedgerTab", "positions");
  assert.equal(visitor.activePage(), "overview", "visitors must fall back to overview for an admin page");
  administrator.call("switchLedgerTab", "positions");
  assert.equal(administrator.activePage(), "positions", "administrators may open the positions page");

  visitor.call("switchLedgerTab", "backup");
  assert.equal(visitor.activePage(), "overview", "visitor backup requests must fall back to overview");
  assert.equal(visitor.backupRenderCount(), 0, "backup must not render for an unauthorized request");
  administrator.call("switchLedgerTab", "backup");
  assert.equal(administrator.activePage(), "backup");
  assert.equal(administrator.backupRenderCount(), 1, "backup renders on the legal backup page");

  assert.equal(visitor.hasInterface("allowedLedgerPages"), "function", "Task 2 interface allowedLedgerPages must be defined");
  assert.deepEqual(Array.from(visitor.readValue("PUBLIC_LEDGER_PAGES")), ["overview", "transactions"]);
  assert.deepEqual(Array.from(administrator.readValue("ADMIN_LEDGER_PAGES")), LEDGER_PAGES);

  for (const page of ["overview", "transactions"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.doesNotMatch(tag, /admin-only/, `${page} navigation must remain public`);
  }
  for (const page of ["positions", "cashflows", "backup"]) {
    const tag = html.match(new RegExp(`<[^>]+data-ledger-page="${page}"[^>]*>`))?.[0] || "";
    assert.match(tag, /admin-only/, `${page} navigation must be admin-only`);
    assert.match(html, new RegExp(`data-ledger-pane="${page}"[^>]*admin-only`), `${page} pane must be admin-only`);
  }
});

test("holdings tables have explicit public and admin boundaries", async () => {
  const html = await read("index.html");
  const publicMapStart = html.indexOf('<section id="allocationMap"');
  const publicMapEnd = html.indexOf('<section id="analytics"', publicMapStart);
  const publicMap = html.slice(publicMapStart, publicMapEnd < 0 ? html.length : publicMapEnd);
  const positionsPane = extractPaneFragment(html, "positions");
  const publicTables = [...publicMap.matchAll(/<table\b(?=[^>]*data-holdings-table="public")[^>]*>/g)].map((match) => match[0]);
  const adminTables = [...positionsPane.matchAll(/<table\b(?=[^>]*data-holdings-table="admin")[^>]*>/g)].map((match) => match[0]);
  const publicTable = extractTableOpeningTag(publicMap, "public");
  const adminTable = extractTableOpeningTag(positionsPane, "admin");

  assert.equal(publicTables.length, 1);
  assert.equal(adminTables.length, 1);
  assert.equal((html.match(/data-holdings-table=/g) || []).length, 2);
  assert.match(publicTable, /data-holdings-table="public"/);
  assert.match(publicMap, /data-holdings-table="public"[\s\S]*?id="mapHoldingBody"/);
  assert.match(adminTable, /data-holdings-table="admin"/);
  assert.match(positionsPane, /admin-only/);
  assert.match(positionsPane, /data-holdings-table="admin"[\s\S]*?id="positionBody"/);
});

test("carousel handlers execute guarded touch and directional keyboard navigation", async () => {
  const [html, controller, renderer] = await Promise.all([read("index.html"), read("script.part3.js"), read("script.part4.js")]);
  const harness = createControllerHarness(controller, { admin: true });
  const shifts = [];
  const dotPages = [...html.matchAll(/<button[^>]*data-ledger-dot="([^"]+)"[^>]*>/g)].map((match) => match[1]);

  assertTask2Interface(harness, "shiftLedgerPage");
  assertTask2Interface(harness, "initLedgerCarousel");
  harness.context.__recordLedgerShift = (direction) => { shifts.push(direction); };
  runInContext("shiftLedgerPage = __recordLedgerShift", harness.context);
  harness.call("initLedgerCarousel");
  const gestureSurface = harness.elements.find((element) => element.listeners.has("touchstart"));
  assert.ok(gestureSurface, "initLedgerCarousel must register a touchstart handler");
  assert.ok(gestureSurface.listeners.has("touchend"), "initLedgerCarousel must register a touchend handler");
  assert.ok(gestureSurface.listeners.has("keydown"), "initLedgerCarousel must register a keydown handler");

  const blockedTargets = [
    new MockElement({ classes: ["table-wrap"] }),
    ...["input", "select", "button", "dialog"].map((tagName) => new MockElement({ tagName })),
  ];
  for (const target of blockedTargets) {
    gestureSurface.dispatch("touchstart", touchEvent(target, 100, 20));
    gestureSurface.dispatch("touchend", touchEvent(target, 20, 20));
  }
  assert.deepEqual(shifts, [], "interactive and horizontally scrollable targets must not shift pages");

  const plainTarget = new MockElement();
  gestureSurface.dispatch("touchstart", touchEvent(plainTarget, 100, 20));
  gestureSurface.dispatch("touchend", touchEvent(plainTarget, 45, 20));
  gestureSurface.dispatch("touchstart", touchEvent(plainTarget, 100, 20));
  gestureSurface.dispatch("touchend", touchEvent(plainTarget, 44, 90));
  assert.deepEqual(shifts, [], "swipes below 56px or dominated by vertical travel must not shift pages");

  gestureSurface.dispatch("touchstart", touchEvent(plainTarget, 100, 20));
  gestureSurface.dispatch("touchend", touchEvent(plainTarget, 44, 30));
  assert.deepEqual(shifts, [1], "a qualifying left swipe must shift one page forward");

  gestureSurface.dispatch("keydown", { key: "ArrowLeft", target: gestureSurface, preventDefault() {} });
  gestureSurface.dispatch("keydown", { key: "ArrowRight", target: gestureSurface, preventDefault() {} });
  assert.deepEqual(shifts, [1, -1, 1], "ArrowLeft and ArrowRight must shift -1 and +1");

  assert.match(html, /onclick="shiftLedgerPage\(-1\)"/);
  assert.match(html, /onclick="shiftLedgerPage\(1\)"/);
  assert.deepEqual(dotPages, LEDGER_PAGES);
  for (const page of LEDGER_PAGES) {
    assert.match(html, new RegExp(`data-ledger-dot="${page}"[^>]*onclick="switchLedgerTab\\(['"]${page}['"]\\)"`));
  }
  assert.match(renderer, /initLedgerCarousel\(\)/);
});
