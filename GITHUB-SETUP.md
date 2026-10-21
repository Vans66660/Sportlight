# Sportlight Source Snapshot

This export contains the Sportlight mini-program and cloud functions, including
the current local code changes. It starts with fresh Git history because the
original repository history contains payment private keys.

## Local setup

1. Open this directory in WeChat Developer Tools using project.config.json.
2. Install dependencies for the cloud functions you deploy.
3. Build mini-program npm dependencies when required by Developer Tools.
4. Select your cloud development environment and deploy the required functions.

## Payment configuration

Payment private keys are excluded from this export. Restore apiclient_key.pem
locally in each payment function that reads it before deployment. Never commit
these files.

Configure WXPAY_API_V3_KEY in the cloud environment for paymentNotify,
eventPaymentNotify, and soloGamePaymentNotify. Their hardcoded key fallbacks
have been removed in this export.

Configure TENCENT_SECRET_ID and TENCENT_SECRET_KEY for cloud functions that use
Tencent Cloud APIs as needed.

## Scope

Cloud database records, cloud storage objects, deployed function settings,
node_modules, local Developer Tools preferences, and unrelated local MediaPipe
experiments are not included. Export cloud data separately if a data backup is
required.
