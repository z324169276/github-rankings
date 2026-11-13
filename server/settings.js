import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = fileURLToPath(new URL('../config.json', import.meta.url));

/** 每次调用都重新读取，改完配置无需重启服务 */
export function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function getDeepSeekKey() {
  return process.env.DEEPSEEK_API_KEY || loadConfig().deepseekKey || '';
}
