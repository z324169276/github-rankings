import { initStore } from './store.js';
import { runRefresh } from './crawler.js';

initStore();
const result = await runRefresh();
console.log(result);
process.exit(result.ok ? 0 : 1);
