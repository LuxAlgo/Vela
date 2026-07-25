// The workspace playground page: mounts the multi-chart VelaWorkspace once it lands.
// Until then it shows a plain placeholder so the playground index link doesn't 404.
const host = document.querySelector<HTMLElement>('#workspace');
if (host) {
    host.style.cssText += 'display:flex;align-items:center;justify-content:center;color:#868a96;font:13px -apple-system,system-ui,sans-serif;';
    host.textContent = 'VelaWorkspace is under construction — this page mounts it when the workspace phase lands.';
}

export {};
