const $ = id => document.getElementById(id);
let lastInspection = null;

const example = {
  portal: "myhome",
  transaction: "sale",
  propertyType: "apartment",
  city: "თბილისი",
  address: "კრწანისის ქ.6",
  streetNumber: "6",
  area: "1235.4",
  rooms: "2",
  bedrooms: "2",
  floor: "2",
  totalFloors: "9",
  price: "123132123",
  projectType: "არასტანდარტული",
  contactName: "",
  contactPhone: "",
  description: ""
};

chrome.storage.local.get(["listing"], r => {
  $("data").value = JSON.stringify(
    r.listing || example, null, 2
  );
});

function show(value) {
  $("result").textContent =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
}

async function execute(func, args = []) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!tab?.id) throw Error("No active tab");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args
  });
  return result[0]?.result;
}

function inspectPage() {
  const controls = [...document.querySelectorAll(
    "input,textarea,select,button,[role=combobox]"
  )];

  function labelOf(el) {
    const explicit = el.labels
      ? [...el.labels].map(x => x.innerText).join(" ")
      : "";

    const group = el.closest(
      "label,[class*=field],[class*=Field],[class*=form],[class*=Form]"
    );

    return (
      explicit ||
      el.getAttribute("aria-label") ||
      group?.innerText?.slice(0, 150) ||
      ""
    ).trim();
  }

  return {
    url: location.href,
    title: document.title,
    controls: controls.map((el, index) => ({
      index,
      tag: el.tagName,
      type: el.type || "",
      id: el.id || "",
      name: el.name || "",
      placeholder: el.placeholder || "",
      role: el.getAttribute("role") || "",
      label: labelOf(el),
      disabled: !!el.disabled,
      value: "[REDACTED]",
      options: el.tagName === "SELECT"
        ? [...el.options].map(x => x.textContent.trim())
        : undefined
    }))
  };
}

function fillPage(data) {
  const normalized = value => String(value || "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const mappings = {
    area: ["ფართი *", "ძირითადი ფართი", "total area"],
    price: ["ფასი", "price"],
    rooms: ["ოთახები", "rooms"],
    bedrooms: ["საძინებლები", "bedrooms"],
    floor: ["სართული *", "floor"],
    totalFloors: ["სართულები სულ", "total floors"],
    description: ["დაწერეთ დამატებითი აღწერა", "description"],
    contactName: ["საკონტაქტო სახელი", "contact name"],
    contactPhone: ["ტელეფონის ნომერი", "phone number"]
  };

  const results = [];

  function describe(el) {
    const labels = el.labels
      ? [...el.labels].map(x => x.innerText).join(" ")
      : "";
    const parent = el.closest(
      "label,[class*=field],[class*=Field]"
    );
    return normalized([
      labels,
      el.placeholder,
      el.getAttribute("aria-label"),
      parent?.innerText?.slice(0, 90)
    ].filter(Boolean).join(" "));
  }

  function setReactValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(
      proto, "value"
    )?.set;

    if (!setter) return false;

    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const inputs = [...document.querySelectorAll(
    "input:not([type=hidden]):not([type=file]),textarea"
  )].filter(el => !el.disabled && !el.readOnly);

  for (const [key, aliases] of Object.entries(mappings)) {
    const value = data[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }

    const candidates = inputs.filter(el => {
      const label = describe(el);
      return aliases.some(a => label.includes(normalized(a)));
    });

    // Avoid guessing when several fields look alike.
    if (candidates.length !== 1) {
      results.push({
        field: key,
        status: "skipped",
        reason: `${candidates.length} candidate fields`
      });
      continue;
    }

    const el = candidates[0];

    if (el.type === "checkbox" || el.type === "radio") {
      results.push({
        field: key,
        status: "skipped",
        reason: "Requires option selection"
      });
      continue;
    }

    const ok = setReactValue(el, value);

    results.push({
      field: key,
      status: ok ? "input-event-sent" : "failed",
      value: undefined
    });
  }

  // Location, autocomplete, dropdowns and publication
  // deliberately require verified portal adapters.
  return {
    portal: location.hostname,
    results,
    warning: "Input events are not proof of saved form state. Verify visually. No publish action was performed."
  };
}

$("inspect").onclick = async () => {
  try {
    lastInspection = await execute(inspectPage);
    show(lastInspection);
  } catch (e) {
    show(e.message);
  }
};

$("copy").onclick = async () => {
  if (!lastInspection) return show("Inspect page first");
  await navigator.clipboard.writeText(
    JSON.stringify(lastInspection, null, 2)
  );
  show("Inspection copied");
};

$("fill").onclick = async () => {
  try {
    const data = JSON.parse($("data").value);
    show(await execute(fillPage, [data]));
  } catch (e) {
    show(e.message);
  }
};

$("save").onclick = async () => {
  try {
    const data = JSON.parse($("data").value);
    await chrome.storage.local.set({ listing: data });
    show("Listing saved in extension storage");
  } catch (e) {
    show(e.message);
  }
};
