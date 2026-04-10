const path = require('path');
const root  = __dirname;

module.exports = {
  apps: [
    {
      name:   'web',
      script: path.join(root, 'bike-gear-calc/server.js'),
      env:    { PORT: 80 },
    },
    {
      name:   'webhook',
      script: path.join(root, 'deploy/webhook.js'),
      env: {
        PORT:          9000,
        REPO_DIR:      root,
        DEPLOY_BRANCH: 'main',
        SECRET_FILE:   path.join(root, '.webhook-secret'),
      },
    },
  ],
};
