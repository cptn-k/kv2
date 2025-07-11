const system = require('../shared/system');

module.exports = (req, res) => {
  system.logInfo('Request received', {
    method: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query
  });

  res.status(200).json({
    method: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query
  });
};
