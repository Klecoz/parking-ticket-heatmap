// Share button: copy current URL to clipboard and show a brief toast.

export function mountShare() {
  const btn = document.getElementById("shareBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      showToast(btn);
    } catch {
      // Clipboard API unavailable — fall back to selecting a hidden input.
      const input = document.getElementById("shareUrlInput");
      if (input) {
        input.value = url;
        input.select();
        try {
          document.execCommand("copy");
          showToast(btn);
        } catch {
          // Silently fail if both paths are unavailable.
        }
      }
    }
  });
}

function showToast(anchor) {
  // Reuse existing toast if still visible.
  let toast = document.getElementById("shareToast");
  if (!toast) {
    toast = document.createElement("span");
    toast.id = "shareToast";
    toast.className = "share-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    anchor.parentNode.appendChild(toast);
  }
  toast.textContent = "Link copied!";
  toast.classList.add("share-toast-visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("share-toast-visible");
  }, 1500);
}
