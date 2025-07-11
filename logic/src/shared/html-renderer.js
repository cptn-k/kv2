/**
 * Simple HTML template renderer that replaces placeholders with values
 * @param {string} template - HTML template with {{placeholders}}
 * @param {Object} params - Object with values to inject into template
 * @returns {string} - Rendered HTML
 */
function renderHtml(template, params = {}) {
  return template.replace(/\{\{\s*([^{}]+)\s*\}\}/g, (_, key) => {
    return params[key] !== undefined ? params[key] : '';
  });
}

module.exports = renderHtml;
