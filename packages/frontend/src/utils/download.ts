export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.textContent = `若下载未开始，点击保存 ${filename}`;
  anchor.setAttribute('aria-label', `保存下载文件 ${filename}`);
  Object.assign(anchor.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: '9999',
    maxWidth: '420px',
    padding: '10px 14px',
    color: '#ffffff',
    background: '#1677ff',
    borderRadius: '8px',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
    textDecoration: 'none',
  });
  document.body.appendChild(anchor);

  const cleanup = () => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };
  anchor.addEventListener('click', (event) => {
    if (event.isTrusted) window.setTimeout(cleanup, 1000);
  });
  anchor.click();

  // Keep a visible, user-gesture fallback for embedded WebViews that ignore
  // programmatic downloads started after an asynchronous request.
  window.setTimeout(cleanup, 60_000);
}
