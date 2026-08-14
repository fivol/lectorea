/**
 * Copying to the clipboard, everywhere this site can be opened.
 *
 * `navigator.clipboard` only exists in a secure context. The build is a folder
 * of static files, so it is also opened from a `file://` path and from a LAN
 * address over plain http — and there the modern call is simply absent. The old
 * textarea trick still works in exactly those places, which is why it stays as
 * the fallback instead of the user being told their browser cannot copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied, or an insecure context that has the API but not the
    // right to use it. Both are the fallback's problem now.
  }
  return execCopy(text);
}

function execCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Off-screen rather than hidden: a `display: none` field cannot be selected,
  // and `position: fixed` keeps the page from scrolling to it.
  area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
