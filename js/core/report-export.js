// "Export report": a standalone HTML file with the site styles, the report markup (inline SVG
// charts included) and the report summary as embedded JSON. No network, no scripts that run.

const FOOTER = '<footer class="site-footer"><p><strong>Independent practice.</strong> CogPrep Arcade is not affiliated with, endorsed by, or connected to Aon, Capgemini or any employer or assessment provider. Scores here do not predict results in any real assessment.</p></footer>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function siteCss() {
  const parts = await Promise.all(['base.css', 'learn.css'].map(async (f) => {
    try {
      const r = await fetch(new URL(`../../css/${f}`, import.meta.url));
      return r.ok ? await r.text() : '';
    } catch {
      return '';
    }
  }));
  return parts.join('\n');
}

// Pure: assemble the document from its parts.
export function exportHtml({ title, css, body, data }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body class="export-doc">
<main id="main">${body}</main>
${FOOTER}
<script type="application/json" id="report-data">${json}</script>
</body>
</html>
`;
}

// Clone the report, drop controls, and download it.
export async function downloadReport(root, { title, data, filename }) {
  const clone = root.cloneNode(true);
  for (const n of clone.querySelectorAll('.no-print, .no-export, button, input, select, textarea, label.toggle')) n.remove();
  for (const d of clone.querySelectorAll('details')) d.setAttribute('open', '');
  const html = exportHtml({ title, css: await siteCss(), body: clone.innerHTML, data });
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
