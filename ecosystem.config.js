module.exports = {
  apps: [
    {
      name: "pegueapromo-api",
      script: "./lib/index.js",
      instances: 1, // Baileys (WhatsApp) prefere rodar em 1 instância apenas para evitar conflitos de sessão sqlite
      autorestart: true,
      watch: false,
      max_memory_restart: "2G", // Se ultrapassar 2GB de RAM, restarta o processo para liberar memória (vazamentos do Playwright/Baileys)
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
