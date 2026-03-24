import { registerNodeHandler } from '../engine/node-runner.js';
import { webhookHandler } from './triggers/webhook.js';
import { manualHandler } from './triggers/manual.js';
import { codeJsHandler } from './logic/code-js.js';
import { ifHandler } from './logic/if.js';
import { setHandler } from './logic/set.js';
import { httpRequestHandler } from './integration/http-request.js';
import { respondWebhookHandler } from './output/respond-webhook.js';

export function registerAllNodes() {
  registerNodeHandler('webhook', webhookHandler);
  registerNodeHandler('manual', manualHandler);
  registerNodeHandler('code-js', codeJsHandler);
  registerNodeHandler('if', ifHandler);
  registerNodeHandler('set', setHandler);
  registerNodeHandler('http-request', httpRequestHandler);
  registerNodeHandler('respond-webhook', respondWebhookHandler);
}
