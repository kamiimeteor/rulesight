export function downloadText(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Export what the page was built from, not what React rendered: drop the rendered tree and portals
// (tooltips) so the saved file boots like a fresh report.
export function currentPageHtml(): string | null {
  const clone = document.documentElement.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return null;
  const body = clone.querySelector("body");
  for (const child of Array.from(body?.children ?? [])) {
    if (child.id === "root") child.replaceChildren();
    else if (child.tagName !== "SCRIPT") child.remove();
  }
  return `<!doctype html>\n${clone.outerHTML}`;
}
