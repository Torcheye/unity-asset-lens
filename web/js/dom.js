// Minimal hyperscript + render helpers — no framework, no build step.
// `h` builds HTML elements, `s` builds SVG elements, and `mount` does a full
// re-render of a root container while preserving focus/caret in text inputs
// (the only stateful DOM we keep across renders).

const SVG_NS = "http://www.w3.org/2000/svg";

const EVENTS = {
  onClick: "click",
  onInput: "input",
  onChange: "change",
  onKeyDown: "keydown",
  onMouseEnter: "mouseenter",
  onMouseLeave: "mouseleave",
};

function applyProps(el, props, ns) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key === "hover" && typeof value === "object") {
      attachHover(el, value);
    } else if (key === "focusStyle" && typeof value === "object") {
      attachFocusStyle(el, value);
    } else if (EVENTS[key]) {
      el.addEventListener(EVENTS[key], value);
    } else if (key === "value") {
      // Applied after children (see h()) so <select> can match an <option>.
      continue;
    } else if (key === "html") {
      el.innerHTML = value;
    } else if (ns) {
      el.setAttribute(key, String(value));
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function attachHover(el, hoverStyle) {
  const base = {};
  for (const k of Object.keys(hoverStyle)) base[k] = el.style[k] ?? "";
  el.addEventListener("mouseenter", () => Object.assign(el.style, hoverStyle));
  el.addEventListener("mouseleave", () => Object.assign(el.style, base));
}

function attachFocusStyle(el, focusStyle) {
  const base = {};
  for (const k of Object.keys(focusStyle)) base[k] = el.style[k] ?? "";
  el.addEventListener("focus", () => Object.assign(el.style, focusStyle));
  el.addEventListener("blur", () => Object.assign(el.style, base));
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

/** Build an HTML element. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props, false);
  appendChildren(el, children);
  // `value` is applied last so a <select> can resolve it against its options.
  if (props && "value" in props && "value" in el) el.value = props.value;
  return el;
}

/** Build an SVG element (children are also created in the SVG namespace). */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return el;
}

/** Parse a raw SVG/HTML string into a single element (for static icons). */
export function raw(markup) {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

function captureFocus(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active) || !active.id) return null;
  const snap = { id: active.id };
  if (typeof active.selectionStart === "number") {
    snap.start = active.selectionStart;
    snap.end = active.selectionEnd;
  }
  return snap;
}

function restoreFocus(root, snap) {
  if (!snap) return;
  const el = root.querySelector(`#${CSS.escape(snap.id)}`);
  if (!el) return;
  el.focus();
  if (typeof snap.start === "number" && typeof el.setSelectionRange === "function") {
    try {
      el.setSelectionRange(snap.start, snap.end);
    } catch {
      /* some input types disallow selection ranges */
    }
  }
}

/** Replace a root container's content with `node`, preserving input focus. */
export function mount(root, node) {
  const snap = captureFocus(root);
  root.replaceChildren(node);
  restoreFocus(root, snap);
}
