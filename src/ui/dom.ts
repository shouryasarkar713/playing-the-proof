// ui/dom.ts — tiny element factory shared by the lab and explorer modes.
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | number | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) {
      continue;
    }
    if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) {
      continue;
    }
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== false) {
      el.setAttribute(k, String(v === true ? "" : v));
    }
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

export function section(id: string, title: string, ...children: Child[]): HTMLElement {
  const s = h("section", { id, "aria-labelledby": `${id}-h` });
  const head = h("h3", { id: `${id}-h` }, title);
  s.append(head);
  for (const c of children) {
    if (c !== null && c !== undefined && c !== false) {
      s.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return s;
}

// label + control pair with an explicit for/id association.
export function field(id: string, label: string, control: HTMLElement): HTMLElement {
  control.id = id;
  const wrap = h("div", { class: "fld" });
  wrap.append(h("label", { for: id }, label), control);
  return wrap;
}

export function shortRat(text: string, max = 22): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Exact n/d as the shortest honest string ("5" for 5/1).
export function ratText(r: { n: bigint; d: bigint }): string {
  return r.d === 1n ? String(r.n) : `${String(r.n)}/${String(r.d)}`;
}
