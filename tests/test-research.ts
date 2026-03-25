import { createResearchTools } from './src/gateway/tools/researchTools.js';
const tools = createResearchTools();
tools[0].execute({ query: 'AI agents' }).then(console.log).catch(console.error);
