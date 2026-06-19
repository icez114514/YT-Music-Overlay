const statusText = document.querySelector<HTMLElement>("#statusText");
const backButton = document.querySelector<HTMLButtonElement>("#backButton");
const forwardButton = document.querySelector<HTMLButtonElement>("#forwardButton");
const reloadButton = document.querySelector<HTMLButtonElement>("#reloadButton");
const overlayToggle = document.querySelector<HTMLInputElement>("#overlayToggle");

function setStatus(message: string): void {
  if (statusText) {
    statusText.textContent = message;
  }
}

async function boot(): Promise<void> {
  const extensionStatus = await window.playerApi.getExtensionStatus();
  setStatus(extensionStatus);
  window.playerApi.onStatus(setStatus);
}

backButton?.addEventListener("click", () => {
  window.playerApi.command("back");
});

forwardButton?.addEventListener("click", () => {
  window.playerApi.command("forward");
});

reloadButton?.addEventListener("click", () => window.playerApi.command("reload"));

overlayToggle?.addEventListener("change", () => {
  window.playerApi.command(overlayToggle.checked ? "show-overlay" : "hide-overlay");
});

boot();
