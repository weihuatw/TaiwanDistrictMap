/** Dataset text must remain text, including quotes and HTML-like characters. */
export function appendTextOption(select: HTMLSelectElement, value: string, label: string) {
  const option = select.ownerDocument.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
  return option;
}

/** Only absolute web URLs from source metadata may become external links. */
export function setExternalLink(link: HTMLAnchorElement, value: unknown): boolean {
  link.removeAttribute('href');
  link.removeAttribute('target');
  link.removeAttribute('rel');
  link.setAttribute('aria-disabled', 'true');
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.removeAttribute('aria-disabled');
    return true;
  } catch {
    return false;
  }
}
