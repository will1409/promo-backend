const { spawnSync } = require('child_process');
const path = require('path');

// Define a pasta de instalação do Playwright dentro do projeto para persistir no deploy do Render
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, 'ms-playwright');
console.log('[playwright-install] Iniciando instalação do Chromium no caminho:', process.env.PLAYWRIGHT_BROWSERS_PATH);

const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

if (result.error) {
  console.error('[playwright-install] Falha ao executar spawnSync:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('[playwright-install] Instalação do Playwright falhou com código:', result.status);
  process.exit(result.status);
}

console.log('[playwright-install] Instalação concluída com sucesso!');
