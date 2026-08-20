// Inlined rather than a sibling .css file: `tsc` copies no static assets into
// dist/, and a stylesheet gains nothing from a separate compile step the way
// ./dashboard.client.ts does. Kept out of dashboard.view.ts so the render
// helpers stay readable.

export const DASHBOARD_STYLES = `
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }
  th { background: #f5f5f5; }
  td.metric-cell { cursor: pointer; }
  td.metric-cell:hover { background: #eef6ff; }
  td.empty-cell, td.empty-state { color: #aaa; }
  td.empty-state { text-align: center; padding: 1.5rem; }
  #load-more { margin-top: 1rem; border: 1px solid #ccc; border-radius: 3px; background: #fff;
               padding: 0.4rem 1rem; font-size: 0.9rem; }
  #load-more:hover:enabled { background: #eef6ff; }
  #load-more:disabled { color: #aaa; background: #f5f5f5; cursor: default; }
  #history-panel { margin-top: 1.5rem; border-top: 2px solid #ddd; padding-top: 1rem; }
  #history-panel[hidden] { display: none; }
  button { cursor: pointer; }
`
