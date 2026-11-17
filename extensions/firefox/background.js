// Reports the active tab of the focused Firefox window to Hearth on 127.0.0.1:5600.
// Only the tab's title and address are sent, and only to your own computer.
// Private windows are reported as "private" with no title or address.

const SERVER = "http://127.0.0.1:5600";
const POLL_SECONDS = 5;
const BUCKET = "web_firefox";

let bucketReady = false;

async function api(path, body) {
  const res = await fetch(SERVER + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

async function ensureBucket() {
  if (bucketReady) return;
  await api(`/api/buckets/${BUCKET}`, { type: "web.tab.current", hostname: "firefox" });
  bucketReady = true;
}

async function activeTab() {
  const win = await browser.windows.getLastFocused({ populate: false });
  if (!win || !win.focused) return null;
  const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
  return tab || null;
}

async function report() {
  try {
    if ((await browser.idle.queryState(180)) !== "active") return;
    const tab = await activeTab();
    if (!tab || !tab.url) return;
    const data = tab.incognito
      ? { browser: "firefox", incognito: true }
      : { browser: "firefox", url: tab.url, title: tab.title || "", audible: Boolean(tab.audible) };
    await ensureBucket();
    await api(`/api/buckets/${BUCKET}/heartbeat?pulsetime=${POLL_SECONDS + 2}`, {
      timestamp: Date.now() / 1000,
      data,
    });
  } catch (err) {
    // Hearth isn't running, or it restarted: try again on the next tick.
    bucketReady = false;
  }
}

browser.tabs.onActivated.addListener(report);
browser.tabs.onUpdated.addListener((id, change, tab) => {
  if (tab.active && (change.url || change.title)) report();
});
browser.windows.onFocusChanged.addListener(report);
setInterval(report, POLL_SECONDS * 1000);
report();
