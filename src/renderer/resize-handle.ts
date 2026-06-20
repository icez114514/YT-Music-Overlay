const params = new URLSearchParams(window.location.search);
const edge = params.get("edge") ?? "se";
const handle = document.querySelector<HTMLElement>("#resizeHandle");

document.documentElement.dataset.edge = edge;

const pointFromEvent = (event: PointerEvent): { x: number; y: number } => ({
  x: Math.round(event.screenX),
  y: Math.round(event.screenY)
});

handle?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  window.overlayApi.beginResize(edge, pointFromEvent(event));
});

handle?.addEventListener("pointermove", (event) => {
  if (!handle.hasPointerCapture(event.pointerId)) {
    return;
  }
  event.preventDefault();
  window.overlayApi.updateResize(pointFromEvent(event));
});

const endResize = (event: PointerEvent): void => {
  if (handle?.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId);
  }
  window.overlayApi.endResize();
};

handle?.addEventListener("pointerup", endResize);
handle?.addEventListener("pointercancel", endResize);
window.addEventListener("blur", () => window.overlayApi.endResize());
