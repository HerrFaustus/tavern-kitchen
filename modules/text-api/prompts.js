import { definePanelPrompt } from '../../core/panel-policy.js';

export const CONNECTION_TEST_PROMPT = 'Reply with OK.';

export const connectionProbe = definePanelPrompt('connection-test', 'connectionProbe', '测试消息', CONNECTION_TEST_PROMPT);
