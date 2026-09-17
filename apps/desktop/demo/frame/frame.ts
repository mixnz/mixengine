import "@fontsource-variable/geist";

/* Everything this page shows comes from its query string, so `capture.mjs` owns the copy and the
   page owns only the look. `body[data-ready]` is what the capture waits for. */
const query = new URLSearchParams(location.search);
const root = document.documentElement;
root.dataset.theme = query.get("theme") === "light" ? "light" : "dark";
root.dataset.platform = query.get("platform") ?? "mac";
document.getElementById("headline")!.textContent = query.get("headline") ?? "";
document.getElementById("description")!.textContent = query.get("description") ?? "";

async function ready(): Promise<void> {
  const src = query.get("img");
  if (src !== null) {
    const shot = document.getElementById("shot") as HTMLImageElement;
    shot.src = src;
    await shot.decode();
  }
  await document.fonts.ready;
  document.body.dataset.ready = "true";
}

void ready();
