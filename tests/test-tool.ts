import { createDocumentTools } from './src/gateway/tools/documentTools.js';
const tools = createDocumentTools('/tmp/test-worktree');
const tool = tools.find(t => t.name === 'write_spec_document');
tool.execute({ path: 'projects/test-issue-93.md', content: 'test' }).then(console.log).catch(console.error);
