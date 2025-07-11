const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const { client_email, private_key } = JSON.parse(process.env.GCP_CREDENTIALS || '{}');

const client = new SecretManagerServiceClient({
  credentials: { client_email, private_key },
  projectId: process.env.GCP_PROJECT
});

const gcpsecrets = {
  get: (secretName) => {
    const projectId = process.env.GCP_PROJECT;
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    return client.accessSecretVersion({ name })
      .then(([version]) => version.payload.data.toString());
  }
};

module.exports = gcpsecrets;
